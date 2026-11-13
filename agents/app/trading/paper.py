"""Paper positions with leverage, TP/SL and isolated-margin liquidation.

Entry and exit prices come from 1Click fills, so PnL already includes solver
fees and slippage. Leverage is simulated: NEAR Intents settles spot swaps, so
a live position can only be 1x long (buy spot) or flat.
"""

import time
from dataclasses import asdict, dataclass, field
from typing import Literal

from app.trading.oneclick import Fill

Side = Literal["LONG", "SHORT"]
MAINTENANCE_MARGIN = 0.005  # 0.5% of notional


def liquidation_price(side: Side, entry: float, leverage: float) -> float | None:
    if leverage <= 1:
        return None  # fully collateralised; can't be liquidated
    if side == "LONG":
        return entry * (1 - 1 / leverage + MAINTENANCE_MARGIN)
    return entry * (1 + 1 / leverage - MAINTENANCE_MARGIN)


@dataclass
class Position:
    side: Side
    margin: float  # USDC committed
    leverage: float
    qty: float  # asset units
    entry_price: float  # effective fill price (USDC per unit)
    entry_usdc: float  # USDC spent (long) or received (short)
    tp_price: float | None
    sl_price: float | None
    liq_price: float | None
    entry_fill: dict
    opened_at: float = field(default_factory=time.time)
    strategy: str | None = None

    @property
    def notional(self) -> float:
        return self.margin * self.leverage

    def unrealized(self, mark: float) -> float:
        raw = self.qty * mark - self.entry_usdc if self.side == "LONG" else self.entry_usdc - self.qty * mark
        return max(raw, -self.margin)

    def realized_from_exit(self, exit_fill: Fill) -> float:
        if self.side == "LONG":
            raw = exit_fill.usdc - self.entry_usdc  # sold qty for exit_fill.usdc
        else:
            raw = self.entry_usdc - self.qty * exit_fill.price  # bought qty back
        return max(raw, -self.margin)

    def trigger(self, mark: float) -> str | None:
        """Return the exit reason if TP, SL or liquidation is hit at `mark`."""
        long = self.side == "LONG"
        if self.liq_price is not None and (mark <= self.liq_price if long else mark >= self.liq_price):
            return "LIQUIDATED"
        if self.sl_price is not None and (mark <= self.sl_price if long else mark >= self.sl_price):
            return "STOP_LOSS"
        if self.tp_price is not None and (mark >= self.tp_price if long else mark <= self.tp_price):
            return "TAKE_PROFIT"
        return None

    def snapshot(self, mark: float | None) -> dict:
        d = asdict(self)
        d["notional"] = self.notional
        if mark is not None:
            u = self.unrealized(mark)
            d["mark_price"] = mark
            d["unrealized_pnl"] = u
            d["roe_pct"] = u / self.margin * 100 if self.margin else 0.0
        return d


def levels_from_pct(side: Side, entry: float, tp_pct: float | None, sl_pct: float | None) -> tuple[float | None, float | None]:
    """Convert TP/SL given as a fraction of price move (0.02 = 2%) into prices."""
    sign = 1 if side == "LONG" else -1
    tp = entry * (1 + sign * tp_pct) if tp_pct else None
    sl = entry * (1 - sign * sl_pct) if sl_pct else None
    return tp, sl


def levels_from_atr(side: Side, entry: float, atr_value: float | None, rr: float = 2.0) -> tuple[float, float]:
    """Dynamic TP/SL: stop at 2×ATR (or 3% if ATR is unknown), target at `rr`×risk."""
    dist = 2 * atr_value if atr_value else entry * 0.03
    sign = 1 if side == "LONG" else -1
    return entry + sign * rr * dist, entry - sign * dist


def validate_levels(side: Side, entry: float, tp: float | None, sl: float | None) -> None:
    long = side == "LONG"
    if tp is not None and (tp <= entry if long else tp >= entry):
        raise ValueError(f"Take profit must be {'above' if long else 'below'} the entry price ({entry:.6g}).")
    if sl is not None and (sl >= entry if long else sl <= entry):
        raise ValueError(f"Stop loss must be {'below' if long else 'above'} the entry price ({entry:.6g}).")
