"""Token catalogue built from the 1Click token list."""

import asyncio

import pytest

from app.nixo import assets
from app.trading import oneclick
from app.trading.markets import USDC_NEAR

TOKENS = [
    {"assetId": USDC_NEAR, "decimals": 6, "blockchain": "near", "symbol": "USDC", "price": 0.9997},
    {"assetId": "nep141:wrap.near", "decimals": 24, "blockchain": "near", "symbol": "wNEAR", "price": 3.2},
    {"assetId": "nep141:btc.omft.near", "decimals": 8, "blockchain": "btc", "symbol": "BTC", "price": 65000},
    {"assetId": "nep141:hl-a.omft.near", "decimals": 6, "blockchain": "hypercore", "symbol": "USDC", "price": 1,
     "contractAddress": "0xaaaaaa111111"},
    {"assetId": "nep141:hl-b.omft.near", "decimals": 6, "blockchain": "hypercore", "symbol": "USDC", "price": 1,
     "contractAddress": "0xbbbbbb222222"},
    {"assetId": "nep141:old.near", "decimals": 18, "blockchain": "near", "symbol": "SWEAT(DEPRECATED)", "price": 1},
    {"assetId": "nep141:noprice.near", "decimals": 18, "blockchain": "near", "symbol": "NOPE", "price": None},
]


def test_build_codes_aliases_and_dedup():
    cat = assets.build(TOKENS)
    assert cat.resolve("NEAR@near").asset_id == "nep141:wrap.near"  # wNEAR shown as NEAR
    assert cat.resolve("USDC@near").asset_id == USDC_NEAR
    hl = [a.code for a in cat.assets if a.chain == "hypercore"]
    assert len(hl) == 2 and "USDC@hypercore" in hl and any(c.startswith("USDC@hypercore:") for c in hl)
    assert "SWEAT(DEPRECATED)@near" not in cat.by_code and "NOPE@near" not in cat.by_code
    assert cat.resolve("BTC@btc").to_dict()["has_history"] is True
    with pytest.raises(KeyError):
        cat.resolve("DOGE@doge")
    grouped = cat.to_dict()
    assert grouped["source"] == "1click" and {g["chain"] for g in grouped["chains"]} == {"near", "btc", "hypercore"}


def test_fallback_when_1click_down(monkeypatch):
    async def boom():
        raise oneclick.OneClickError("down")

    assets.clear_cache()
    monkeypatch.setattr(oneclick, "tokens", boom)
    cat = asyncio.run(assets.catalogue())
    assert cat.source == "fallback" and "BTC@btc" in cat.by_code
    assets.clear_cache()


def test_live_catalogue_cached(monkeypatch):
    calls = []

    async def fake():
        calls.append(1)
        return TOKENS

    assets.clear_cache()
    monkeypatch.setattr(oneclick, "tokens", fake)
    asyncio.run(assets.catalogue())
    asyncio.run(assets.catalogue())
    assert len(calls) == 1
    assets.clear_cache()
