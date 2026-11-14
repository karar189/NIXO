"""Labelled demo traders with simulated history.

They keep the leaderboard and the paste-a-trader flow usable for anyone without
testnet NEAR. Their IDs end in `.nixo-demo`, which can't be a real testnet
account. They can't be subscribed to, and every API response marks them `demo`.
"""

from __future__ import annotations

import random
import time

from app.copytrade.service import CopyTradeService, feed_payload

PROFILES = [
    {"id": "atlas.nixo-demo", "label": "Atlas", "style": "Momentum agent · NEAR, ETH",
     "seed": 7, "win_rate": 0.64, "edge": 1.5, "symbols": ["NEAR", "ETH"]},
    {"id": "helix.nixo-demo", "label": "Helix", "style": "Mean-reversion agent · BTC",
     "seed": 11, "win_rate": 0.55, "edge": 1.2, "symbols": ["BTC"]},
    {"id": "quill.nixo-demo", "label": "Quill", "style": "Breakout agent · SOL, NEAR",
     "seed": 23, "win_rate": 0.42, "edge": 0.9, "symbols": ["SOL", "NEAR"]},
]

BASE_PRICE = {"NEAR": 2.4, "ETH": 3100.0, "BTC": 96000.0, "SOL": 180.0}


def _trades(p: dict, now: float, n: int = 42) -> list[dict]:
    rng = random.Random(p["seed"])
    start = now - 14 * 86400
    out = []
    for i in range(n):
        sym = rng.choice(p["symbols"])
        side = rng.choice(["LONG", "SHORT"])
        margin = rng.choice([200, 250, 300, 400, 500])
        lev = rng.choice([2, 3, 5])
        win = rng.random() < p["win_rate"]
        move = rng.uniform(0.004, 0.02) * (p["edge"] if win else -1)
        pnl = round(margin * lev * move, 2)
        entry = BASE_PRICE[sym] * rng.uniform(0.95, 1.05)
        exit_ = entry * (1 + move if side == "LONG" else 1 - move)
        opened = start + (i + rng.random() * 0.6) * (14 * 86400 / n)
        out.append({
            "id": f"demo-{p['seed']}-{i}", "session_id": f"demo-{p['seed']}-{i // 6}", "symbol": sym, "side": side,
            "strategy": p["style"].split(" agent")[0].lower(), "leverage": lev, "margin": margin,
            "notional": margin * lev, "qty": margin * lev / entry, "entry_price": entry, "exit_price": exit_,
            "pnl": pnl, "roe_pct": pnl / margin * 100,
            "close_reason": "TAKE_PROFIT" if win else rng.choice(["STOP_LOSS", "SIGNAL"]),
            "opened_at": opened, "closed_at": opened + rng.uniform(600, 7200),
            "entry_fill": {}, "exit_fill": {}, "mode": "agent", "copy_of": None,
        })
    return out


def seed(svc: CopyTradeService, now: float | None = None) -> None:
    now = time.time() if now is None else now
    for p in PROFILES:
        trades = _trades(p, now)
        svc.demo[p["id"]] = {
            "profile": {"label": p["label"], "style": p["style"]},
            "trades": trades,
        }
        # A few encrypted rows so the locked feed has something to show. No key is ever issued for them.
        if not svc.feed.has_feed(p["id"]):
            for t in trades[-4:]:
                ev = {"type": "CLOSE", "session_id": t["session_id"], "ts": t["closed_at"], "trade": t}
                svc.feed.append(p["id"], feed_payload(ev), kind="CLOSE")
