"""Public Binance spot market data (prices, 24h stats, candles).

Tries each base URL in order so a blocked host doesn't take the engine down.
"""

import time
from dataclasses import dataclass

import httpx

from app.config import settings

TIMEFRAMES = {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d"}

# Bars per year, used to annualise realised volatility for each timeframe.
BARS_PER_YEAR = {
    "1m": 525_600,
    "3m": 175_200,
    "5m": 105_120,
    "15m": 35_040,
    "30m": 17_520,
    "1h": 8_760,
    "2h": 4_380,
    "4h": 2_190,
    "6h": 1_460,
    "12h": 730,
    "1d": 365,
}


@dataclass
class Candle:
    open_time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class MarketDataError(RuntimeError):
    pass


_client: httpx.AsyncClient | None = None
_price_cache: dict[str, tuple[float, float]] = {}  # symbol -> (ts, price)


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=settings.http_timeout_seconds)
    return _client


async def _get(path: str, params: dict) -> object:
    last_error: Exception | None = None
    for base in settings.binance_urls:
        try:
            res = await _http().get(f"{base}{path}", params=params)
            res.raise_for_status()
            return res.json()
        except (httpx.HTTPError, ValueError) as err:
            last_error = err
    raise MarketDataError(f"Market data unavailable for {path}: {last_error}")


async def get_price(binance_symbol: str, max_age: float = 1.0) -> float:
    """Latest trade price, cached briefly so many sessions share one request."""
    cached = _price_cache.get(binance_symbol)
    now = time.monotonic()
    if cached and now - cached[0] < max_age:
        return cached[1]
    data = await _get("/api/v3/ticker/price", {"symbol": binance_symbol})
    price = float(data["price"])  # type: ignore[index]
    _price_cache[binance_symbol] = (now, price)
    return price


async def get_24h(binance_symbol: str) -> dict:
    data = await _get("/api/v3/ticker/24hr", {"symbol": binance_symbol})
    return {
        "price": float(data["lastPrice"]),  # type: ignore[index]
        "change_pct": float(data["priceChangePercent"]),  # type: ignore[index]
        "high": float(data["highPrice"]),  # type: ignore[index]
        "low": float(data["lowPrice"]),  # type: ignore[index]
        "quote_volume": float(data["quoteVolume"]),  # type: ignore[index]
    }


async def get_candles(binance_symbol: str, timeframe: str, limit: int = 500) -> list[Candle]:
    if timeframe not in TIMEFRAMES:
        raise MarketDataError(f"Unsupported timeframe '{timeframe}'")
    rows = await _get(
        "/api/v3/klines",
        {"symbol": binance_symbol, "interval": timeframe, "limit": max(10, min(limit, 1000))},
    )
    return [
        Candle(int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5]))
        for r in rows  # type: ignore[union-attr]
    ]
