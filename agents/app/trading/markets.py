"""Tradable markets.

Each market pairs a Binance symbol (charting, candles, mark price) with the
NEAR Intents asset IDs used for quotes and settlement. Paper fills come from
1Click dry-run quotes on `intents_asset`; live swaps settle on NEAR mainnet
using `live_asset`, a NEP-141 token on the NEAR chain the user's wallet holds.
"""

from dataclasses import dataclass

USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"
USDC_DECIMALS = 6


@dataclass(frozen=True)
class Market:
    symbol: str  # base ticker, e.g. "NEAR"
    name: str
    binance_symbol: str
    intents_asset: str
    decimals: int
    live_asset: str | None = None  # NEAR-chain token for wallet-signed swaps
    live_contract: str | None = None
    max_leverage: int = 50

    @property
    def pair(self) -> str:
        return f"{self.symbol}/USDC"

    @property
    def tv_symbol(self) -> str:
        return f"BINANCE:{self.binance_symbol}"

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "name": self.name,
            "pair": self.pair,
            "tvSymbol": self.tv_symbol,
            "intentsAsset": self.intents_asset,
            "decimals": self.decimals,
            "liveAsset": self.live_asset,
            "liveContract": self.live_contract,
            "liveEnabled": self.live_asset is not None,
            "maxLeverage": self.max_leverage,
        }


MARKETS: dict[str, Market] = {
    m.symbol: m
    for m in [
        Market(
            symbol="NEAR",
            name="NEAR Protocol",
            binance_symbol="NEARUSDT",
            intents_asset="nep141:wrap.near",
            decimals=24,
            live_asset="nep141:wrap.near",
            live_contract="wrap.near",
        ),
        Market(
            symbol="BTC",
            name="Bitcoin",
            binance_symbol="BTCUSDT",
            intents_asset="nep141:nbtc.bridge.near",
            decimals=8,
        ),
        Market(
            symbol="ETH",
            name="Ethereum",
            binance_symbol="ETHUSDT",
            intents_asset="nep141:eth.omft.near",
            decimals=18,
        ),
        Market(
            symbol="SOL",
            name="Solana",
            binance_symbol="SOLUSDT",
            intents_asset="nep141:sol.omft.near",
            decimals=9,
        ),
    ]
}


def get_market(symbol: str) -> Market:
    key = symbol.upper().split("/")[0].split(":")[-1].removesuffix("USDT").removesuffix("USDC")
    if key not in MARKETS:
        raise KeyError(f"Unsupported market '{symbol}'. Choose one of: {', '.join(MARKETS)}")
    return MARKETS[key]
