"""NEAR Intents 1Click API client.

Paper trading prices every fill with a dry-run quote (`dry: true`), so the
fill reflects real solver liquidity, slippage and fees without moving funds.
The same client proxies the live flow: quote, deposit submit and status.
"""

from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from decimal import ROUND_DOWN, Decimal

import httpx

from app.config import settings
from app.trading.markets import USDC_DECIMALS, USDC_NEAR, Market

FINAL_STATUSES = {"SUCCESS", "REFUNDED", "FAILED"}


class OneClickError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        headers = {"Content-Type": "application/json"}
        if settings.oneclick_jwt:
            headers["Authorization"] = f"Bearer {settings.oneclick_jwt}"
        _client = httpx.AsyncClient(
            base_url=settings.oneclick_url, headers=headers, timeout=20.0
        )
    return _client


async def _request(method: str, path: str, **kwargs) -> dict | list:
    try:
        res = await _http().request(method, path, **kwargs)
    except httpx.HTTPError as err:
        raise OneClickError(f"1Click unreachable: {err}") from err
    try:
        body = res.json()
    except ValueError:
        body = {"message": res.text}
    if res.status_code >= 400:
        message = body.get("message") if isinstance(body, dict) else None
        raise OneClickError(message or f"1Click error {res.status_code}", res.status_code)
    return body


def to_units(amount: float, decimals: int) -> str:
    q = Decimal(str(amount)) * (Decimal(10) ** decimals)
    return str(q.quantize(Decimal(1), rounding=ROUND_DOWN))


def deadline(minutes: int = 10) -> str:
    return (datetime.now(UTC) + timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


async def quote(body: dict) -> dict:
    """POST /v0/quote. `body` follows the 1Click quote request schema."""
    payload = {"deadline": deadline(), "slippageTolerance": 100, "swapType": "EXACT_INPUT", **body}
    result = await _request("POST", "/v0/quote", json=payload)
    assert isinstance(result, dict)
    return result


async def status(deposit_address: str, deposit_memo: str | None = None) -> dict:
    params = {"depositAddress": deposit_address}
    if deposit_memo:
        params["depositMemo"] = deposit_memo
    result = await _request("GET", "/v0/status", params=params)
    assert isinstance(result, dict)
    return result


async def submit_deposit(deposit_address: str, tx_hash: str, near_sender: str | None) -> dict:
    payload = {"depositAddress": deposit_address, "txHash": tx_hash}
    if near_sender:
        payload["nearSenderAccount"] = near_sender
    result = await _request("POST", "/v0/deposit/submit", json=payload)
    assert isinstance(result, dict)
    return result


async def tokens() -> list:
    result = await _request("GET", "/v0/tokens")
    assert isinstance(result, list)
    return result


@dataclass
class Fill:
    """A paper fill. `price` is USDC per unit of the asset, after fees/slippage."""

    price: float
    qty: float  # asset units
    usdc: float  # USDC paid (buy) or received (sell)
    reference_price: float
    source: str  # "intents" (1Click dry quote) or "reference" (mark price fallback)
    slippage_bps: float
    correlation_id: str | None = None
    signature: str | None = None
    time_estimate_s: int | None = None
    note: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def _paper_body(origin: str, dest: str, amount_units: str) -> dict:
    account = settings.paper_quote_account
    body = {
        "dry": True,
        "originAsset": origin,
        "destinationAsset": dest,
        "amount": amount_units,
        "depositType": "INTENTS",
        "recipient": account,
        "recipientType": "INTENTS",
        "refundTo": account,
        "refundType": "INTENTS",
    }
    # Confidential dry quotes need a partner JWT; without it keep public pricing.
    if settings.oneclick_jwt:
        body["confidentiality"] = "basic"
    return body


def _slippage_bps(price: float, ref: float, buying: bool) -> float:
    # Positive = worse than the mark price for the trader.
    diff = (price - ref) / ref if buying else (ref - price) / ref
    return round(diff * 10_000, 2)


async def paper_buy(market: Market, usdc_amount: float, ref_price: float) -> Fill:
    """Spend `usdc_amount` USDC to buy the asset (open long / close short)."""
    try:
        q = await quote(_paper_body(USDC_NEAR, market.intents_asset, to_units(usdc_amount, USDC_DECIMALS)))
        qty = float(q["quote"]["amountOutFormatted"])
        price = usdc_amount / qty
        return Fill(
            price=price, qty=qty, usdc=usdc_amount, reference_price=ref_price, source="intents",
            slippage_bps=_slippage_bps(price, ref_price, buying=True),
            correlation_id=q.get("correlationId"), signature=q.get("signature"),
            time_estimate_s=q["quote"].get("timeEstimate"),
        )
    except (OneClickError, KeyError, ValueError, ZeroDivisionError) as err:
        return Fill(
            price=ref_price, qty=usdc_amount / ref_price, usdc=usdc_amount, reference_price=ref_price,
            source="reference", slippage_bps=0.0, note=f"1Click quote unavailable: {err}",
        )


async def paper_sell(market: Market, qty: float, ref_price: float) -> Fill:
    """Sell `qty` of the asset for USDC (close long / open short)."""
    try:
        q = await quote(_paper_body(market.intents_asset, USDC_NEAR, to_units(qty, market.decimals)))
        usdc = float(q["quote"]["amountOutFormatted"])
        price = usdc / qty
        return Fill(
            price=price, qty=qty, usdc=usdc, reference_price=ref_price, source="intents",
            slippage_bps=_slippage_bps(price, ref_price, buying=False),
            correlation_id=q.get("correlationId"), signature=q.get("signature"),
            time_estimate_s=q["quote"].get("timeEstimate"),
        )
    except (OneClickError, KeyError, ValueError, ZeroDivisionError) as err:
        return Fill(
            price=ref_price, qty=qty, usdc=qty * ref_price, reference_price=ref_price,
            source="reference", slippage_bps=0.0, note=f"1Click quote unavailable: {err}",
        )
