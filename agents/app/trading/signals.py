"""Quant signal algorithms.

Each algorithm reads bar closes (the latest bar's close replaced by the live
price) and returns a signal: positive is bullish, negative bearish. The engine
compares it with the plan threshold. Bounded algorithms (±0.5/±1/±2) get a
minimum threshold so they don't fire on noise.
"""

from collections.abc import Callable
from statistics import fmean, pstdev

from app.trading.analysis import atr, wilder
from app.trading.market_data import Candle

Signal = tuple[float, str]


def _sma(xs: list[float], n: int) -> float:
    return fmean(xs[-n:])


def _ema_series(xs: list[float], n: int) -> list[float]:
    k = 2 / (n + 1)
    out = [xs[0]]
    for x in xs[1:]:
        out.append(x * k + out[-1] * (1 - k))
    return out


def _clamp(v: float, lim: float) -> float:
    return float(max(-lim, min(lim, v)))


def momentum(p: list[float], c: list[Candle], lb: int) -> Signal:
    v = (p[-1] - p[-lb]) / p[-lb]
    return v, f"{lb}-bar return {v:+.4%}"


def dual_momentum(p: list[float], c: list[Candle], lb: int) -> Signal:
    s = max(2, lb // 2)
    v = ((p[-1] - p[-s]) - (p[-1] - p[-lb])) / p[-lb]
    return v, f"short vs long momentum {v:+.4%}"


def breakout(p: list[float], c: list[Candle], lb: int) -> Signal:
    prev = p[-lb - 1 : -1]
    if p[-1] > max(prev):
        return 1.0, f"broke {lb}-bar high"
    if p[-1] < min(prev):
        return -1.0, f"broke {lb}-bar low"
    return 0.0, "inside range"


def donchian(p: list[float], c: list[Candle], lb: int) -> Signal:
    hi, lo = max(p[-lb:]), min(p[-lb:])
    if hi == lo:
        return 0.0, "flat channel"
    v = _clamp((p[-1] - (hi + lo) / 2) / (hi - lo), 1)
    return v, f"channel position {v:+.2f}"


def ma_crossover(p: list[float], c: list[Candle], lb: int) -> Signal:
    fast, slow = _sma(p, max(2, lb // 2)), _sma(p, lb)
    v = (fast - slow) / slow
    return v, f"SMA{max(2, lb // 2)}/{lb} spread {v:+.4%}"


def ema_crossover(p: list[float], c: list[Candle], lb: int) -> Signal:
    fast, slow = _ema_series(p, max(2, lb // 2))[-1], _ema_series(p, lb)[-1]
    v = (fast - slow) / slow
    return v, f"EMA spread {v:+.4%}"


def macd_signal(p: list[float], c: list[Candle], lb: int) -> Signal:
    if len(p) < 35:
        return 0.0, "not enough bars for MACD"
    macd = [a - b for a, b in zip(_ema_series(p, 12), _ema_series(p, 26))]
    sig = _ema_series(macd, 9)
    v = _clamp((macd[-1] - sig[-1]) / (0.01 * p[-1]), 1)
    return v, f"MACD histogram {v:+.3f}"


def z_score(p: list[float], c: list[Candle], lb: int) -> Signal:
    w = p[-lb:]
    sd = pstdev(w)
    if sd == 0:
        return 0.0, "zero variance"
    z = (p[-1] - fmean(w)) / sd
    return _clamp(-z, 2), f"z-score {z:+.2f}"


def bollinger_reversion(p: list[float], c: list[Candle], lb: int) -> Signal:
    w = p[-lb:]
    sd = pstdev(w)
    if sd == 0:
        return 0.0, "zero variance"
    v = _clamp(-(p[-1] - fmean(w)) / (2 * sd), 1)
    return v, f"band position {-v:+.2f}"


def rsi_signal(p: list[float], c: list[Candle], lb: int) -> Signal:
    n = min(14, lb)
    deltas = [p[i] - p[i - 1] for i in range(len(p) - n * 3, len(p))]
    gains = wilder([max(d, 0) for d in deltas], n)
    losses = wilder([max(-d, 0) for d in deltas], n)
    if not gains:
        return 0.0, "not enough bars for RSI"
    rsi = 100.0 if losses[-1] == 0 else 100 - 100 / (1 + gains[-1] / losses[-1])
    if rsi <= 30:
        return 0.5, f"RSI {rsi:.1f} oversold"
    if rsi >= 70:
        return -0.5, f"RSI {rsi:.1f} overbought"
    return (50 - rsi) / 50 * 0.5, f"RSI {rsi:.1f}"


def bollinger_squeeze(p: list[float], c: list[Candle], lb: int) -> Signal:
    if len(p) < lb * 2:
        return 0.0, "not enough bars"
    now, before = pstdev(p[-lb:]), pstdev(p[-2 * lb : -lb])
    if before and now > before * 1.1:
        v = 1.0 if p[-1] > fmean(p[-lb:]) else -1.0
        return v, f"band expansion {now / before:.2f}x"
    return 0.0, "no squeeze release"


def linear_regression_channel(p: list[float], c: list[Candle], lb: int) -> Signal:
    ys = p[-lb:]
    xs = list(range(len(ys)))
    mx, my = fmean(xs), fmean(ys)
    denom = sum((x - mx) ** 2 for x in xs) or 1
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / denom
    fitted = [my + slope * (x - mx) for x in xs]
    resid = pstdev([y - f for y, f in zip(ys, fitted)])
    if resid == 0:
        return 0.0, "perfect fit"
    v = _clamp(-(ys[-1] - fitted[-1]) / resid, 2)
    return v, f"{-v:+.2f}σ from regression line"


def supertrend(p: list[float], c: list[Candle], lb: int) -> Signal:
    a = atr(c, 14)
    if a is None:
        return 0.0, "not enough candles"
    mid = (c[-1].high + c[-1].low) / 2
    upper, lower = mid + 3 * a, mid - 3 * a
    trend_up = p[-1] > _sma(p, min(lb, len(p)))
    if p[-1] > lower and trend_up:
        return 1.0, "supertrend up"
    if p[-1] < upper and not trend_up:
        return -1.0, "supertrend down"
    return 0.0, "supertrend neutral"


def atr_breakout(p: list[float], c: list[Candle], lb: int) -> Signal:
    a = atr(c[:-1], 14)
    if a is None:
        return 0.0, "not enough candles"
    bar = c[-1]
    if bar.high - bar.low > 1.5 * a:
        upper_half = p[-1] > (bar.high + bar.low) / 2
        return (1.0 if upper_half else -1.0), f"range {((bar.high - bar.low) / a):.1f}× ATR"
    return 0.0, "no range expansion"


def stochastic_signal(p: list[float], c: list[Candle], lb: int) -> Signal:
    n = min(14, lb)
    hi = max(x.high for x in c[-n:])
    lo = min(x.low for x in c[-n:])
    if hi == lo:
        return 0.0, "flat range"
    k = 100 * (p[-1] - lo) / (hi - lo)
    if k <= 20:
        return 0.5, f"%K {k:.0f} oversold"
    if k >= 80:
        return -0.5, f"%K {k:.0f} overbought"
    return (50 - k) / 50 * 0.5, f"%K {k:.0f}"


def vwap_deviation(p: list[float], c: list[Candle], lb: int) -> Signal:
    vol = sum(x.volume for x in c[-lb * 4 :]) or 1
    vwap = sum((x.high + x.low + x.close) / 3 * x.volume for x in c[-lb * 4 :]) / vol
    v = _clamp(-(p[-1] - vwap) / vwap * 20, 1)
    return v, f"{(p[-1] - vwap) / vwap:+.3%} vs VWAP"


ALGOS: dict[str, Callable[[list[float], list[Candle], int], Signal]] = {
    "momentum": momentum,
    "dual_momentum": dual_momentum,
    "breakout": breakout,
    "donchian_channel": donchian,
    "ma_crossover": ma_crossover,
    "trend_following": ma_crossover,
    "ema_crossover": ema_crossover,
    "macd_signal": macd_signal,
    "z_score": z_score,
    "mean_reversion": z_score,
    "bollinger_reversion": bollinger_reversion,
    "rsi_signal": rsi_signal,
    "bollinger_squeeze": bollinger_squeeze,
    "linear_regression_channel": linear_regression_channel,
    "supertrend": supertrend,
    "atr_breakout": atr_breakout,
    "stochastic_signal": stochastic_signal,
    "vwap_deviation": vwap_deviation,
}

# Strategies whose output is a bounded score rather than a fractional return.
BOUNDED = {
    "breakout", "donchian_channel", "macd_signal", "z_score", "mean_reversion",
    "bollinger_reversion", "rsi_signal", "bollinger_squeeze", "linear_regression_channel",
    "supertrend", "atr_breakout", "stochastic_signal", "vwap_deviation",
}
MIN_BOUNDED_THRESHOLD = 0.2


def effective_threshold(strategy: str, threshold: float) -> float:
    return max(threshold, MIN_BOUNDED_THRESHOLD) if strategy in BOUNDED else threshold


def compute_signal(strategy: str, lookback: int, closes: list[float], candles: list[Candle]) -> Signal:
    algo = ALGOS.get(strategy, momentum)
    lb = max(3, min(lookback, len(closes) - 2))
    return algo(closes, candles, lb)
