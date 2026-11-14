"""Copy trading with paid viewing keys (NIXO Keys).

Traders sell access to an encrypted, hash-chained feed of their *agent* trades.
Followers pay on-chain (copykeys/ contract), decrypt the feed in their browser,
and can auto-mirror trades into their own paper account. Only aggregate PnL is
public.
"""

from app.copytrade.service import CopyTradeService, build
from app.trading.engine import engine

service: CopyTradeService = build(engine)

__all__ = ["CopyTradeService", "service"]
