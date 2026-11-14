import re

from fastapi import APIRouter, Header, HTTPException, Query
from typing import Literal

from pydantic import BaseModel, Field

import time

from app import llm
from app.live import nep413
from app.live.executor import live_agent
from app.trading import market_data, oneclick, planner
from app.trading.engine import EngineError, ManualOrder, SessionConfig, engine
from app.trading.markets import MARKETS, get_market

router = APIRouter(prefix="/trade", tags=["trading"])

# NEAR account IDs: 2-64 chars, lowercase alphanumerics separated by - _ or .
ACCOUNT_RE = re.compile(r"^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$")


def account_id(x_near_account: str | None) -> str:
    # Unsigned for now: the header only scopes sessions. Signed (NEP-413) auth comes next.
    if not x_near_account or not ACCOUNT_RE.match(x_near_account):
        raise HTTPException(401, "Missing or invalid X-Near-Account header")
    return x_near_account


def _wrap(err: EngineError) -> HTTPException:
    return HTTPException(err.status_code, str(err))


class PreviewBody(BaseModel):
    symbol: str
    side: Literal["LONG", "SHORT"]
    notional_usdc: float = Field(gt=0, le=1_000_000)


class StartBody(BaseModel):
    config: SessionConfig
    plan_id: str | None = None
    # Required when config.execution == "live": the owner wallet's NEP-413 signature over
    # nep413.start_message(...) with a nonce from POST /trade/live/challenge.
    auth: dict | None = None


class LiveChallengeBody(BaseModel):
    symbol: str
    amount_usdc: float = Field(gt=0)


_challenges = nep413.Challenges()
_live_balances: dict = {"at": 0.0, "data": None}


@router.get("/markets")
def markets() -> list[dict]:
    return [m.to_dict() for m in MARKETS.values()]


@router.get("/ticker/{symbol}")
async def ticker(symbol: str) -> dict:
    try:
        m = get_market(symbol)
        return {"symbol": m.symbol, **(await market_data.get_24h(m.binance_symbol))}
    except KeyError as err:
        raise HTTPException(404, str(err)) from err
    except market_data.MarketDataError as err:
        raise HTTPException(502, str(err)) from err


@router.post("/preview")
async def preview(body: PreviewBody) -> dict:
    """Price an entry with a 1Click dry-run quote, without opening anything."""
    try:
        m = get_market(body.symbol)
        mark = await market_data.get_price(m.binance_symbol)
    except KeyError as err:
        raise HTTPException(404, str(err)) from err
    except market_data.MarketDataError as err:
        raise HTTPException(502, str(err)) from err
    if body.side == "LONG":
        fill = await oneclick.paper_buy(m, body.notional_usdc, mark)
    else:
        fill = await oneclick.paper_sell(m, body.notional_usdc / mark, mark)
    return {"mark": mark, "fill": fill.to_dict()}


@router.get("/planner")
def planner_info() -> dict:
    providers = llm.status()
    first = next((p for p in providers if p["configured"] and not p["cooldown"]), None)
    return {
        "llm_available": planner.llm_available(),
        # What "auto" would try first right now.
        "provider": first["name"] if first else None,
        "model": first["default_model"] if first else None,
        "providers": providers,
    }


@router.post("/analyze")
async def analyze(cfg: SessionConfig, x_near_account: str | None = Header(None)) -> dict:
    try:
        return await engine.analyze(account_id(x_near_account), cfg)
    except EngineError as err:
        raise _wrap(err) from err


@router.get("/live/status")
async def live_status() -> dict:
    """Live agent configuration, caps, recent real orders and (cached) balances. No secrets."""
    now = time.time()
    if live_agent.configured and now - _live_balances["at"] > 15:
        _live_balances["data"] = await live_agent.balances()
        _live_balances["at"] = now
    return {**live_agent.public_status(), "balances": _live_balances["data"]}


@router.post("/live/challenge")
def live_challenge(body: LiveChallengeBody, x_near_account: str | None = Header(None)) -> dict:
    """Message + single-use nonce the owner wallet signs (NEP-413) to start a live session."""
    account_id(x_near_account)
    if not live_agent.configured:
        raise HTTPException(503, "Live agent is not configured: " + "; ".join(live_agent.problems()))
    try:
        symbol = get_market(body.symbol).symbol
    except KeyError as err:
        raise HTTPException(404, str(err)) from err
    return {
        "message": nep413.start_message(account=live_agent.account, symbol=symbol, amount_usdc=body.amount_usdc),
        "recipient": nep413.RECIPIENT,
        "nonce": _challenges.issue(),
    }


@router.post("/start")
async def start(body: StartBody, x_near_account: str | None = Header(None)) -> dict:
    acct = account_id(x_near_account)
    if body.config.execution == "live":
        if not body.auth:
            raise HTTPException(401, "Live sessions need the owner wallet's signature")
        try:
            symbol = get_market(body.config.symbol).symbol
            await nep413.verify(
                rpc=live_agent.rpc, owner=live_agent.cfg.agent_owner or "", signed=body.auth,
                expected_message=nep413.start_message(account=live_agent.account or "", symbol=symbol,
                                                      amount_usdc=body.config.amount_usdc),
                challenges=_challenges,
            )
        except nep413.AuthError as err:
            raise HTTPException(403, str(err)) from err
        except KeyError as err:
            raise HTTPException(404, str(err)) from err
        if acct != live_agent.cfg.agent_owner:
            raise HTTPException(403, "Header account doesn't match the live agent owner")
    try:
        await engine.start_agent(acct, body.config, body.plan_id)
    except EngineError as err:
        raise _wrap(err) from err
    return engine.status(acct)


@router.post("/manual")
async def manual(order: ManualOrder, x_near_account: str | None = Header(None)) -> dict:
    acct = account_id(x_near_account)
    try:
        await engine.open_manual(acct, order)
    except EngineError as err:
        raise _wrap(err) from err
    except ValueError as err:
        raise HTTPException(422, str(err)) from err
    return engine.status(acct)


@router.post("/stop")
async def stop(close_position: bool = Query(True), x_near_account: str | None = Header(None)) -> dict:
    acct = account_id(x_near_account)
    try:
        await engine.stop(acct, close_position)
    except EngineError as err:
        raise _wrap(err) from err
    return engine.status(acct)


@router.post("/pause")
def pause(x_near_account: str | None = Header(None)) -> dict:
    acct = account_id(x_near_account)
    try:
        engine.set_paused(acct, True)
    except EngineError as err:
        raise _wrap(err) from err
    return engine.status(acct)


@router.post("/resume")
def resume(x_near_account: str | None = Header(None)) -> dict:
    acct = account_id(x_near_account)
    try:
        engine.set_paused(acct, False)
    except EngineError as err:
        raise _wrap(err) from err
    return engine.status(acct)


@router.get("/status")
def status(x_near_account: str | None = Header(None)) -> dict:
    return engine.status(account_id(x_near_account))


@router.get("/logs")
def logs(limit: int = Query(200, ge=1, le=500), x_near_account: str | None = Header(None)) -> dict:
    return {"logs": engine.logs(account_id(x_near_account), limit)}


@router.get("/statistics")
def statistics(x_near_account: str | None = Header(None)) -> dict:
    return engine.statistics(account_id(x_near_account))


@router.get("/history")
def history(limit: int = Query(100, ge=1, le=500), x_near_account: str | None = Header(None)) -> dict:
    return engine.history(account_id(x_near_account), limit)
