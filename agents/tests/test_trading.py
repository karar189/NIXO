import time

import pytest

from app.trading import risk, signals
from app.trading.analysis import compute_summary, shortlist
from app.trading.market_data import Candle
from app.trading.oneclick import Fill, to_units
from app.trading.paper import Position, levels_from_atr, levels_from_pct, liquidation_price, validate_levels
from app.trading.planner import rules_plan


def make_position(side="LONG", entry=10.0, lev=5.0, margin=100.0, **kw) -> Position:
    notional = margin * lev
    qty = notional / entry
    entry_usdc = notional if side == "LONG" else qty * entry
    return Position(side=side, margin=margin, leverage=lev, qty=qty, entry_price=entry, entry_usdc=entry_usdc,
                    tp_price=kw.get("tp"), sl_price=kw.get("sl"), liq_price=liquidation_price(side, entry, lev),
                    entry_fill={})


def fill(price: float, qty: float) -> Fill:
    return Fill(price=price, qty=qty, usdc=price * qty, reference_price=price, source="intents", slippage_bps=0)


def test_long_pnl_scales_with_leverage():
    pos = make_position("LONG", entry=10, lev=5, margin=100)
    assert pos.unrealized(11) == pytest.approx(50)  # +10% move × 5x × $100
    assert pos.realized_from_exit(fill(11, pos.qty)) == pytest.approx(50)


def test_short_pnl_and_loss_capped_at_margin():
    pos = make_position("SHORT", entry=10, lev=5, margin=100)
    assert pos.unrealized(9) == pytest.approx(50)
    assert pos.unrealized(100) == -100  # can't lose more than margin


def test_liquidation_prices():
    assert liquidation_price("LONG", 100, 1) is None
    assert liquidation_price("LONG", 100, 10) == pytest.approx(90.5)
    assert liquidation_price("SHORT", 100, 10) == pytest.approx(109.5)


def test_trigger_priority():
    pos = make_position("LONG", entry=10, lev=10, tp=11, sl=9.5)
    assert pos.trigger(10.2) is None
    assert pos.trigger(11.1) == "TAKE_PROFIT"
    assert pos.trigger(9.4) == "STOP_LOSS"
    assert pos.trigger(9.0) == "LIQUIDATED"  # liq (9.05) beats SL


def test_levels_and_validation():
    assert levels_from_pct("LONG", 100, 0.02, 0.01) == pytest.approx((102, 99))
    assert levels_from_pct("SHORT", 100, 0.02, 0.01) == pytest.approx((98, 101))
    tp, sl = levels_from_atr("LONG", 100, 1.0)
    assert (tp, sl) == pytest.approx((104, 98))
    with pytest.raises(ValueError):
        validate_levels("LONG", 100, tp=99, sl=None)
    with pytest.raises(ValueError):
        validate_levels("SHORT", 100, tp=None, sl=99)


def test_to_units_rounds_down():
    assert to_units(1.5, 6) == "1500000"
    assert to_units(0.1234567, 6) == "123456"
    assert to_units(1, 24) == "1" + "0" * 24


def test_risk_gate_rules():
    base = dict(has_position=False, leverage=5, margin=100, market_max_leverage=50, closed_trades=[],
                strategy="momentum", disabled_strategies=set())
    assert risk.check_open(**base).approved
    assert not risk.check_open(**{**base, "has_position": True}).approved
    assert not risk.check_open(**{**base, "leverage": 60}).approved
    assert not risk.check_open(**{**base, "margin": 0.5, "leverage": 1}).approved
    losses = [{"pnl": -10, "closed_at": time.time(), "strategy": "momentum"}] * 5
    disabled: set[str] = set()
    decision = risk.check_open(**{**base, "closed_trades": losses, "disabled_strategies": disabled})
    assert not decision.approved and "momentum" in disabled
    big_loss = [{"pnl": -600, "closed_at": time.time(), "strategy": "other"}]
    assert "Daily loss" in risk.check_open(**{**base, "closed_trades": big_loss}).reason


def _candles(closes: list[float]) -> list[Candle]:
    return [Candle(i, c, c * 1.002, c * 0.998, c, 1000) for i, c in enumerate(closes)]


def test_signals_direction():
    up = [100 + i * 0.5 for i in range(80)]
    down = [140 - i * 0.5 for i in range(80)]
    assert signals.compute_signal("momentum", 10, up, _candles(up))[0] > 0
    assert signals.compute_signal("momentum", 10, down, _candles(down))[0] < 0
    # Mean reversion fades the move.
    assert signals.compute_signal("z_score", 10, up, _candles(up))[0] < 0
    for name in signals.ALGOS:
        value, detail = signals.compute_signal(name, 14, up, _candles(up))
        assert isinstance(value, float) and detail


def test_effective_threshold_floors_bounded_algos():
    assert signals.effective_threshold("z_score", 0.001) == signals.MIN_BOUNDED_THRESHOLD
    assert signals.effective_threshold("momentum", 0.001) == 0.001


def test_rules_plan_uses_shortlist():
    closes = [100 + (i % 7) * 0.3 for i in range(200)]
    summary = compute_summary("NEAR", "15m", _candles(closes), -1.2)
    candidates = shortlist(summary)
    plan = rules_plan(summary, candidates, "moderate")
    assert plan.planner == "rules"
    assert plan.strategy_plan.strategy == candidates[0]
    assert candidates[-1] == "momentum"
