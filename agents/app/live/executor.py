"""Autonomous live execution: the AI agent swaps spot through NEAR Intents.

One dedicated NEAR mainnet account (NIXO_AGENT_ACCOUNT) holds the agent's
funds; the service holds its key. For every trade:

1. Guardrails: kill switch, market allowlist, per-trade cap, rolling 24h budget,
   balance and gas checks.
2. A real (non-dry) 1Click quote with depositType ORIGIN_CHAIN. Recipient and
   refund address are always the agent account; this is checked in the
   returned quote too. The price must be within NIXO_LIVE_MAX_DEVIATION_BPS of
   the mark, and slippage within NIXO_LIVE_MAX_SLIPPAGE_BPS.
3. One transaction from the agent account: register the deposit address on the
   token if needed, then `ft_transfer` exactly the amount we chose.
4. Submit the tx hash to 1Click and poll until SUCCESS, REFUNDED or FAILED.

Every step is written to an append-only ledger (agents/.nixo_live/orders.jsonl).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Awaitable, Callable

from app.config import settings
from app.live.near import TGAS, FunctionCall, KeyPair, NearRpc, RpcError, Signer, outcome_failure
from app.trading import oneclick
from app.trading.markets import MARKETS, USDC_DECIMALS, USDC_NEAR, Market

log = logging.getLogger(__name__)

USDC_CONTRACT = USDC_NEAR.removeprefix("nep141:")
STORE_DIR = Path(__file__).resolve().parents[2] / ".nixo_live"
GAS_RESERVE_YOCTO = 50 * 10**21  # 0.05 NEAR kept for gas and storage
DEPOSIT_ADDR_RE = re.compile(r"^([0-9a-f]{64}|(([a-z\d]+[-_])*[a-z\d]+\.)+([a-z\d]+[-_])*[a-z\d]+)$")
INTENTS_EXPLORER = "https://explorer.near-intents.org/transactions/"
NEARBLOCKS_TX = "https://nearblocks.io/txns/"


class LiveError(RuntimeError):
    pass


@dataclass
class LiveFill:
    price: float  # USDC per asset unit, from amounts actually settled
    qty: float  # asset (whole units) bought or sold
    usdc: float  # USDC spent (buy) or received (sell)
    units_in: int
    units_out: int
    reference_price: float
    slippage_bps: float
    order_id: str
    deposit_address: str
    tx_hash: str


def _fmt_units(units: int, decimals: int) -> float:
    return units / 10**decimals


class LiveAgent:
    def __init__(self, *, cfg=settings, rpc: NearRpc | None = None, signer: Signer | None = None,
                 quote_fn: Callable[[dict], Awaitable[dict]] | None = None,
                 status_fn: Callable[..., Awaitable[dict]] | None = None,
                 submit_fn: Callable[..., Awaitable[dict]] | None = None,
                 clock=time.time, sleep=asyncio.sleep, store_dir: Path | None = None, poll_secs: float = 3.0):
        self.cfg = cfg
        self.rpc = rpc or NearRpc(cfg.live_rpc)
        self._signer = signer
        self.quote_fn = quote_fn or oneclick.quote
        self.status_fn = status_fn or oneclick.status
        self.submit_fn = submit_fn or oneclick.submit_deposit
        self.clock = clock
        self.sleep = sleep
        self.poll_secs = poll_secs
        self.store_dir = store_dir if store_dir is not None else (Path(cfg.live_store_dir) if cfg.live_store_dir else STORE_DIR)
        self.orders: list[dict] = self._load()

    # ------------------------------------------------------------ config

    @property
    def account(self) -> str | None:
        return self.cfg.agent_account

    def problems(self) -> list[str]:
        out = []
        if not self.cfg.agent_account:
            out.append("NIXO_AGENT_ACCOUNT is not set")
        if not self.cfg.agent_private_key:
            out.append("NIXO_AGENT_PRIVATE_KEY is not set")
        if not self.cfg.agent_owner:
            out.append("NIXO_AGENT_OWNER is not set")
        if not self.cfg.live_enabled:
            out.append("NIXO_LIVE_ENABLED is off (kill switch)")
        return out

    @property
    def configured(self) -> bool:
        return bool(self.cfg.agent_account and self.cfg.agent_private_key and self.cfg.agent_owner)

    @property
    def enabled(self) -> bool:
        return self.configured and bool(self.cfg.live_enabled)

    def markets(self) -> list[Market]:
        wanted = {s.strip().upper() for s in self.cfg.live_markets.split(",") if s.strip()}
        return [m for m in MARKETS.values() if m.agent_asset and m.symbol in wanted]

    def signer(self) -> Signer:
        if self._signer is None:
            if not self.configured:
                raise LiveError("Live agent is not configured: " + "; ".join(self.problems()))
            kp = KeyPair.from_string(self.cfg.agent_private_key.get_secret_value())
            self._signer = Signer(self.cfg.agent_account, kp, self.rpc)
        return self._signer

    def check_session(self, *, account: str, symbol: str, leverage: float, amount_usdc: float) -> None:
        """Called before a live session starts; raises LiveError with a plain reason."""
        if not self.enabled:
            raise LiveError("Live agent is off: " + "; ".join(self.problems()))
        if account != self.cfg.agent_owner:
            raise LiveError(f"Only {self.cfg.agent_owner} can run the live agent")
        if symbol not in {m.symbol for m in self.markets()}:
            raise LiveError(f"{symbol} isn't enabled for live trading (NIXO_LIVE_MARKETS={self.cfg.live_markets})")
        if leverage != 1:
            raise LiveError("Live trades are spot swaps through NEAR Intents: set leverage to 1x")
        if amount_usdc > self.cfg.live_max_trade_usdc:
            raise LiveError(f"Per-trade size {amount_usdc:g} USDC is above the cap of {self.cfg.live_max_trade_usdc:g}")
        if amount_usdc < self.cfg.live_min_trade_usdc:
            raise LiveError(f"Per-trade size must be at least {self.cfg.live_min_trade_usdc:g} USDC")

    # ------------------------------------------------------------ ledger

    def _load(self) -> list[dict]:
        path = self.store_dir / "orders.jsonl"
        if not path.exists():
            return []
        latest: dict[str, dict] = {}
        for line in path.read_text().splitlines():
            if line.strip():
                o = json.loads(line)
                latest[o["order_id"]] = o
        return list(latest.values())

    def _save(self, order: dict) -> None:
        order["updated_at"] = self.clock()
        if order not in self.orders:
            self.orders.append(order)
        try:
            self.store_dir.mkdir(parents=True, exist_ok=True)
            with (self.store_dir / "orders.jsonl").open("a") as f:
                f.write(json.dumps(order) + "\n")
        except OSError:
            log.exception("could not write live ledger")

    def spent_24h(self) -> float:
        cutoff = self.clock() - 86400
        return sum(o["usdc_in"] for o in self.orders
                   if o["side"] == "BUY" and o["created_at"] >= cutoff and o.get("tx_hash")
                   and o["status"] not in ("REFUNDED", "FAILED", "TX_FAILED"))

    # ------------------------------------------------------------ chain reads

    async def ft_balance(self, contract: str) -> int:
        return int(await self.rpc.view(contract, "ft_balance_of", {"account_id": self.account}) or 0)

    async def balances(self) -> dict:
        if not self.account:
            return {}
        out: dict = {"account": self.account}
        try:
            acct = await self.rpc.account(self.account)
            out["near_yocto"] = acct.get("amount")
            out["usdc"] = _fmt_units(await self.ft_balance(USDC_CONTRACT), USDC_DECIMALS)
            for m in self.markets():
                out[m.symbol] = _fmt_units(await self.ft_balance(m.agent_contract), m.agent_decimals)
        except Exception as err:
            out["error"] = str(err)[:200]
        return out

    async def _registered(self, contract: str, account: str) -> bool:
        return await self.rpc.view(contract, "storage_balance_of", {"account_id": account}) is not None

    async def _storage_min(self, contract: str) -> int:
        return int((await self.rpc.view(contract, "storage_balance_bounds"))["min"])

    # ------------------------------------------------------------ trades

    async def buy(self, market: Market, usdc: float, mark: float) -> LiveFill:
        if usdc > self.cfg.live_max_trade_usdc + 1e-9:
            raise LiveError(f"{usdc:g} USDC is above the per-trade cap of {self.cfg.live_max_trade_usdc:g}")
        if usdc < self.cfg.live_min_trade_usdc:
            raise LiveError(f"{usdc:g} USDC is below the minimum trade of {self.cfg.live_min_trade_usdc:g}")
        if self.spent_24h() + usdc > self.cfg.live_daily_budget_usdc + 1e-9:
            raise LiveError(f"24h budget reached ({self.spent_24h():.2f} of {self.cfg.live_daily_budget_usdc:g} USDC spent)")
        units = int(round(usdc * 10**USDC_DECIMALS))
        return await self._swap("BUY", market, units, mark)

    async def sell(self, market: Market, units: int, mark: float) -> LiveFill:
        held = await self.ft_balance(market.agent_contract)
        units = min(units, held)
        if units <= 0:
            raise LiveError(f"Agent account holds no {market.symbol} to sell")
        return await self._swap("SELL", market, units, mark)

    async def _swap(self, side: str, market: Market, amount_units: int, mark: float) -> LiveFill:
        if not self.enabled:
            raise LiveError("Live agent is off: " + "; ".join(self.problems()))
        if market.symbol not in {m.symbol for m in self.markets()}:
            raise LiveError(f"{market.symbol} isn't enabled for live trading")
        agent = self.account
        assert agent and market.agent_asset and market.agent_contract and market.agent_decimals is not None
        buying = side == "BUY"
        origin_asset, origin_contract, origin_dec = (
            (USDC_NEAR, USDC_CONTRACT, USDC_DECIMALS) if buying else (market.agent_asset, market.agent_contract, market.agent_decimals))
        dest_asset, dest_contract, dest_dec = (
            (market.agent_asset, market.agent_contract, market.agent_decimals) if buying else (USDC_NEAR, USDC_CONTRACT, USDC_DECIMALS))

        # Balances and gas before asking for a deposit address.
        if await self.ft_balance(origin_contract) < amount_units:
            raise LiveError(f"Agent account has less than {_fmt_units(amount_units, origin_dec):g} "
                            f"{'USDC' if buying else market.symbol}")
        acct = await self.rpc.account(agent)
        if int(acct["amount"]) < GAS_RESERVE_YOCTO:
            raise LiveError("Agent account needs at least 0.05 NEAR for gas and storage")

        body = {
            "dry": False,
            "swapType": "EXACT_INPUT",
            "slippageTolerance": self.cfg.live_max_slippage_bps,
            "originAsset": origin_asset,
            "destinationAsset": dest_asset,
            "amount": str(amount_units),
            "depositType": "ORIGIN_CHAIN",
            "recipient": agent,
            "recipientType": "DESTINATION_CHAIN",
            "refundTo": agent,
            "refundType": "ORIGIN_CHAIN",
        }
        if settings.oneclick_jwt:
            body["confidentiality"] = "basic"
        try:
            q = await self.quote_fn(body)
        except oneclick.OneClickError as err:
            raise LiveError(f"1Click quote failed: {err}") from err

        quote = q.get("quote") or {}
        deposit = str(quote.get("depositAddress") or "")
        echoed = q.get("quoteRequest") or {}
        if not DEPOSIT_ADDR_RE.match(deposit):
            raise LiveError("1Click returned no usable deposit address")
        if echoed and (echoed.get("recipient") != agent or echoed.get("refundTo") != agent):
            raise LiveError("Quote recipient/refund address isn't the agent account; refusing")
        if str(quote.get("amountIn", amount_units)) != str(amount_units):
            raise LiveError("Quote amount doesn't match the order; refusing")
        out_units = int(quote["amountOut"])
        in_amt, out_amt = _fmt_units(amount_units, origin_dec), _fmt_units(out_units, dest_dec)
        price = in_amt / out_amt if buying else out_amt / in_amt
        deviation = ((price - mark) / mark if buying else (mark - price) / mark) * 10_000
        if deviation > self.cfg.live_max_mark_deviation_bps:
            raise LiveError(f"Quote is {deviation:.0f} bps worse than the mark ({price:.6g} vs {mark:.6g}); skipped")

        order = {
            "order_id": f"live_{uuid.uuid4().hex[:12]}", "side": side, "symbol": market.symbol,
            "usdc_in": in_amt if buying else 0.0, "amount_in_units": str(amount_units),
            "quoted_out_units": str(out_units), "quoted_price": price, "mark": mark,
            "deviation_bps": round(deviation, 1), "deposit_address": deposit,
            "correlation_id": q.get("correlationId"), "status": "QUOTED", "tx_hash": None,
            "created_at": self.clock(), "explorer": INTENTS_EXPLORER + deposit,
        }
        self._save(order)

        # One transaction from the agent: optional registrations, then the transfer.
        signer = self.signer()
        try:
            if not await self._registered(dest_contract, agent):
                tx, res = await signer.send(dest_contract, [FunctionCall(
                    "storage_deposit", {"account_id": agent, "registration_only": True}, 30 * TGAS,
                    await self._storage_min(dest_contract))])
                if (fail := outcome_failure(res)) is not None:
                    raise LiveError(f"Registering the agent on {dest_contract} failed: {fail}")
            actions = []
            if not await self._registered(origin_contract, deposit):
                actions.append(FunctionCall("storage_deposit", {"account_id": deposit, "registration_only": True},
                                            30 * TGAS, await self._storage_min(origin_contract)))
            actions.append(FunctionCall("ft_transfer", {"receiver_id": deposit, "amount": str(amount_units)}, 30 * TGAS, 1))
            tx_hash, res = await signer.send(origin_contract, actions)
        except RpcError as err:
            order["status"] = "TX_FAILED"
            order["error"] = str(err)[:300]
            self._save(order)
            raise LiveError(f"Transaction failed: {err}") from err
        order["tx_hash"] = tx_hash
        order["tx_explorer"] = NEARBLOCKS_TX + tx_hash
        if (fail := outcome_failure(res)) is not None:
            order["status"], order["error"] = "TX_FAILED", fail
            self._save(order)
            raise LiveError(f"Deposit transfer failed on-chain: {fail}")
        order["status"] = "PENDING_DEPOSIT"
        self._save(order)

        try:
            await self.submit_fn(deposit, tx_hash, agent)
        except Exception:
            pass  # optional speed-up; 1Click also detects the deposit itself

        # Wait for settlement.
        deadline = self.clock() + self.cfg.live_swap_timeout_secs
        st: dict = {}
        while self.clock() < deadline:
            await self.sleep(self.poll_secs)
            try:
                st = await self.status_fn(deposit)
            except Exception:
                continue
            status = st.get("status", "")
            if status != order["status"]:
                order["status"] = status
                self._save(order)
            if status in ("SUCCESS", "REFUNDED", "FAILED"):
                break
        else:
            raise LiveError(f"Swap still {order['status']} after {self.cfg.live_swap_timeout_secs:.0f}s. "
                            f"Funds settle to or refund to {agent}; track it at {order['explorer']}")

        if order["status"] != "SUCCESS":
            raise LiveError(f"Swap {order['status'].lower()}: funds were returned to {agent}")
        details = st.get("swapDetails") or {}
        if details.get("amountOut"):
            got = int(details["amountOut"])
        elif details.get("amountOutFormatted"):
            got = int(Decimal(str(details["amountOutFormatted"])) * 10**dest_dec)
        else:
            got = out_units
        out_amt = _fmt_units(got, dest_dec)
        price = in_amt / out_amt if buying else out_amt / in_amt
        order.update({"amount_out_units": str(got), "price": price})
        self._save(order)
        slip = ((price - mark) / mark if buying else (mark - price) / mark) * 10_000
        return LiveFill(
            price=price, qty=out_amt if buying else in_amt, usdc=in_amt if buying else out_amt,
            units_in=amount_units, units_out=got, reference_price=mark, slippage_bps=round(slip, 2),
            order_id=order["order_id"], deposit_address=deposit, tx_hash=tx_hash,
        )

    # ------------------------------------------------------------ views

    def public_status(self) -> dict:
        return {
            "configured": self.configured,
            "enabled": self.enabled,
            "problems": self.problems(),
            "account": self.account,
            "owner": self.cfg.agent_owner,
            "markets": [m.symbol for m in self.markets()],
            "caps": {
                "max_trade_usdc": self.cfg.live_max_trade_usdc,
                "min_trade_usdc": self.cfg.live_min_trade_usdc,
                "daily_budget_usdc": self.cfg.live_daily_budget_usdc,
                "max_slippage_bps": self.cfg.live_max_slippage_bps,
                "max_mark_deviation_bps": self.cfg.live_max_mark_deviation_bps,
            },
            "spent_24h_usdc": round(self.spent_24h(), 2),
            "confidential": bool(settings.oneclick_jwt),
            "orders": sorted(self.orders, key=lambda o: o["created_at"], reverse=True)[:25],
        }


live_agent = LiveAgent()
