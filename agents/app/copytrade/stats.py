"""Public performance of a trader's agent trades.

Only aggregate numbers leave here: PnL, ROE, win rate, drawdown, counts and a
cumulative-PnL curve. Symbols, sides, prices and sizes stay in the encrypted feed.
"""

from __future__ import annotations

PUBLIC_FIELDS = (
    "total_pnl", "total_margin", "roe_pct", "trades", "wins", "win_rate", "avg_win", "avg_loss",
    "max_drawdown", "first_trade_at", "last_trade_at", "equity",
)


def agent_trades(trades: list[dict]) -> list[dict]:
    """The trader's own agent trades: no manual positions, no mirrored copies."""
    return [t for t in trades if t.get("mode") == "agent" and not t.get("copy_of")]


def public_stats(trades: list[dict], curve_points: int = 120) -> dict:
    ts = sorted(agent_trades(trades), key=lambda t: t.get("closed_at", 0))
    pnls = [float(t["pnl"]) for t in ts]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]
    margin = sum(float(t.get("margin", 0)) for t in ts)

    cum, peak, max_dd = 0.0, 0.0, 0.0
    equity: list[list[float]] = []
    for t, p in zip(ts, pnls):
        cum += p
        peak = max(peak, cum)
        max_dd = max(max_dd, peak - cum)
        equity.append([round(float(t.get("closed_at", 0)), 3), round(cum, 2)])
    if len(equity) > curve_points:
        step = len(equity) / curve_points
        equity = [equity[int(i * step)] for i in range(curve_points - 1)] + [equity[-1]]

    return {
        "total_pnl": round(sum(pnls), 2),
        "total_margin": round(margin, 2),
        "roe_pct": round(sum(pnls) / margin * 100, 2) if margin else 0.0,
        "trades": len(ts),
        "wins": len(wins),
        "win_rate": round(len(wins) / len(ts), 4) if ts else 0.0,
        "avg_win": round(sum(wins) / len(wins), 2) if wins else 0.0,
        "avg_loss": round(sum(losses) / len(losses), 2) if losses else 0.0,
        "max_drawdown": round(max_dd, 2),
        "first_trade_at": ts[0].get("closed_at") if ts else None,
        "last_trade_at": ts[-1].get("closed_at") if ts else None,
        "equity": equity,
    }
