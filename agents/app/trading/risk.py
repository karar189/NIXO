"""Pre-trade risk gate. Runs before every open; the first failing rule rejects."""

import time
from dataclasses import dataclass


@dataclass(frozen=True)
class RiskLimits:
    max_leverage: int = 50
    min_notional: float = 5.0
    max_notional: float = 100_000.0
    daily_loss_cap: float = 500.0
    strategy_loss_streak: int = 5
    strategy_loss_cap: float = 300.0


LIMITS = RiskLimits()


@dataclass
class RiskDecision:
    approved: bool
    reason: str


def check_open(
    *,
    has_position: bool,
    leverage: float,
    margin: float,
    market_max_leverage: int,
    closed_trades: list[dict],
    strategy: str | None,
    disabled_strategies: set[str],
    limits: RiskLimits = LIMITS,
) -> RiskDecision:
    notional = margin * leverage
    if has_position:
        return RiskDecision(False, "A position is already open")
    cap = min(limits.max_leverage, market_max_leverage)
    if leverage > cap:
        return RiskDecision(False, f"Leverage {leverage:g}x exceeds the {cap}x cap")
    if notional < limits.min_notional:
        return RiskDecision(False, f"Position size ${notional:,.2f} is below the ${limits.min_notional:g} minimum")
    if notional > limits.max_notional:
        return RiskDecision(False, f"Position size ${notional:,.0f} exceeds the ${limits.max_notional:,.0f} cap")

    day_ago = time.time() - 86_400
    day_loss = -sum(t["pnl"] for t in closed_trades if t["closed_at"] >= day_ago and t["pnl"] < 0)
    if day_loss >= limits.daily_loss_cap:
        return RiskDecision(False, f"Daily loss cap reached (${day_loss:,.2f} of ${limits.daily_loss_cap:,.0f})")

    if strategy:
        if strategy in disabled_strategies:
            return RiskDecision(False, f"Strategy '{strategy}' is paused by its circuit breaker")
        recent = [t for t in closed_trades if t.get("strategy") == strategy][-limits.strategy_loss_streak :]
        if len(recent) == limits.strategy_loss_streak and all(t["pnl"] <= 0 for t in recent):
            disabled_strategies.add(strategy)
            return RiskDecision(False, f"'{strategy}' lost {limits.strategy_loss_streak} trades in a row; paused")
        loss = -sum(t["pnl"] for t in recent if t["pnl"] < 0)
        if loss >= limits.strategy_loss_cap:
            disabled_strategies.add(strategy)
            return RiskDecision(False, f"'{strategy}' lost ${loss:,.2f} over its last trades; paused")

    return RiskDecision(True, "approved")
