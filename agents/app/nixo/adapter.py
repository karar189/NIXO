"""Shared paper execution adapter and frozen market snapshot.

Both agents execute through this adapter against the same snapshot, costs and
step clock (Nixo_agents.md §9). Execution is simulated: no funds move.

Two entry points, deliberately separate:
- `execute_baseline(wallet, ...)` for Agent A. No NIXO policy; the only checks
  are physical (you can't spend what the paper wallet doesn't hold).
- `execute_ticket(ticket_id, ...)` for Agent B. Takes nothing but a ticket id,
  redeems it with the vault (single use) and executes the parameters the vault
  stored when it authorized the request. There is no other path to B's capital.

Assets are SYMBOL@chain codes (see assets.py). Prices are in USD per unit and the
allocation asset (USDC@near) is the numeraire at exactly 1.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
import zlib
from dataclasses import dataclass, field
from decimal import ROUND_DOWN, Decimal
from typing import Literal

from app.nixo.assets import ALLOCATION_CODE, Asset
from app.nixo.audit import AuditLog
from app.nixo.vault import UNIT, TradeRequest, Vault, VaultError, ds
from app.trading import market_data, oneclick
from app.trading.markets import USDC_DECIMALS, USDC_NEAR

log = logging.getLogger(__name__)

QTY_UNIT = Decimal("0.00000001")
QUOTE_PROBE_USDC = 100  # size of the routability / cost probe quote


def _dec(x: float) -> Decimal:
    return Decimal(str(round(x, 10)))


@dataclass
class MarketSnapshot:
    """USD prices per asset, one per step. Frozen at run start so both agents see the same market."""

    source: Literal["recorded", "synthetic"]
    timeframe: str
    captured_at: float
    prices: dict[str, list[Decimal]]  # asset code -> history + one price per step
    history: int  # bars before step 0 (context for the agents)
    sources: dict[str, str] = field(default_factory=dict)  # per asset: binance_recorded | flat_1click | synthetic
    costs_bps: dict[str, Decimal] = field(default_factory=dict)  # measured 1Click execution cost per asset
    quotes: dict[str, dict] = field(default_factory=dict)  # probe quote details per asset
    note: str | None = None

    def is_numeraire(self, asset: str) -> bool:
        return asset in (ALLOCATION_CODE, "USDC")

    def price(self, asset: str, step: int) -> Decimal:
        if self.is_numeraire(asset):
            return Decimal(1)
        series = self.prices[asset]
        return series[min(self.history + step, len(series) - 1)]

    def window(self, asset: str, step: int, n: int = 12) -> list[str]:
        if self.is_numeraire(asset):
            return ["1"]
        end = self.history + step + 1
        return [ds(p) for p in self.prices[asset][max(0, end - n):end]]  # type: ignore[misc]

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "timeframe": self.timeframe,
            "captured_at": self.captured_at,
            "history": self.history,
            "note": self.note,
            "prices": {k: [ds(p) for p in v] for k, v in self.prices.items()},
            "sources": self.sources,
            "costs_bps": {k: ds(v) for k, v in self.costs_bps.items()},
            "quotes": self.quotes,
        }

    @staticmethod
    def synthetic(steps: int, assets: list[Asset], history: int = 12, note: str | None = None) -> "MarketSnapshot":
        prices: dict[str, list[Decimal]] = {}
        for a in assets:
            if a.code == ALLOCATION_CODE:
                continue
            rng = random.Random(zlib.crc32(a.code.encode()))
            vol = 0.0005 if a.symbol.upper().startswith(("USD", "DAI")) else 0.01
            p, series = a.price or 1.0, []
            for _ in range(history + steps + 1):
                p *= 1 + rng.gauss(0, vol)
                series.append(_dec(p))
            prices[a.code] = series
        return MarketSnapshot("synthetic", "15m", time.time(), prices, history,
                              sources={k: "synthetic" for k in prices}, note=note)

    @staticmethod
    async def recorded(steps: int, assets: list[Asset], history: int = 12, timeframe: str = "15m") -> "MarketSnapshot":
        """Recorded Binance bars where the symbol trades there; otherwise the 1Click spot price, held flat."""
        n = history + steps + 1
        prices: dict[str, list[Decimal]] = {}
        sources: dict[str, str] = {}

        async def one(a: Asset) -> None:
            if a.binance_base:
                try:
                    candles = await market_data.get_candles(f"{a.binance_base}USDT", timeframe, n)
                    if len(candles) >= n:
                        prices[a.code] = [_dec(c.close) for c in candles[-n:]]
                        sources[a.code] = "binance_recorded"
                        return
                except market_data.MarketDataError as err:
                    log.info("no Binance history for %s: %s", a.code, err)
            prices[a.code] = [_dec(a.price or 0)] * n
            sources[a.code] = "flat_1click"

        await asyncio.gather(*(one(a) for a in assets if a.code != ALLOCATION_CODE))
        flat = sorted(k for k, v in sources.items() if v == "flat_1click")
        note = f"No recorded history for {', '.join(flat)}: held flat at the 1Click spot price." if flat else None
        return MarketSnapshot("recorded", timeframe, time.time(), prices, history, sources=sources, note=note)

    async def measure_costs(self, assets: list[Asset], floor_bps: int) -> None:
        """One 1Click dry quote (USDC@near -> asset) per asset: confirms routability and measures
        the real execution cost vs spot. Frozen into the snapshot so both agents pay the same."""

        async def one(a: Asset) -> None:
            body = oneclick._paper_body(USDC_NEAR, a.asset_id, oneclick.to_units(QUOTE_PROBE_USDC, USDC_DECIMALS))
            try:
                q = await oneclick.quote(body)
                out = float(q["quote"]["amountOutFormatted"])
                value = out * (a.price or 0)
                cost = max(0.0, (1 - value / QUOTE_PROBE_USDC) * 10_000) if value else None
                self.quotes[a.code] = {"routable": True, "amount_out": out, "cost_bps": round(cost, 1) if cost is not None else None,
                                       "time_estimate_s": q["quote"].get("timeEstimate")}
                if cost is not None:
                    self.costs_bps[a.code] = Decimal(str(round(max(cost, floor_bps), 1)))
            except (oneclick.OneClickError, KeyError, ValueError, TypeError) as err:
                self.quotes[a.code] = {"routable": False, "error": str(err)[:200]}

        await asyncio.gather(*(one(a) for a in assets if a.code != ALLOCATION_CODE))


@dataclass
class PaperWallet:
    """Agent A's baseline account: plain balances, no NIXO policy."""

    agent_id: str
    allocation_id: str
    deposit_id: str
    balances: dict[str, Decimal]
    withdrawn: list[dict] = field(default_factory=list)
    delivered: list[dict] = field(default_factory=list)  # swap output sent to any address (no pinning)

    def to_dict(self) -> dict:
        return {
            "agent_id": self.agent_id,
            "allocation_id": self.allocation_id,
            "deposit_id": self.deposit_id,
            "balances": {k: ds(v) for k, v in self.balances.items()},
            "withdrawn": [{**w, "amount": ds(w["amount"])} for w in self.withdrawn],
            "delivered": [{**w, "amount": ds(w["amount"])} for w in self.delivered],
        }


@dataclass
class ExecResult:
    status: Literal["settled", "failed", "held"]
    request_id: str
    execution_reference: str | None
    amount_in: Decimal = Decimal(0)
    amount_out: Decimal = Decimal(0)
    asset_out: str | None = None
    price: Decimal | None = None
    reason: str | None = None
    event_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "request_id": self.request_id,
            "execution_reference": self.execution_reference,
            "amount_in": ds(self.amount_in),
            "amount_out": ds(self.amount_out),
            "asset_out": self.asset_out,
            "price": ds(self.price),
            "reason": self.reason,
            "event_ids": self.event_ids,
            "simulated": True,
        }


class ExecutionAdapter:
    def __init__(self, snapshot: MarketSnapshot, vault: Vault, audit: AuditLog, fee_bps: int = 30):
        self.snapshot = snapshot
        self.vault = vault
        self.audit = audit
        self.fee = Decimal(fee_bps) / Decimal(10_000)
        self._seq = 0
        # Test hook: make the next execution fail ("fail") or return garbage ("garbage").
        self.fault: Literal["fail", "garbage"] | None = None

    def _ref(self) -> str:
        self._seq += 1
        return f"paper:{self.audit.run_id}:{self._seq:04d}"

    def cost(self, asset_out: str) -> Decimal:
        """Fraction lost to fees/slippage buying `asset_out`: the larger of the flat fee and the measured cost."""
        measured = self.snapshot.costs_bps.get(asset_out)
        return max(self.fee, measured / Decimal(10_000)) if measured is not None else self.fee

    def _quote(self, asset_in: str, amount_in: Decimal, asset_out: str, step: int) -> tuple[Decimal, Decimal]:
        """(amount_out, price of asset_out in USD) after the shared cost."""
        p_in = self.snapshot.price(asset_in, step)
        p_out = self.snapshot.price(asset_out, step)
        out = (amount_in * p_in * (1 - self.cost(asset_out)) / p_out).quantize(QTY_UNIT, rounding=ROUND_DOWN)
        return out, p_out

    def priced(self, asset: str) -> bool:
        return self.snapshot.is_numeraire(asset) or asset in self.snapshot.prices

    # ------------------------------------------------------------ Agent A

    def execute_baseline(self, wallet: PaperWallet, req: TradeRequest, step: int, *, phase: str | None = None) -> ExecResult:
        ref = self._ref()
        common = dict(source="adapter", agent_id=wallet.agent_id, assignment_id=wallet.allocation_id,
                      deposit_id=wallet.deposit_id, request_id=req.request_id, action=req.action,
                      asset_in=req.asset_in, amount_in=req.amount_in, asset_out=req.asset_out,
                      recipient=req.recipient, phase=phase)
        ev = [self.audit.emit("trade_submitted", execution_reference=ref, **common)["event_id"]]

        def failed(reason: str) -> ExecResult:
            ev.append(self.audit.emit("trade_failed", decision="failed", reason_code=reason, execution_reference=ref,
                                      **common)["event_id"])
            return ExecResult("failed", req.request_id, ref, reason=reason, event_ids=ev)

        amt = req.amount_in
        if not amt.is_finite() or amt <= 0:
            return failed("INVALID_AMOUNT")
        if wallet.balances.get(req.asset_in, Decimal(0)) < amt:
            return failed("INSUFFICIENT_BALANCE")
        if req.action == "withdraw":
            wallet.balances[req.asset_in] -= amt
            wallet.withdrawn.append({"asset": req.asset_in, "amount": amt, "destination": req.destination,
                                     "request_id": req.request_id})
            ev.append(self.audit.emit("trade_settled", decision="executed", execution_reference=ref,
                                      detail={"destination": req.destination}, **common)["event_id"])
            return ExecResult("settled", req.request_id, ref, amount_in=amt, event_ids=ev)
        if req.action != "swap" or not req.asset_out or req.asset_out == req.asset_in:
            return failed("UNSUPPORTED_ACTION")
        if not (self.priced(req.asset_in) and self.priced(req.asset_out)):
            return failed("UNPRICED_ASSET")
        out, price = self._quote(req.asset_in, amt, req.asset_out, step)
        wallet.balances[req.asset_in] -= amt
        if req.recipient:  # no pinning on the baseline: output goes wherever the request says
            wallet.delivered.append({"asset": req.asset_out, "amount": out, "recipient": req.recipient,
                                     "request_id": req.request_id})
        else:
            wallet.balances[req.asset_out] = wallet.balances.get(req.asset_out, Decimal(0)) + out
        ev.append(self.audit.emit("trade_settled", decision="executed", execution_reference=ref, amount_out=out,
                                  detail={"price": price, "delivered_to": req.recipient}, **common)["event_id"])
        return ExecResult("settled", req.request_id, ref, amt, out, req.asset_out, price, event_ids=ev)

    # ------------------------------------------------------------ Agent B

    def execute_ticket(self, ticket_id: str, step: int, *, phase: str | None = None) -> ExecResult:
        try:
            ticket = self.vault.begin_execution(ticket_id)
        except VaultError as err:
            # Not a vault-issued, unused ticket: nothing executes.
            return ExecResult("failed", "-", None, reason=err.code)
        req = ticket.request  # the parameters the vault authorized, not caller input
        a = self.vault.assignments[req.assignment_id]
        ref = self._ref()
        common = dict(source="adapter", agent_id=req.agent_id, assignment_id=req.assignment_id,
                      deposit_id=a.deposit_id, request_id=req.request_id, action=req.action, asset_in=req.asset_in,
                      amount_in=ticket.amount, asset_out=req.asset_out, recipient=req.recipient, phase=phase)
        ev = [self.audit.emit("trade_submitted", execution_reference=ref, detail={"ticket_id": ticket_id},
                              **common)["event_id"]]
        fault, self.fault = self.fault, None

        if fault == "fail" or not (req.asset_out and self.priced(req.asset_in) and self.priced(req.asset_out)):
            reason = "VENUE_REJECTED" if fault == "fail" else "UNPRICED_ASSET"
            self.vault.fail(ticket_id, reason)
            ev.append(self.audit.emit("trade_failed", decision="failed", reason_code=reason, execution_reference=ref,
                                      detail={"released": ticket.amount}, **common)["event_id"])
            return ExecResult("failed", req.request_id, ref, reason=reason, event_ids=ev)

        out, price = self._quote(req.asset_in, ticket.amount, req.asset_out, step)
        spent = ticket.amount
        if fault == "garbage":  # adapter reports more spent than was reserved
            spent = ticket.amount * 2
        state, problem = self.vault.settle(ticket_id, spent=spent, received_asset=req.asset_out,
                                           received_amount=out, execution_reference=ref, phase=phase)
        if state == "held":
            ev.append(self.audit.emit("trade_held", decision="held", reason_code="UNEXPECTED_EXECUTION_RESULT",
                                      execution_reference=ref, detail={"problem": problem}, **common)["event_id"])
            return ExecResult("held", req.request_id, ref, reason=problem, event_ids=ev)
        ev.append(self.audit.emit("trade_settled", decision="executed", execution_reference=ref, amount_out=out,
                                  detail={"price": price, "delivered_to": req.recipient}, **common)["event_id"])
        return ExecResult("settled", req.request_id, ref, spent, out, req.asset_out, price, event_ids=ev)

    def usdc_value(self, balances: dict[str, Decimal], step: int) -> Decimal:
        total = Decimal(0)
        for asset, amt in balances.items():
            if self.priced(asset):
                total += amt * self.snapshot.price(asset, step)
        return total.quantize(UNIT)
