"""Wires the paper engine to the copy-trade feed and the mirror.

The engine calls `on_engine_event` synchronously on every fill. Events are
queued and handled in order by one background worker, so the trader's tick
never waits on the feed, RPC lookups or follower fills.

Publishing rule: a trader's own agent trades go into the encrypted feed only
once they have a listing on the copy-keys contract (listed now or before, so
paying subscribers keep receiving trades after an unlist). Manual positions and
mirrored copies are never published.
"""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path

from app.config import settings
from app.copytrade.feed import CopyFeed
from app.copytrade.mirror import Mirror
from app.copytrade.subscriptions import ChainSubscriptions
from app.trading.engine import Engine

log = logging.getLogger(__name__)

STORE_DIR = Path(__file__).resolve().parents[2] / ".nixo_copy"


def feed_payload(ev: dict) -> dict:
    """What a key holder sees for one event."""
    base = {"type": ev["type"], "session_id": ev["session_id"], "ts": ev["ts"]}
    if ev["type"] == "OPEN":
        return {**base, "symbol": ev["symbol"], "side": ev["side"], "entry_price": ev["entry_price"],
                "leverage": ev["leverage"], "margin": ev["margin"], "tp": ev.get("tp"), "sl": ev.get("sl"),
                "strategy": ev.get("strategy")}
    t = ev["trade"]
    return {**base, "symbol": t["symbol"], "side": t["side"], "entry_price": t["entry_price"],
            "exit_price": t["exit_price"], "leverage": t["leverage"], "margin": t["margin"],
            "pnl": t["pnl"], "roe_pct": t["roe_pct"], "close_reason": t["close_reason"],
            "strategy": t.get("strategy")}


class CopyTradeService:
    def __init__(self, engine: Engine, *, feed: CopyFeed, subs: ChainSubscriptions, clock=time.time):
        self.engine = engine
        self.feed = feed
        self.subs = subs
        self.clock = clock
        self.mirror = Mirror(engine, subs, clock=clock)
        self.demo: dict[str, dict] = {}  # trader id -> {"profile": ..., "trades": [...]}
        self._queue: asyncio.Queue | None = None
        self._worker: asyncio.Task | None = None

    def install(self) -> "CopyTradeService":
        if self.on_engine_event not in self.engine.listeners:
            self.engine.listeners.append(self.on_engine_event)
        return self

    # ------------------------------------------------------------ dispatch

    def on_engine_event(self, ev: dict) -> None:
        if ev.get("mode") != "agent" and not ev.get("copy_of"):
            return  # the trader's manual positions are private
        loop = asyncio.get_running_loop()
        if self._queue is None or self._worker is None or self._worker.done() or self._worker.get_loop() is not loop:
            self._queue = asyncio.Queue()
            self._worker = loop.create_task(self._run(self._queue))
        self._queue.put_nowait(ev)

    async def _run(self, queue: asyncio.Queue) -> None:
        while True:
            ev = await queue.get()
            try:
                await self.handle(ev)
            except Exception:
                log.exception("copy-trade event failed")
            finally:
                queue.task_done()

    async def drain(self) -> None:
        if self._queue is not None:
            await self._queue.join()

    async def handle(self, ev: dict) -> None:
        if ev.get("copy_of"):
            await self.mirror.on_copy_event(ev)
            return
        if await self.is_publishing(ev["account"]):
            self.feed.append(ev["account"], feed_payload(ev), kind=ev["type"])
        await self.mirror.on_trader_event(ev)

    async def is_publishing(self, trader: str) -> bool:
        if not self.subs.enabled:
            return False
        try:
            return await self.subs.listing(trader) is not None
        except Exception:
            log.warning("listing lookup failed for %s; not publishing this event", trader)
            return False

    # ------------------------------------------------------------ reads

    def trades_of(self, trader: str) -> list[dict]:
        if trader in self.demo:
            return self.demo[trader]["trades"]
        return self.engine.book(trader).trades


def build(engine: Engine) -> CopyTradeService:
    root = Path(settings.copy_store_dir) if settings.copy_store_dir else STORE_DIR
    feed = CopyFeed(epoch_secs=settings.copy_epoch_secs, root=root, master_key=settings.copy_master_key)
    svc = CopyTradeService(engine, feed=feed, subs=ChainSubscriptions())
    if settings.copy_demo:
        from app.copytrade.demo import seed

        seed(svc)
    return svc.install()
