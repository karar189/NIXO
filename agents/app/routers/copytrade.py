"""Copy-trading API: public PnL, encrypted feed, wrapped keys, auto-mirror.

Public: leaderboard, trader stats and ciphertext feed. Feed keys go only to the
X25519 key a follower registered on-chain when paying, so `/copy/keys` needs no
login: only the browser holding the private key can use what it returns.
Mirror settings use the X-Near-Account header, like the rest of the paper desk.
"""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query

from app.config import settings
from app.copytrade import service
from app.copytrade.mirror import MirrorSettings
from app.copytrade.stats import public_stats
from app.copytrade.subscriptions import sub_active
from app.routers.trading import ACCOUNT_RE, account_id

router = APIRouter(prefix="/copy", tags=["copytrade"])

NS = 1_000_000_000


def _trader(trader: str) -> str:
    if not ACCOUNT_RE.match(trader):
        raise HTTPException(400, "Not a valid NEAR account ID")
    return trader


async def _listing(trader: str) -> dict | None:
    if trader in service.demo:
        return None
    try:
        return await service.subs.listing(trader)
    except Exception as err:
        raise HTTPException(502, f"Couldn't read the copy-keys contract: {err}") from err


def _card(trader: str, listing: dict | None) -> dict:
    demo = service.demo.get(trader)
    return {
        "trader": trader,
        "demo": demo is not None,
        "profile": demo["profile"] if demo else None,
        "listing": listing,
        "stats": public_stats(service.trades_of(trader)),
        **service.feed.head(trader),
    }


@router.get("/config")
def config() -> dict:
    return {
        "contract": settings.nixo_keys_contract,
        "epoch_secs": settings.copy_epoch_secs,
        "demo": bool(service.demo),
        "scope": "agent trading sessions only (no manual positions, no vault executes)",
    }


@router.get("/leaderboard")
async def leaderboard() -> dict:
    cards = []
    if service.subs.enabled:
        try:
            listings = await service.subs.listings()
        except Exception as err:
            raise HTTPException(502, f"Couldn't read the copy-keys contract: {err}") from err
        cards += [_card(lst["trader"], lst) for lst in listings]
    cards += [_card(t, None) for t in service.demo]
    cards.sort(key=lambda c: c["stats"]["total_pnl"], reverse=True)
    return {"contract": settings.nixo_keys_contract, "traders": cards}


@router.get("/traders/{trader}")
async def trader_card(trader: str) -> dict:
    trader = _trader(trader)
    listing = await _listing(trader)
    if listing is None and trader not in service.demo:
        # Unlisted accounts keep their PnL private too.
        return {"trader": trader, "demo": False, "listing": None, "stats": None, "listed": False,
                **service.feed.head(trader)}
    return {**_card(trader, listing), "listed": True}


@router.get("/traders/{trader}/entries")
async def trader_entries(trader: str, since: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500)) -> dict:
    trader = _trader(trader)
    return {"trader": trader, **service.feed.head(trader), "entries": service.feed.entries(trader, since, limit)}


@router.get("/keys/{trader}")
async def wrapped_keys(trader: str, follower: str = Query(..., min_length=2, max_length=64)) -> dict:
    trader, follower = _trader(trader), _trader(follower)
    if trader in service.demo:
        raise HTTPException(403, "Demo traders have simulated history and can't be subscribed to")
    if not service.subs.enabled:
        raise HTTPException(503, "Copy-keys contract is not configured (NIXO_KEYS_CONTRACT)")
    try:
        sub = await service.subs.subscription(trader, follower)
    except Exception as err:
        raise HTTPException(502, f"Couldn't read the copy-keys contract: {err}") from err
    if not sub:
        raise HTTPException(403, "NO_SUBSCRIPTION: subscribe on-chain first")
    starts, expires = int(sub["starts_at_ns"]) / NS, int(sub["expires_at_ns"]) / NS
    return {
        "trader": trader,
        "follower": follower,
        "active": sub_active(sub),
        "starts_at": starts,
        "expires_at": expires,
        "x25519_pub": sub["x25519_pub"],
        "keys": service.feed.wrapped_keys(trader, sub["x25519_pub"], starts, expires),
    }


@router.get("/me")
async def me(x_near_account: str | None = Header(None)) -> dict:
    acct = account_id(x_near_account)
    listing = await _listing(acct) if service.subs.enabled else None
    subscribers = []
    if service.subs.enabled:
        try:
            subscribers = await service.subs.subscribers_of(acct)
        except Exception:
            subscribers = []
    return {**_card(acct, listing), "subscribers": [{**s, "active": sub_active(s)} for s in subscribers]}


@router.get("/following")
async def following(x_near_account: str | None = Header(None)) -> dict:
    acct = account_id(x_near_account)
    subs = []
    if service.subs.enabled:
        try:
            subs = await service.subs.subscriptions_of(acct)
        except Exception as err:
            raise HTTPException(502, f"Couldn't read the copy-keys contract: {err}") from err
    return {"follower": acct, "subscriptions": [{**s, "active": sub_active(s)} for s in subs]}


@router.get("/mirror")
def mirror_state(x_near_account: str | None = Header(None)) -> dict:
    acct = account_id(x_near_account)
    session = service.engine.sessions.get(acct)
    copying = list(session.copy_of) if session and session.running and session.copy_of else None
    return {"configs": service.mirror.configs_of(acct), "log": service.mirror.log_of(acct), "copying": copying}


@router.post("/mirror")
async def set_mirror(body: MirrorSettings, x_near_account: str | None = Header(None)) -> dict:
    acct = account_id(x_near_account)
    body.trader = _trader(body.trader)
    if body.trader == acct:
        raise HTTPException(400, "You can't mirror yourself")
    if body.enabled:
        if body.trader in service.demo:
            raise HTTPException(403, "Demo traders can't be mirrored")
        if not service.subs.enabled:
            raise HTTPException(503, "Copy-keys contract is not configured (NIXO_KEYS_CONTRACT)")
        if not sub_active(await service.subs.subscription(body.trader, acct)):
            raise HTTPException(403, "NO_ACTIVE_SUBSCRIPTION: subscribe to this trader first")
    return {"config": service.mirror.configure(acct, body).to_dict()}
