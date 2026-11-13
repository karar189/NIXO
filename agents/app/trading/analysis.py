"""Market regime features and the strategy shortlist fed to the planner."""

import math
from statistics import fmean, pstdev

from app.trading.market_data import BARS_PER_YEAR, Candle


def true_ranges(candles: list[Candle]) -> list[float]:
    out = []
    for i, c in enumerate(candles):
        if i == 0:
            out.append(c.high - c.low)
            continue
        prev = candles[i - 1].close
        out.append(max(c.high - c.low, abs(c.high - prev), abs(c.low - prev)))
    return out


def wilder(values: list[float], period: int) -> list[float]:
    """Wilder's smoothing (RMA). Returns a list aligned to `values[period-1:]`."""
    if len(values) < period:
        return []
    out = [fmean(values[:period])]
    for v in values[period:]:
        out.append((out[-1] * (period - 1) + v) / period)
    return out


def atr(candles: list[Candle], period: int = 14) -> float | None:
    smoothed = wilder(true_ranges(candles), period)
    return smoothed[-1] if smoothed else None


def adx(candles: list[Candle], period: int = 14) -> float | None:
    if len(candles) < period * 2 + 1:
        return None
    plus_dm, minus_dm = [], []
    for i in range(1, len(candles)):
        up = candles[i].high - candles[i - 1].high
        down = candles[i - 1].low - candles[i].low
        plus_dm.append(up if up > down and up > 0 else 0.0)
        minus_dm.append(down if down > up and down > 0 else 0.0)
    tr = true_ranges(candles)[1:]
    tr_s, p_s, m_s = wilder(tr, period), wilder(plus_dm, period), wilder(minus_dm, period)
    dx = []
    for t, p, m in zip(tr_s, p_s, m_s):
        if t == 0:
            dx.append(0.0)
            continue
        pdi, mdi = 100 * p / t, 100 * m / t
        dx.append(0.0 if pdi + mdi == 0 else 100 * abs(pdi - mdi) / (pdi + mdi))
    smoothed = wilder(dx, period)
    return smoothed[-1] if smoothed else None


def realized_vol(closes: list[float], window: int, timeframe: str) -> float | None:
    window = min(window, len(closes) - 1)
    if window < 10:
        return None
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(len(closes) - window, len(closes))]
    return pstdev(rets) * math.sqrt(BARS_PER_YEAR.get(timeframe, 35_040))


def compute_summary(symbol: str, timeframe: str, candles: list[Candle], change_24h: float | None) -> dict:
    closes = [c.close for c in candles]
    last = closes[-1]
    a = atr(candles)
    vol_recent = realized_vol(closes, 96, timeframe)
    vol_medium = realized_vol(closes, len(closes) - 1, timeframe)

    def range_of(n: int) -> float:
        window = candles[-n:]
        return max(c.high for c in window) - min(c.low for c in window)

    r10, r20 = range_of(10), range_of(20)
    ratio = r10 / r20 if r20 else 1.0
    bodies = [abs(c.close - c.open) for c in candles[-50:]]
    ranges = [max(c.high - c.low, 1e-12) for c in candles[-50:]]

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "bar_count": len(candles),
        "last_price": last,
        "change_24h_pct": change_24h,
        "atr": a,
        "atr_pct": (a / last) if a else None,
        "realized_vol_recent": vol_recent,
        "realized_vol_medium": vol_medium,
        "vol_ratio": (vol_recent / vol_medium) if vol_recent and vol_medium else None,
        "adx": adx(candles),
        "ma_slope": (last - closes[-20]) / closes[-20] if len(closes) >= 20 else None,
        "range_compression": ratio < 0.7,
        "range_expansion": ratio > 1.3,
        "spread_proxy": fmean((c.high - c.low) / c.close for c in candles[-50:]),
        "wickiness": 1 - fmean(b / r for b, r in zip(bodies, ranges)),
    }


def shortlist(summary: dict) -> list[str]:
    adx_v = summary.get("adx") or 0.0
    vol = summary.get("realized_vol_recent") or 0.0
    ranging = summary.get("range_compression") or adx_v < 20
    expanding = summary.get("range_expansion")
    picks: list[str] = []
    # Crypto annualised vol commonly sits between 0.3 and 1.2.
    if adx_v > 25 and 0.1 < vol < 1.5:
        picks += ["trend_following", "ma_crossover", "ema_crossover"]
    if adx_v > 30:
        picks += ["breakout", "donchian_channel", "macd_signal", "supertrend"]
    if ranging:
        picks += ["mean_reversion", "z_score", "bollinger_reversion", "rsi_signal"]
    if ranging and expanding:
        picks += ["bollinger_squeeze", "linear_regression_channel"]
    if expanding and not ranging:
        picks += ["atr_breakout", "breakout"]
    picks.append("momentum")
    seen: set[str] = set()
    return [p for p in picks if not (p in seen or seen.add(p))]
