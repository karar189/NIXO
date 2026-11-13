"""Proxy for the NEAR Intents 1Click API used by wallet-signed (live) swaps.

The browser never holds a 1Click JWT; if one is configured it is attached here.
"""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.trading import oneclick
from app.trading.markets import MARKETS, USDC_NEAR

router = APIRouter(prefix="/intents", tags=["intents"])

ALLOWED_ASSETS = {USDC_NEAR} | {m.live_asset for m in MARKETS.values() if m.live_asset}


class LiveQuoteBody(BaseModel):
    dry: bool = True
    origin_asset: str
    destination_asset: str
    amount: str = Field(pattern=r"^\d+$", description="Smallest units of the origin asset")
    account_id: str = Field(min_length=2, max_length=64)
    slippage_bps: int = Field(100, ge=10, le=500)
    swap_type: Literal["EXACT_INPUT"] = "EXACT_INPUT"


class DepositBody(BaseModel):
    deposit_address: str
    tx_hash: str
    near_sender_account: str | None = None


def _err(err: oneclick.OneClickError) -> HTTPException:
    return HTTPException(err.status_code if 400 <= err.status_code < 500 else 502, str(err))


@router.post("/quote")
async def live_quote(body: LiveQuoteBody) -> dict:
    """Quote a swap between NEAR-chain tokens; funds come from and return to the user's account."""
    if body.origin_asset not in ALLOWED_ASSETS or body.destination_asset not in ALLOWED_ASSETS:
        raise HTTPException(400, "Unsupported asset for live swaps")
    if body.origin_asset == body.destination_asset:
        raise HTTPException(400, "Origin and destination must differ")
    try:
        return await oneclick.quote({
            "dry": body.dry,
            "swapType": body.swap_type,
            "slippageTolerance": body.slippage_bps,
            "originAsset": body.origin_asset,
            "destinationAsset": body.destination_asset,
            "amount": body.amount,
            "depositType": "ORIGIN_CHAIN",
            "recipient": body.account_id,
            "recipientType": "DESTINATION_CHAIN",
            "refundTo": body.account_id,
            "refundType": "ORIGIN_CHAIN",
        })
    except oneclick.OneClickError as err:
        raise _err(err) from err


@router.post("/deposit")
async def submit_deposit(body: DepositBody) -> dict:
    try:
        return await oneclick.submit_deposit(body.deposit_address, body.tx_hash, body.near_sender_account)
    except oneclick.OneClickError as err:
        raise _err(err) from err


@router.get("/status")
async def swap_status(deposit_address: str = Query(..., alias="depositAddress"),
                      deposit_memo: str | None = Query(None, alias="depositMemo")) -> dict:
    try:
        return await oneclick.status(deposit_address, deposit_memo)
    except oneclick.OneClickError as err:
        raise _err(err) from err
