"""Auto-mirror: copy a trader's agent positions into a follower's paper account.

When the trader's agent opens a position, every follower with mirroring on and
an active on-chain subscription gets a manual paper position: same market, side,
take-profit and stop-loss, with size and leverage capped by the follower's own
limits. When the trader's position closes, the copy closes too. A copy can also
close earlier on its own TP/SL. Copies are paper fills priced by 1Click dry-run
quotes, so no funds move.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import asdict, dataclass, field

from pydantic import BaseModel, Field

from app.copytrade.subscriptions import ChainSubscriptions, sub_active
from app.trading import market_data
from app.trading.engine import Engine, EngineError, ManualOrder
from app.trading.market_data import MarketDataError

log = logging.getLogger(__name__)


class MirrorSettings(BaseModel):
    trader: str = Field(min_length=2, max_length=64)
    enabled: bool = True
    scale: float = Field(1.0, gt=0, le=10, description="Copy margin = trader margin x scale")
    max_margin_usdc: float = Field(1000, gt=0, le=1_000_000)
    max_leverage: float = Field(5, ge=1, le=50)
    max_total_loss_usdc: float = Field(500, gt=0, le=1_000_000, description="Mirroring pauses at this loss")


@dataclass
class MirrorState:
    follower: str
    trader: str
    enabled: bool
    scale: float
    max_margin_usdc: float
    max_leverage: float
    max_total_loss_usdc: float
    realized_pnl: float = 0.0
    copies_opened: int = 0
    copies_closed: int = 0
    paused_reason: str | None = None
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return asdict(self)


class Mirror:
    def __init__(self, engine: Engine, subs: ChainSubscriptions, clock=time.time):
        self.engine = engine
        self.subs = subs
        self.clock = clock
        self._configs: dict[tuple[str, str], MirrorState] = {}  # (follower, trader)
        self._logs: dict[str, deque] = {}

    # ------------------------------------------------------------ config

    def configure(self, follower: str, s: MirrorSettings) -> MirrorState:
        key = (follower, s.trader)
        prev = self._configs.get(key)
        state = MirrorState(follower=follower, **s.model_dump())
        if prev:  # keep running totals across edits
            state.realized_pnl, state.copies_opened, state.copies_closed = (
                prev.realized_pnl, prev.copies_opened, prev.copies_closed)
            state.created_at = prev.created_at
        self._configs[key] = state
        self._log(follower, s.trader, "info",
                  f"Auto-mirror {'on' if s.enabled else 'off'} for {s.trader}: scale {s.scale:g}x, "
                  f"max ${s.max_margin_usdc:,.0f} margin, max {s.max_leverage:g}x, stop at -${s.max_total_loss_usdc:,.0f}")
        return state

    def configs_of(self, follower: str) -> list[dict]:
        return [c.to_dict() for (f, _), c in self._configs.items() if f == follower]

    def log_of(self, follower: str, limit: int = 100) -> list[dict]:
        return list(self._logs.get(follower, []))[-limit:][::-1]

    def _log(self, follower: str, trader: str, level: str, message: str) -> None:
        self._logs.setdefault(follower, deque(maxlen=200)).append(
            {"ts": self.clock(), "trader": trader, "level": level, "message": message})

    # ------------------------------------------------------------ events

    async def on_trader_event(self, ev: dict) -> None:
        trader = ev["account"]
        for state in [c for (_, t), c in self._configs.items() if t == trader and c.enabled]:
            try:
                if ev["type"] == "OPEN":
                    await self._copy_open(state, ev)
                elif ev["type"] == "CLOSE":
                    await self._copy_close(state, ev)
            except Exception as err:  # one follower's failure never blocks the others
                log.exception("mirror failed for %s", state.follower)
                self._log(state.follower, trader, "error", f"Mirror error: {err}")

    async def on_copy_event(self, ev: dict) -> None:
        """A mirrored position closed (copy of the trader's close, or its own TP/SL)."""
        if ev["type"] != "CLOSE" or not ev.get("copy_of"):
            return
        trader = ev["copy_of"][0]
        state = self._configs.get((ev["account"], trader))
        if not state:
            return
        pnl = float(ev["trade"]["pnl"])
        state.realized_pnl += pnl
        state.copies_closed += 1
        t = ev["trade"]
        self._log(state.follower, trader, "action",
                  f"Copy closed: {t['side']} {t['symbol']} ({t['close_reason'].replace('_', ' ').lower()}) "
                  f"PnL ${pnl:+,.2f}. Mirror total ${state.realized_pnl:+,.2f}")
        if state.realized_pnl <= -state.max_total_loss_usdc and state.enabled:
            state.enabled = False
            state.paused_reason = "loss cap reached"
            self._log(state.follower, trader, "warn",
                      f"Loss cap -${state.max_total_loss_usdc:,.0f} reached: auto-mirror paused.")

    async def _copy_open(self, state: MirrorState, ev: dict) -> None:
        follower, trader = state.follower, state.trader
        sub = await self.subs.subscription(trader, follower)
        if not sub_active(sub, self.clock()):
            self._log(follower, trader, "warn", "Skipped a trade: no active subscription to this trader.")
            return
        if state.realized_pnl <= -state.max_total_loss_usdc:
            state.enabled, state.paused_reason = False, "loss cap reached"
            self._log(follower, trader, "warn", "Skipped a trade: loss cap reached, auto-mirror paused.")
            return
        current = self.engine.sessions.get(follower)
        if current and current.running:
            self._log(follower, trader, "warn",
                      f"Skipped {ev['side']} {ev['symbol']}: you already have a session running on {current.market.pair}.")
            return

        margin = min(float(ev["margin"]) * state.scale, state.max_margin_usdc)
        leverage = min(float(ev["leverage"]), state.max_leverage)
        order = ManualOrder(
            symbol=ev["symbol"], side=ev["side"], amount_usdc=round(margin, 2), leverage=leverage,
            tp_mode="price" if ev.get("tp") else "none", tp=ev.get("tp"),
            sl_mode="price" if ev.get("sl") else "none", sl=ev.get("sl"),
        )
        try:
            await self.engine.open_manual(follower, order, copy_of=(trader, ev["session_id"]))
        except (EngineError, ValueError) as err:
            self._log(follower, trader, "warn", f"Skipped {ev['side']} {ev['symbol']}: {err}")
            return
        state.copies_opened += 1
        self._log(follower, trader, "action",
                  f"Copied {ev['side']} {ev['symbol']}: ${margin:,.2f} margin at {leverage:g}x "
                  f"(trader: ${float(ev['margin']):,.2f} at {float(ev['leverage']):g}x).")

    async def _copy_close(self, state: MirrorState, ev: dict) -> None:
        session = self.engine.sessions.get(state.follower)
        if session and session.running and session.copy_of == (state.trader, ev["session_id"]):
            try:  # close at a fresh mark, not the copy's last tick
                session.last_price = await market_data.get_price(session.market.binance_symbol)
            except MarketDataError:
                pass
            await self.engine.stop(state.follower, close_position=True)
