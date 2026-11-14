"""Read listings and subscriptions from the copy-keys contract (copykeys/).

The contract is the only source of truth for who paid and which X25519 key a
follower registered. Positive answers are cached briefly to keep RPC load low.
Missing answers aren't cached, so a follower who just paid is recognised on
their next request.
"""

from __future__ import annotations

import time
from typing import Any, Awaitable, Callable

from app.config import settings
from app.nixo import onchain

View = Callable[..., Awaitable[Any]]


def sub_active(sub: dict | None, now: float | None = None) -> bool:
    if not sub:
        return False
    now_ns = int((time.time() if now is None else now) * 1e9)
    return int(sub["starts_at_ns"]) <= now_ns < int(sub["expires_at_ns"])


class ChainSubscriptions:
    def __init__(self, *, contract: str | None = None, view: View | None = None, ttl: float = 15.0,
                 clock=time.time):
        self._contract = contract
        self._view = view or onchain.view
        self.ttl = ttl
        self.clock = clock
        self._cache: dict[tuple, tuple[float, Any]] = {}

    @property
    def contract(self) -> str | None:
        return self._contract if self._contract is not None else settings.nixo_keys_contract

    @property
    def enabled(self) -> bool:
        return bool(self.contract)

    async def _call(self, method: str, args: dict, *, cache: bool = True) -> Any:
        if not self.enabled:
            return None
        key = (method, tuple(sorted(args.items())))
        hit = self._cache.get(key)
        if cache and hit and self.clock() - hit[0] < self.ttl:
            return hit[1]
        value = await self._view(method, args, contract=self.contract)
        if value:
            self._cache[key] = (self.clock(), value)
        return value

    def invalidate(self) -> None:
        self._cache.clear()

    async def listing(self, trader: str) -> dict | None:
        return await self._call("get_listing", {"trader": trader})

    async def listings(self) -> list[dict]:
        return await self._call("list_listings", {"from_index": 0, "limit": 200}) or []

    async def subscription(self, trader: str, follower: str) -> dict | None:
        return await self._call("get_subscription", {"trader": trader, "follower": follower})

    async def subscriptions_of(self, follower: str) -> list[dict]:
        return await self._call("subscriptions_of", {"follower": follower}, cache=False) or []

    async def subscribers_of(self, trader: str) -> list[dict]:
        return await self._call("subscribers_of", {"trader": trader}, cache=False) or []
