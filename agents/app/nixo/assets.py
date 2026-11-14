"""Token catalogue for agent runs, from NEAR Intents 1Click (GET /v0/tokens).

Assets are addressed by a readable code, `SYMBOL@chain` (e.g. `BTC@btc`, `USDC@base`),
that maps 1:1 to a 1Click `assetId`. The chain comes from the catalogue, never from
an agent's request: the vault freezes the code -> chain map into each policy.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from app.trading import oneclick
from app.trading.markets import USDC_NEAR

log = logging.getLogger(__name__)

ALLOCATION_CODE = "USDC@near"  # numeraire: allocations and spend are in USDC on NEAR
CACHE_SECONDS = 600

# Readable symbols for wrapped tokens, and which symbols have Binance USDT history.
ALIASES = {"wNEAR": "NEAR"}
BINANCE_BASE = {
    "NEAR": "NEAR", "BTC": "BTC", "WBTC": "BTC", "wBTC": "BTC", "cbBTC": "BTC", "ETH": "ETH", "WETH": "ETH",
    "SOL": "SOL", "BNB": "BNB", "XRP": "XRP", "DOGE": "DOGE", "ADA": "ADA", "TRX": "TRX", "AVAX": "AVAX",
    "LTC": "LTC", "BCH": "BCH", "LINK": "LINK", "ARB": "ARB", "OP": "OP", "POL": "POL", "SUI": "SUI", "APT": "APT",
    "ZEC": "ZEC", "DASH": "DASH", "XLM": "XLM", "UNI": "UNI", "AAVE": "AAVE", "PEPE": "PEPE", "SHIB": "SHIB",
    "TRUMP": "TRUMP", "PENGU": "PENGU", "STRK": "STRK", "BOME": "BOME", "KAITO": "KAITO",
}
# When two tokens would get the same code, these assetIds keep the plain code.
PREFERRED = (USDC_NEAR, "nep141:wrap.near", "nep141:btc.omft.near", "nep141:sol.omft.near", "nep141:eth.omft.near")


@dataclass(frozen=True)
class Asset:
    code: str
    asset_id: str
    symbol: str
    chain: str
    decimals: int
    price: float | None  # USD spot from 1Click (None if unpriced)

    @property
    def binance_base(self) -> str | None:
        return BINANCE_BASE.get(self.symbol)

    def to_dict(self) -> dict:
        return {
            "code": self.code, "asset_id": self.asset_id, "symbol": self.symbol, "chain": self.chain,
            "decimals": self.decimals, "price": self.price, "has_history": self.binance_base is not None,
        }


# Offline catalogue: used for synthetic runs, tests, and when 1Click is unreachable.
FALLBACK = [
    Asset(ALLOCATION_CODE, USDC_NEAR, "USDC", "near", 6, 1.0),
    Asset("NEAR@near", "nep141:wrap.near", "NEAR", "near", 24, 3.2),
    Asset("ETH@near", "nep141:eth.bridge.near", "ETH", "near", 18, 1850.0),
    Asset("USDT@near", "nep141:usdt.tether-token.near", "USDT", "near", 6, 1.0),
    Asset("BTC@btc", "nep141:btc.omft.near", "BTC", "btc", 8, 65000.0),
    Asset("SOL@sol", "nep141:sol.omft.near", "SOL", "sol", 9, 74.0),
    Asset("USDC@sol", "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", "USDC", "sol", 6, 1.0),
    Asset("ETH@eth", "nep141:eth.omft.near", "ETH", "eth", 18, 1850.0),
    Asset("USDC@eth", "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", "USDC", "eth", 6, 1.0),
    Asset("USDC@base", "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", "USDC", "base", 6, 1.0),
]


class Catalogue:
    def __init__(self, assets: list[Asset], source: str):
        self.assets = assets
        self.source = source  # "1click" | "fallback"
        self.by_code = {a.code: a for a in assets}
        self.by_id = {a.asset_id: a for a in assets}

    def resolve(self, code: str) -> Asset:
        try:
            return self.by_code[code]
        except KeyError:
            raise KeyError(f"Unknown asset '{code}'. Use SYMBOL@chain codes from /nixo/assets.") from None

    def chains(self) -> list[str]:
        return sorted({a.chain for a in self.assets})

    def chain_map(self) -> dict[str, str]:
        return {a.code: a.chain for a in self.assets}

    def to_dict(self) -> dict:
        chains = []
        for chain in self.chains():
            items = sorted((a for a in self.assets if a.chain == chain), key=lambda a: a.symbol.lower())
            chains.append({"chain": chain, "assets": [a.to_dict() for a in items]})
        return {"source": self.source, "allocation": ALLOCATION_CODE, "count": len(self.assets), "chains": chains}


def build(tokens: list[dict]) -> Catalogue:
    rows = []
    for t in tokens:
        try:
            symbol, chain, aid = str(t["symbol"]), str(t["blockchain"]).lower(), str(t["assetId"])
            decimals = int(t["decimals"])
        except (KeyError, TypeError, ValueError):
            continue
        if "DEPRECATED" in symbol.upper() or not t.get("price"):
            continue
        rows.append((ALIASES.get(symbol, symbol), chain, aid, decimals, float(t["price"]), t.get("contractAddress")))
    # Preferred ids first so they keep the plain code on a clash.
    rows.sort(key=lambda r: (r[2] not in PREFERRED, PREFERRED.index(r[2]) if r[2] in PREFERRED else 0))
    used: set[str] = set()
    assets = []
    for symbol, chain, aid, decimals, price, contract in rows:
        code = f"{symbol}@{chain}"
        if code in used:
            tail = (contract or aid).split(":")[-1].replace(".omft.near", "")[-6:]
            code = f"{symbol}@{chain}:{tail}"
        if code in used:
            continue
        used.add(code)
        assets.append(Asset(code, aid, symbol, chain, decimals, price))
    if ALLOCATION_CODE not in used:  # can't run without the USDC@near numeraire
        assets.insert(0, FALLBACK[0])
    return Catalogue(assets, "1click")


_cache: tuple[float, Catalogue] | None = None


def fallback_catalogue() -> Catalogue:
    return Catalogue(list(FALLBACK), "fallback")


async def catalogue(offline: bool = False) -> Catalogue:
    """The live 1Click catalogue (cached), or the fallback when offline or 1Click is unreachable."""
    global _cache
    if offline:
        return fallback_catalogue()
    if _cache and _cache[0] > time.monotonic():
        return _cache[1]
    try:
        cat = build(await oneclick.tokens())
    except (oneclick.OneClickError, AssertionError) as err:
        log.warning("1Click token list unavailable, using fallback catalogue: %s", err)
        return fallback_catalogue()
    _cache = (time.monotonic() + CACHE_SECONDS, cat)
    return cat


def clear_cache() -> None:
    global _cache
    _cache = None
