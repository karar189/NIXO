"""Paper trading engine.

One session per NEAR account. An "agent" session runs the planned strategy on
every tick; a "manual" session holds one position the user opened from the
order form and watches its TP/SL/liquidation. Every fill is priced by a NEAR
Intents 1Click dry-run quote. State is in memory and resets on restart.
"""

import asyncio
import logging
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Callable, Literal

from pydantic import BaseModel, Field, model_validator

from app.trading import analysis, market_data, oneclick, planner, risk, signals
from app.trading.market_data import Candle, MarketDataError
from app.trading.markets import Market, get_market
from app.trading.paper import Position, Side, levels_from_atr, levels_from_pct, liquidation_price, validate_levels

log = logging.getLogger(__name__)

PLAN_TTL_SECONDS = 15 * 60
CANDLE_REFRESH_SECONDS = 30
COOLDOWN_SECONDS = 30
CANDLE_LIMIT = 300


# ---------------------------------------------------------------- requests


class SessionConfig(BaseModel):
    symbol: str = "NEAR"
    amount_usdc: float = Field(1000, gt=0, description="Margin committed, in USDC")
    leverage: float = Field(5, ge=1, le=50)
    timeframe: Literal["1m", "5m", "15m", "1h", "4h"] = "15m"
    risk_profile: planner.RiskProfile = "moderate"
    tp_sl_mode: Literal["dynamic", "fixed"] = "dynamic"
    tp_pct: float | None = Field(None, gt=0, le=1, description="Take profit as a fraction of price move")
    sl_pct: float | None = Field(None, gt=0, le=1, description="Stop loss as a fraction of price move")
    risk_sizing_mode: Literal["fixed", "kelly", "vol_scaling"] = "fixed"
    kelly_fraction: float = Field(0.25, ge=0.01, le=1)
    poll_seconds: float = Field(3, ge=1, le=60)
    supervisor_interval_seconds: float = Field(120, ge=30, le=600)
    llm_provider: Literal["auto", "claude", "anthropic", "openai", "deepseek", "nvidia", "nearai", "rules"] = "auto"
    llm_model: str | None = Field(None, max_length=128, pattern=r"^[A-Za-z0-9._:/@-]+$",
                                  description="Model override for the chosen provider")
    indicators: list[str] = Field(default_factory=list)


class ManualOrder(BaseModel):
    symbol: str = "NEAR"
    side: Side
    amount_usdc: float = Field(gt=0, description="Margin committed, in USDC")
    leverage: float = Field(1, ge=1, le=50)
    tp_mode: Literal["price", "pct", "none"] = "pct"
    tp: float | None = Field(None, gt=0)
    sl_mode: Literal["price", "pct", "none"] = "pct"
    sl: float | None = Field(None, gt=0)
    poll_seconds: float = Field(2, ge=1, le=60)

    @model_validator(mode="after")
    def _check(self) -> "ManualOrder":
        for mode, value, name in ((self.tp_mode, self.tp, "take profit"), (self.sl_mode, self.sl, "stop loss")):
            if mode != "none" and value is None:
                raise ValueError(f"Enter a {name} value or set it to none")
            if mode == "pct" and value is not None and value >= 1:
                raise ValueError(f"{name.capitalize()} percent must be a fraction below 1 (0.02 = 2%)")
        return self


# ---------------------------------------------------------------- state


@dataclass
class AccountBook:
    """Per-account history that outlives individual sessions."""

    trades: list[dict] = field(default_factory=list)
    disabled_strategies: set[str] = field(default_factory=set)
    plans: dict[str, dict] = field(default_factory=dict)  # plan_id -> analysis payload


@dataclass
class Session:
    account: str
    mode: Literal["agent", "manual"]
    market: Market
    config: SessionConfig
    plan: dict | None = None
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    started_at: float = field(default_factory=time.time)
    running: bool = True
    paused: bool = False
    position: Position | None = None
    last_price: float | None = None
    last_action: str | None = None
    last_reason: str | None = None
    last_signal: float | None = None
    candles: list[Candle] = field(default_factory=list)
    candles_at: float = 0.0
    cooldown_until: float = 0.0
    supervisor_at: float = 0.0
    trades: list[dict] = field(default_factory=list)
    logs: deque = field(default_factory=lambda: deque(maxlen=500))
    decisions: deque = field(default_factory=lambda: deque(maxlen=500))
    task: asyncio.Task | None = None
    data_errors: int = 0
    ended_reason: str | None = None
    # Set on a follower's position opened by the copy-trade mirror: (trader, trader's session id).
    copy_of: tuple[str, str] | None = None


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class EngineError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


class Engine:
    def __init__(self) -> None:
        self.sessions: dict[str, Session] = {}
        self.books: dict[str, AccountBook] = {}
        # Called synchronously with every OPEN/CLOSE fill event (copy-trade feed + mirror).
        # Listeners must not block; app.copytrade queues the event and returns.
        self.listeners: list[Callable[[dict], None]] = []

    def book(self, account: str) -> AccountBook:
        return self.books.setdefault(account, AccountBook())

    # ------------------------------------------------------------ analysis

    async def analyze(self, account: str, cfg: SessionConfig) -> dict:
        market = _market(cfg.symbol)
        try:
            candles, stats = await asyncio.gather(
                market_data.get_candles(market.binance_symbol, cfg.timeframe, CANDLE_LIMIT),
                market_data.get_24h(market.binance_symbol),
            )
        except MarketDataError as err:
            raise EngineError(str(err), 502) from err
        if len(candles) < 60:
            raise EngineError("Not enough market history to analyse this market", 502)

        summary = analysis.compute_summary(market.symbol, cfg.timeframe, candles, stats["change_pct"])
        candidates = analysis.shortlist(summary)
        recent = [[c.open, c.high, c.low, c.close, round(c.volume, 2)] for c in candles[-30:]]
        result = await planner.make_plan(
            summary=summary, candidates=candidates, risk=cfg.risk_profile, margin=cfg.amount_usdc,
            leverage=cfg.leverage, indicators=cfg.indicators, recent_candles=recent, provider=cfg.llm_provider,
            model=cfg.llm_model,
        )
        plan_id = uuid.uuid4().hex
        payload = {
            "plan_id": plan_id,
            "created_at": time.time(),
            "symbol": market.symbol,
            "timeframe": cfg.timeframe,
            "bar_count": len(candles),
            "market_regime_summary": summary,
            "strategy_shortlist": candidates,
            **result.model_dump(),
        }
        self.book(account).plans[plan_id] = payload
        return payload

    # ------------------------------------------------------------ lifecycle

    def _assert_idle(self, account: str) -> None:
        current = self.sessions.get(account)
        if current and current.running:
            what = "An agent session" if current.mode == "agent" else "A manual position"
            raise EngineError(f"{what} is already running on {current.market.pair}. Stop it first.", 409)

    async def start_agent(self, account: str, cfg: SessionConfig, plan_id: str | None) -> Session:
        self._assert_idle(account)
        market = _market(cfg.symbol)
        plan = self.book(account).plans.get(plan_id or "")
        fresh = plan and plan["symbol"] == market.symbol and time.time() - plan["created_at"] < PLAN_TTL_SECONDS
        if not fresh:
            plan = await self.analyze(account, cfg)
        session = Session(account=account, mode="agent", market=market, config=cfg, plan=plan)
        sp = plan["strategy_plan"]
        self._log(session, "start", f"Agent started on {market.pair}: {sp['strategy']} "
                  f"(lookback {sp['lookback']}, threshold {sp['threshold']:.4g}), "
                  f"${cfg.amount_usdc:,.2f} margin at {cfg.leverage:g}x, planner: {plan['planner']}"
                  + (f" ({plan['planner_model']})" if plan.get("planner_model") else ""))
        self._log(session, "info", "Fills are priced by NEAR Intents 1Click dry-run quotes (no funds move).")
        self.sessions[account] = session
        session.task = asyncio.create_task(self._run(session))
        return session

    async def open_manual(self, account: str, order: ManualOrder,
                          copy_of: tuple[str, str] | None = None) -> Session:
        self._assert_idle(account)
        market = _market(order.symbol)
        cfg = SessionConfig(symbol=market.symbol, amount_usdc=order.amount_usdc, leverage=order.leverage,
                            poll_seconds=order.poll_seconds)
        session = Session(account=account, mode="manual", market=market, config=cfg, copy_of=copy_of)
        try:
            mark = await market_data.get_price(market.binance_symbol)
        except MarketDataError as err:
            raise EngineError(str(err), 502) from err
        session.last_price = mark

        # Validate TP/SL against the mark before paying for a fill.
        tp, sl = self._manual_levels(order, mark)
        validate_levels(order.side, mark, tp, sl)

        await self._open(session, order.side, mark, reason="manual order", manual=(order, tp, sl))
        if session.position is None:
            raise EngineError(session.last_reason or "Order rejected", 422)
        self.sessions[account] = session
        session.task = asyncio.create_task(self._run(session))
        return session

    @staticmethod
    def _manual_levels(order: ManualOrder, entry: float) -> tuple[float | None, float | None]:
        tp_pct = order.tp if order.tp_mode == "pct" else None
        sl_pct = order.sl if order.sl_mode == "pct" else None
        tp, sl = levels_from_pct(order.side, entry, tp_pct, sl_pct)
        if order.tp_mode == "price":
            tp = order.tp
        if order.sl_mode == "price":
            sl = order.sl
        return tp, sl

    async def stop(self, account: str, close_position: bool = True) -> Session:
        session = self._require(account)
        if session.task and not session.task.done():
            session.task.cancel()
        if close_position and session.position:
            await self._close(session, session.last_price or session.position.entry_price, "STOPPED")
        self._end(session, "stopped by user")
        return session

    def set_paused(self, account: str, paused: bool) -> Session:
        session = self._require(account)
        if not session.running:
            raise EngineError("Session is not running")
        if session.mode != "agent":
            raise EngineError("Only agent sessions can be paused")
        session.paused = paused
        self._log(session, "info", "Paused: no new entries; TP/SL still active." if paused else "Resumed.")
        return session

    def _require(self, account: str) -> Session:
        session = self.sessions.get(account)
        if not session:
            raise EngineError("No session for this account", 404)
        return session

    def _end(self, session: Session, reason: str) -> None:
        if session.running:
            session.running = False
            session.ended_reason = reason
            self._log(session, "stop", f"Session ended: {reason}.")

    # ------------------------------------------------------------ loop

    async def _run(self, session: Session) -> None:
        try:
            while session.running:
                started = time.monotonic()
                try:
                    await self._tick(session)
                    session.data_errors = 0
                except MarketDataError as err:
                    session.data_errors += 1
                    if session.data_errors in (1, 5) or session.data_errors % 20 == 0:
                        self._log(session, "warn", f"Market data unavailable ({session.data_errors}x): {err}")
                except Exception as err:  # keep the loop alive; surface the error
                    log.exception("tick failed")
                    self._log(session, "error", f"Tick failed: {err}")
                elapsed = time.monotonic() - started
                await asyncio.sleep(max(0.2, session.config.poll_seconds - elapsed))
        except asyncio.CancelledError:
            pass

    async def _tick(self, session: Session) -> None:
        market = session.market
        mark = await market_data.get_price(market.binance_symbol)
        session.last_price = mark
        pos = session.position

        if pos:
            trigger = pos.trigger(mark)
            if trigger:
                await self._close(session, mark, trigger)
                if session.mode == "manual":
                    self._end(session, f"position closed ({trigger.replace('_', ' ').lower()})")
                return
            if session.mode == "agent" and planner.llm_available() and session.plan and session.plan["planner"] != "rules":
                await self._maybe_supervise(session, mark)
                if session.position is None:
                    return

        if session.mode == "manual":
            u = session.position.unrealized(mark) if session.position else 0.0
            self._log(session, "tick", f"[TICK] {market.symbol} ${mark:.6g} | {session.position.side if session.position else 'FLAT'} | uPnL ${u:+,.2f}")
            return

        # ---- agent decision
        if time.time() - session.candles_at > CANDLE_REFRESH_SECONDS or not session.candles:
            session.candles = await market_data.get_candles(market.binance_symbol, session.config.timeframe, CANDLE_LIMIT)
            session.candles_at = time.time()

        sp = session.plan["strategy_plan"]  # type: ignore[index]
        closes = [c.close for c in session.candles]
        closes[-1] = mark
        value, detail = signals.compute_signal(sp["strategy"], sp["lookback"], closes, session.candles)
        th = signals.effective_threshold(sp["strategy"], sp["threshold"])
        session.last_signal = value

        side = pos.side if pos else "FLAT"
        if pos:
            reason = f"{detail}; holding {pos.side}, no reversal past ±{th:.4g}"
        else:
            reason = f"{detail}; |signal| below {th:.4g}"
        action = "HOLD"
        if session.paused and not pos:
            reason = "paused"
        elif not pos and time.time() < session.cooldown_until:
            reason = f"cooling down after close ({int(session.cooldown_until - time.time())}s)"
        elif not pos and value > th:
            action, reason = "OPEN_LONG", f"{detail} > {th:.4g}"
        elif not pos and value < -th:
            action, reason = "OPEN_SHORT", f"{detail} < -{th:.4g}"
        elif pos and pos.side == "LONG" and value < -th:
            action, reason = "CLOSE", f"signal reversed: {detail}"
        elif pos and pos.side == "SHORT" and value > th:
            action, reason = "CLOSE", f"signal reversed: {detail}"

        u = pos.unrealized(mark) if pos else 0.0
        self._log(session, "tick", f"[TICK] {market.symbol} ${mark:.6g} | {side} | uPnL ${u:+,.2f} | "
                  f"signal {value:+.4g} (±{th:.4g}) | {action} — {reason}")
        session.last_action, session.last_reason = action, reason

        if action in ("OPEN_LONG", "OPEN_SHORT"):
            await self._open(session, "LONG" if action == "OPEN_LONG" else "SHORT", mark, reason, signal=value)
        elif action == "CLOSE":
            await self._close(session, mark, "SIGNAL_REVERSAL", signal=value)

    async def _maybe_supervise(self, session: Session, mark: float) -> None:
        pos = session.position
        if not pos or time.time() - session.supervisor_at < session.config.supervisor_interval_seconds:
            return
        session.supervisor_at = time.time()
        u = pos.unrealized(mark)
        decision = await planner.supervise(
            symbol=session.market.symbol, side=pos.side, entry=pos.entry_price, mark=mark, pnl=u,
            roe_pct=u / pos.margin * 100, strategy=pos.strategy or "-", tp=pos.tp_price, sl=pos.sl_price,
            dynamic=session.config.tp_sl_mode == "dynamic",
            # Supervise with the provider/model that planned the session (falls through on failure).
            provider=session.plan["planner"], model=session.plan.get("planner_model"),
        )
        self._log(session, "supervisor", f"Supervisor: {decision.action} — {decision.reasoning}")
        if decision.action == "CLOSE":
            await self._close(session, mark, "SUPERVISOR")
        elif decision.action == "ADJUST_TP_SL":
            a = analysis.atr(session.candles) if session.candles else None
            pos.tp_price, pos.sl_price = levels_from_atr(pos.side, pos.entry_price, a)
            self._log(session, "sl_tp", f"TP/SL adjusted to {pos.tp_price:.6g} / {pos.sl_price:.6g}")

    # ------------------------------------------------------------ execution

    def _size_multiplier(self, session: Session) -> float:
        cfg = session.config
        if cfg.risk_sizing_mode == "vol_scaling":
            a = analysis.atr(session.candles) if session.candles else None
            if a and session.last_price:
                return min(2.0, max(0.25, 0.005 / (a / session.last_price)))
        if cfg.risk_sizing_mode == "kelly":
            done = session.trades
            wins = [t["pnl"] for t in done if t["pnl"] > 0]
            losses = [-t["pnl"] for t in done if t["pnl"] <= 0]
            w = len(wins) / len(done) if len(done) >= 5 else 0.5
            r = (sum(wins) / len(wins)) / (sum(losses) / len(losses)) if wins and losses else 1.5
            kelly = max(0.0, min(1.0, w - (1 - w) / r))
            return min(2.0, max(0.25, kelly * cfg.kelly_fraction * 4))
        return 1.0

    async def _open(self, session: Session, side: Side, mark: float, reason: str, *,
                    signal: float | None = None, manual: tuple | None = None) -> None:
        cfg = session.config
        margin = cfg.amount_usdc * self._size_multiplier(session)
        book = self.book(session.account)
        strategy = session.plan["strategy_plan"]["strategy"] if session.plan else None
        decision = risk.check_open(
            has_position=session.position is not None, leverage=cfg.leverage, margin=margin,
            market_max_leverage=session.market.max_leverage, closed_trades=book.trades,
            strategy=strategy, disabled_strategies=book.disabled_strategies,
        )
        if not decision.approved:
            session.last_reason = decision.reason
            self._record(session, f"OPEN_{side}", "rejected", reason=decision.reason, signal=signal, price=mark)
            self._log(session, "warn", f"Risk gate rejected {side}: {decision.reason}")
            if session.mode == "agent":
                session.cooldown_until = time.time() + COOLDOWN_SECONDS
            return

        notional = margin * cfg.leverage
        if side == "LONG":
            fill = await oneclick.paper_buy(session.market, notional, mark)
            entry_usdc = notional
        else:
            fill = await oneclick.paper_sell(session.market, notional / mark, mark)
            entry_usdc = fill.usdc

        entry = fill.price
        if manual:
            order, tp, sl = manual
            # Percent levels are re-anchored to the actual fill price.
            if order.tp_mode == "pct" or order.sl_mode == "pct":
                tp_r, sl_r = levels_from_pct(side, entry, order.tp if order.tp_mode == "pct" else None,
                                             order.sl if order.sl_mode == "pct" else None)
                tp = tp_r if order.tp_mode == "pct" else tp
                sl = sl_r if order.sl_mode == "pct" else sl
        elif cfg.tp_sl_mode == "dynamic":
            tp, sl = levels_from_atr(side, entry, analysis.atr(session.candles) if session.candles else None)
        else:
            sl_pct = cfg.sl_pct or (session.plan["strategy_plan"]["max_loss_pct"] if session.plan else None)
            tp, sl = levels_from_pct(side, entry, cfg.tp_pct, sl_pct)

        session.position = Position(
            side=side, margin=margin, leverage=cfg.leverage, qty=fill.qty, entry_price=entry,
            entry_usdc=entry_usdc, tp_price=tp, sl_price=sl, liq_price=liquidation_price(side, entry, cfg.leverage),
            entry_fill=fill.to_dict(), strategy=strategy,
        )
        session.last_action, session.last_reason = f"OPEN_{side}", reason
        session.supervisor_at = time.time()
        self._record(session, f"OPEN_{side}", "filled", reason=reason, signal=signal, price=mark, fill=fill.to_dict(),
                     size_usdc=notional, leverage=cfg.leverage, tp=tp, sl=sl)
        src = "1Click quote" if fill.source == "intents" else "mark price (1Click unavailable)"
        self._log(session, "action", f"Opened {side} {fill.qty:.6g} {session.market.symbol} @ {entry:.6g} via {src}, "
                  f"${notional:,.2f} notional ({cfg.leverage:g}x), slippage {fill.slippage_bps:+.1f} bps. "
                  f"TP {_fmt(tp)} · SL {_fmt(sl)} · Liq {_fmt(session.position.liq_price)}")
        if fill.note:
            self._log(session, "warn", fill.note)
        p = session.position
        self._emit(session, "OPEN", {
            "symbol": session.market.symbol, "side": side, "entry_price": entry, "margin": margin,
            "leverage": cfg.leverage, "notional": notional, "qty": p.qty, "tp": tp, "sl": sl,
            "strategy": strategy, "opened_at": p.opened_at,
        })

    async def _close(self, session: Session, mark: float, reason: str, *, signal: float | None = None) -> None:
        pos = session.position
        if not pos:
            return
        if reason == "LIQUIDATED":
            fill = oneclick.Fill(price=pos.liq_price or mark, qty=pos.qty, usdc=0.0, reference_price=mark,
                                 source="reference", slippage_bps=0.0, note="Liquidated: margin lost")
            pnl = -pos.margin
        else:
            if pos.side == "LONG":
                fill = await oneclick.paper_sell(session.market, pos.qty, mark)
            else:
                fill = await oneclick.paper_buy(session.market, pos.qty * mark, mark)
            pnl = pos.realized_from_exit(fill)

        trade = {
            "id": uuid.uuid4().hex,
            "session_id": session.id,
            "symbol": session.market.symbol,
            "side": pos.side,
            "strategy": pos.strategy,
            "leverage": pos.leverage,
            "margin": pos.margin,
            "notional": pos.notional,
            "qty": pos.qty,
            "entry_price": pos.entry_price,
            "exit_price": fill.price,
            "pnl": pnl,
            "roe_pct": pnl / pos.margin * 100 if pos.margin else 0.0,
            "close_reason": reason,
            "opened_at": pos.opened_at,
            "closed_at": time.time(),
            "entry_fill": pos.entry_fill,
            "exit_fill": fill.to_dict(),
            "mode": session.mode,
            "copy_of": list(session.copy_of) if session.copy_of else None,
        }
        session.trades.append(trade)
        self.book(session.account).trades.append(trade)
        session.position = None
        session.cooldown_until = time.time() + COOLDOWN_SECONDS
        session.last_action, session.last_reason = "CLOSE", reason
        self._record(session, "CLOSE", "filled", reason=reason, signal=signal, price=mark, fill=fill.to_dict(), pnl=pnl)
        self._log(session, "sl_tp" if reason in ("TAKE_PROFIT", "STOP_LOSS", "LIQUIDATED") else "action",
                  f"Closed {pos.side} @ {fill.price:.6g} ({reason.replace('_', ' ').lower()}): PnL ${pnl:+,.2f} "
                  f"({trade['roe_pct']:+.2f}% on margin)")
        self._emit(session, "CLOSE", {"trade": trade})

    # ------------------------------------------------------------ records

    def _log(self, session: Session, level: str, message: str) -> None:
        session.logs.append({"ts": _now_iso(), "level": level, "message": message})

    def _emit(self, session: Session, kind: str, data: dict) -> None:
        event = {
            "type": kind,
            "account": session.account,
            "mode": session.mode,
            "session_id": session.id,
            "copy_of": list(session.copy_of) if session.copy_of else None,
            "ts": time.time(),
            **data,
        }
        for listener in self.listeners:
            try:
                listener(event)
            except Exception:  # a copy-trade failure must never break the trader's own session
                log.exception("engine listener failed")

    def _record(self, session: Session, action: str, status: str, **extra) -> None:
        session.decisions.append({"id": uuid.uuid4().hex, "ts": _now_iso(), "action": action, "status": status, **extra})

    # ------------------------------------------------------------ views

    def status(self, account: str) -> dict:
        session = self.sessions.get(account)
        if not session:
            return {"running": False, "session": None}
        pos = session.position
        plan = session.plan
        return {
            "running": session.running,
            "session": {
                "id": session.id,
                "mode": session.mode,
                "symbol": session.market.symbol,
                "pair": session.market.pair,
                "started_at": session.started_at,
                "paused": session.paused,
                "ended_reason": session.ended_reason,
                "copy_of": list(session.copy_of) if session.copy_of else None,
                "last_price": session.last_price,
                "last_action": session.last_action,
                "last_reason": session.last_reason,
                "last_signal": session.last_signal,
                "config": session.config.model_dump(),
                "strategy": plan["strategy_plan"] if plan else None,
                "planner": plan["planner"] if plan else None,
                "planner_model": plan.get("planner_model") if plan else None,
                "position": pos.snapshot(session.last_price) if pos else None,
            },
        }

    def logs(self, account: str, limit: int = 200) -> list[dict]:
        session = self.sessions.get(account)
        return list(session.logs)[-limit:] if session else []

    def history(self, account: str, limit: int = 100) -> dict:
        session = self.sessions.get(account)
        book = self.book(account)
        return {
            "decisions": list(session.decisions)[-limit:][::-1] if session else [],
            "trades": book.trades[-limit:][::-1],
        }

    def statistics(self, account: str) -> dict:
        session = self.sessions.get(account)
        trades = session.trades if session else []
        all_trades = self.book(account).trades
        wins = [t["pnl"] for t in trades if t["pnl"] > 0]
        losses = [t["pnl"] for t in trades if t["pnl"] <= 0]
        fills = [f for t in trades for f in (t["entry_fill"], t["exit_fill"]) if f.get("source") == "intents"]
        unreal = session.position.unrealized(session.last_price) if session and session.position and session.last_price else 0.0
        return {
            "total_pnl": sum(t["pnl"] for t in trades),
            "unrealized_pnl": unreal,
            "total_trades": len(trades),
            "win_rate": len(wins) / len(trades) if trades else 0.0,
            "avg_profit": sum(wins) / len(wins) if wins else 0.0,
            "avg_loss": sum(losses) / len(losses) if losses else 0.0,
            "avg_slippage_bps": sum(f["slippage_bps"] for f in fills) / len(fills) if fills else None,
            "intents_fills": len(fills),
            "lifetime_pnl": sum(t["pnl"] for t in all_trades),
            "lifetime_trades": len(all_trades),
        }


def _market(symbol: str) -> Market:
    try:
        return get_market(symbol)
    except KeyError as err:
        raise EngineError(str(err)) from err


def _fmt(v: float | None) -> str:
    return "—" if v is None else f"{v:.6g}"


engine = Engine()
