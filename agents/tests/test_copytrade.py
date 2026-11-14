"""Copy trading: encrypted feed, epoch-scoped keys, public stats, auto-mirror."""

from __future__ import annotations

import asyncio

import pytest

from app.copytrade.feed import CopyFeed, verify_chain
from app.copytrade.mirror import MirrorSettings
from app.copytrade.service import CopyTradeService
from app.copytrade.stats import PUBLIC_FIELDS, public_stats
from app.nixo.viewing_keys import generate_buyer_keypair, unwrap_key, wrap_key
from app.trading import market_data, oneclick
from app.trading.engine import Engine, Session, SessionConfig
from app.trading.markets import get_market
from app.trading.oneclick import Fill

ALICE, BOB = "alice.testnet", "bob.testnet"
NS = 1_000_000_000


class Clock:
    def __init__(self, t: float = 1_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


class FakeSubs:
    """Stands in for the copy-keys contract."""

    enabled = True

    def __init__(self, clock: Clock):
        self.clock = clock
        self.listed: set[str] = {ALICE}
        self.subs: dict[tuple[str, str], dict] = {}

    def add(self, trader: str, follower: str, pub: str, start: float, end: float) -> None:
        self.subs[(trader, follower)] = {
            "trader": trader, "follower": follower, "x25519_pub": pub,
            "starts_at_ns": str(int(start * NS)), "expires_at_ns": str(int(end * NS)), "paid_total": "1",
        }

    async def listing(self, trader):
        return {"trader": trader, "active": True} if trader in self.listed else None

    async def subscription(self, trader, follower):
        return self.subs.get((trader, follower))


# ---------------------------------------------------------------- crypto + feed


def test_wrap_unwrap_round_trip():
    kp = generate_buyer_keypair()
    key = bytes(range(32))
    w = wrap_key(key, kp["public_b64"])
    assert unwrap_key(buyer_private_b64=kp["private_b64"], ephemeral_pub_b64=w["ephemeral_pub_b64"],
                      wrapped_b64=w["wrapped_b64"]) == key


def test_feed_decrypts_with_wrapped_key_and_chain_verifies():
    clock = Clock()
    feed = CopyFeed(epoch_secs=100, clock=clock)
    feed.append(ALICE, {"type": "OPEN", "symbol": "NEAR", "side": "LONG"})
    feed.append(ALICE, {"type": "CLOSE", "symbol": "NEAR", "pnl": 12.5})
    entries = feed.entries(ALICE)
    assert verify_chain(entries)
    assert all("symbol" not in e for e in entries), "public rows carry no plaintext"

    kp = generate_buyer_keypair()
    [k] = feed.wrapped_keys(ALICE, kp["public_b64"], clock.t - 10, clock.t + 10)
    data_key = unwrap_key(buyer_private_b64=kp["private_b64"], ephemeral_pub_b64=k["ephemeral_pub_b64"],
                          wrapped_b64=k["wrapped_b64"])
    assert CopyFeed.decrypt(entries[1], data_key)["pnl"] == 12.5


def test_tampering_breaks_chain_or_decryption():
    feed = CopyFeed(epoch_secs=100, clock=Clock())
    for i in range(3):
        feed.append(ALICE, {"type": "OPEN", "i": i})
    entries = feed.entries(ALICE)
    assert not verify_chain([entries[0], entries[2]]), "dropped entry is detected"
    edited = [dict(e) for e in entries]
    edited[1]["plaintext_hash"] = "ab" * 32
    assert not verify_chain(edited)

    # Moving a ciphertext to another position fails AES-GCM auth (seq is associated data).
    kp = generate_buyer_keypair()
    [k] = feed.wrapped_keys(ALICE, kp["public_b64"], 0, 10**12)
    key = unwrap_key(buyer_private_b64=kp["private_b64"], ephemeral_pub_b64=k["ephemeral_pub_b64"],
                     wrapped_b64=k["wrapped_b64"])
    swapped = {**entries[0], "seq": 2}
    with pytest.raises(Exception):
        CopyFeed.decrypt(swapped, key)


def test_subscriber_only_gets_epochs_in_window():
    clock = Clock(1_000.0)
    feed = CopyFeed(epoch_secs=100, clock=clock)
    for t in (1_050.0, 1_150.0, 1_250.0, 1_350.0):  # epochs 10, 11, 12, 13
        clock.t = t
        feed.append(ALICE, {"type": "OPEN", "t": t})
    kp = generate_buyer_keypair()
    keys = feed.wrapped_keys(ALICE, kp["public_b64"], starts_at=1_120.0, expires_at=1_220.0)
    assert [k["epoch"] for k in keys] == [11, 12]

    # Epochs that haven't started yet are never handed out, even inside the window.
    clock.t = 1_160.0
    keys = feed.wrapped_keys(ALICE, kp["public_b64"], starts_at=1_120.0, expires_at=5_000.0)
    assert [k["epoch"] for k in keys] == [11]


def test_sealed_feed_survives_restart(tmp_path):
    clock = Clock()
    a = CopyFeed(epoch_secs=100, root=tmp_path, master_key="s3cret", clock=clock)
    a.append(ALICE, {"type": "OPEN", "x": 1})
    b = CopyFeed(epoch_secs=100, root=tmp_path, master_key="s3cret", clock=clock)
    assert b.head(ALICE) == a.head(ALICE)
    kp = generate_buyer_keypair()
    [k] = b.wrapped_keys(ALICE, kp["public_b64"], 0, 10**12)
    key = unwrap_key(buyer_private_b64=kp["private_b64"], ephemeral_pub_b64=k["ephemeral_pub_b64"],
                     wrapped_b64=k["wrapped_b64"])
    assert CopyFeed.decrypt(b.entries(ALICE)[0], key) == {"type": "OPEN", "x": 1}


# ---------------------------------------------------------------- public stats


def test_public_stats_count_only_own_agent_trades_and_hide_details():
    trades = [
        {"mode": "agent", "copy_of": None, "pnl": 30.0, "margin": 100, "closed_at": 1, "symbol": "NEAR", "side": "LONG"},
        {"mode": "agent", "copy_of": None, "pnl": -10.0, "margin": 100, "closed_at": 2, "symbol": "NEAR", "side": "SHORT"},
        {"mode": "manual", "copy_of": None, "pnl": 999.0, "margin": 100, "closed_at": 3},
        {"mode": "manual", "copy_of": ["x.testnet", "s"], "pnl": 5.0, "margin": 100, "closed_at": 4},
    ]
    s = public_stats(trades)
    assert s["trades"] == 2 and s["total_pnl"] == 20.0 and s["win_rate"] == 0.5
    assert s["max_drawdown"] == 10.0 and s["roe_pct"] == 10.0
    assert set(s) == set(PUBLIC_FIELDS)
    assert "NEAR" not in repr(s) and "LONG" not in repr(s)


# ---------------------------------------------------------------- mirror


@pytest.fixture
def desk(monkeypatch):
    """Engine + copy service with fake chain and deterministic paper fills."""
    prices = {"mark": 10.0}

    async def get_price(_symbol):
        return prices["mark"]

    async def paper_buy(market, usdc, ref):
        return Fill(price=ref, qty=usdc / ref, usdc=usdc, reference_price=ref, source="intents", slippage_bps=0)

    async def paper_sell(market, qty, ref):
        return Fill(price=ref, qty=qty, usdc=qty * ref, reference_price=ref, source="intents", slippage_bps=0)

    monkeypatch.setattr(market_data, "get_price", get_price)
    monkeypatch.setattr(oneclick, "paper_buy", paper_buy)
    monkeypatch.setattr(oneclick, "paper_sell", paper_sell)

    clock = Clock()
    engine = Engine()
    subs = FakeSubs(clock)
    svc = CopyTradeService(engine, feed=CopyFeed(epoch_secs=3600, clock=clock), subs=subs, clock=clock).install()
    return engine, svc, subs, clock, prices


def trader_session(engine: Engine, mode="agent", account=ALICE) -> Session:
    s = Session(account=account, mode=mode, market=get_market("NEAR"),
                config=SessionConfig(symbol="NEAR", amount_usdc=400, leverage=5))
    engine.sessions[account] = s
    return s


async def stop_all(engine: Engine):
    for s in engine.sessions.values():
        if s.task:
            s.task.cancel()
    await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_mirror_copies_open_and_close(desk):
    engine, svc, subs, clock, prices = desk
    kp = generate_buyer_keypair()
    subs.add(ALICE, BOB, kp["public_b64"], clock.t - 10, clock.t + 3600)
    svc.mirror.configure(BOB, MirrorSettings(trader=ALICE, scale=0.5, max_leverage=3, max_margin_usdc=150))

    src = trader_session(engine)
    await engine._open(src, "LONG", 10.0, "test signal")
    await svc.drain()

    copy = engine.sessions[BOB]
    assert copy.running and copy.copy_of == (ALICE, src.id)
    assert copy.position.side == "LONG"
    assert copy.position.margin == 150  # min(400 * 0.5, 150)
    assert copy.position.leverage == 3
    assert copy.position.tp_price == pytest.approx(src.position.tp_price)

    prices["mark"] = 10.5
    await engine._close(src, 10.5, "SIGNAL")
    await svc.drain()
    assert not engine.sessions[BOB].running
    [state] = svc.mirror.configs_of(BOB)
    assert state["copies_opened"] == 1 and state["copies_closed"] == 1
    assert state["realized_pnl"] == pytest.approx(150 * 3 * 0.05)

    # Feed: trader's OPEN + CLOSE only (the copy is never published), decryptable by the subscriber.
    entries = svc.feed.entries(ALICE)
    assert [e["kind"] for e in entries] == ["OPEN", "CLOSE"]
    assert svc.feed.entries(BOB) == []
    [k] = svc.feed.wrapped_keys(ALICE, kp["public_b64"], clock.t - 10, clock.t + 3600)
    key = unwrap_key(buyer_private_b64=kp["private_b64"], ephemeral_pub_b64=k["ephemeral_pub_b64"],
                     wrapped_b64=k["wrapped_b64"])
    assert CopyFeed.decrypt(entries[1], key)["pnl"] == pytest.approx(400 * 5 * 0.05)
    await stop_all(engine)


@pytest.mark.asyncio
async def test_manual_trades_are_not_published_or_mirrored(desk):
    engine, svc, subs, clock, _ = desk
    subs.add(ALICE, BOB, generate_buyer_keypair()["public_b64"], clock.t - 10, clock.t + 3600)
    svc.mirror.configure(BOB, MirrorSettings(trader=ALICE))
    src = trader_session(engine, mode="manual")
    await engine._open(src, "LONG", 10.0, "manual order")
    await svc.drain()
    assert BOB not in engine.sessions
    assert svc.feed.entries(ALICE) == []


@pytest.mark.asyncio
async def test_unlisted_trader_is_not_published(desk):
    engine, svc, subs, _, _ = desk
    subs.listed.clear()
    src = trader_session(engine)
    await engine._open(src, "LONG", 10.0, "signal")
    await svc.drain()
    assert svc.feed.entries(ALICE) == []


@pytest.mark.asyncio
async def test_mirror_skips_expired_busy_and_loss_capped(desk):
    engine, svc, subs, clock, _ = desk
    pub = generate_buyer_keypair()["public_b64"]
    svc.mirror.configure(BOB, MirrorSettings(trader=ALICE, max_total_loss_usdc=50))

    # Expired subscription.
    subs.add(ALICE, BOB, pub, clock.t - 7200, clock.t - 3600)
    src = trader_session(engine)
    await engine._open(src, "LONG", 10.0, "signal")
    await svc.drain()
    assert BOB not in engine.sessions
    assert "no active subscription" in svc.mirror.log_of(BOB)[0]["message"]

    # Busy: follower already has their own session.
    subs.add(ALICE, BOB, pub, clock.t - 10, clock.t + 3600)
    trader_session(engine, mode="manual", account=BOB)
    await engine._close(src, 10.0, "SIGNAL")
    await engine._open(src, "SHORT", 10.0, "signal")
    await svc.drain()
    assert engine.sessions[BOB].copy_of is None
    assert "already have a session" in svc.mirror.log_of(BOB)[0]["message"]

    # Loss cap reached: mirroring pauses itself.
    del engine.sessions[BOB]
    svc.mirror._configs[(BOB, ALICE)].realized_pnl = -60
    await engine._close(src, 10.0, "SIGNAL")
    await engine._open(src, "LONG", 10.0, "signal")
    await svc.drain()
    assert BOB not in engine.sessions
    [state] = svc.mirror.configs_of(BOB)
    assert state["enabled"] is False and state["paused_reason"] == "loss cap reached"
    await stop_all(engine)
