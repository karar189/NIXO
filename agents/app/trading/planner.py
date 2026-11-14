"""Strategy planner and position supervisor.

An LLM (Claude, OpenAI, DeepSeek, NVIDIA NIM or NEAR AI — see app.llm) picks
one strategy from the regime shortlist plus its parameters and explains the
choice. "auto" walks the configured providers in order. Without credentials,
or if every provider fails or refuses, a deterministic rule-based planner
produces the same shape so the engine always has a plan.
"""

import json
import logging
from typing import Literal

from pydantic import BaseModel, Field

from app import llm
from app.trading.signals import BOUNDED

log = logging.getLogger(__name__)

RiskProfile = Literal["conservative", "moderate", "aggressive"]

RISK_DEFAULTS = {
    # lookback (bars), ATR multiple for return-type thresholds, max loss (fraction of price)
    "conservative": (20, 1.0, 0.015),
    "moderate": (14, 0.6, 0.02),
    "aggressive": (8, 0.3, 0.035),
}

STRATEGY_BLURBS = {
    "momentum": "goes with the direction of the recent return over the lookback window",
    "dual_momentum": "compares short- and long-window momentum to catch acceleration",
    "trend_following": "follows the trend using a fast/slow moving-average spread",
    "ma_crossover": "trades the spread between a fast and a slow simple moving average",
    "ema_crossover": "trades the spread between a fast and a slow exponential moving average",
    "breakout": "enters when price breaks the high or low of the lookback window",
    "donchian_channel": "scores price position inside the Donchian channel",
    "macd_signal": "trades the MACD histogram (MACD line minus signal line)",
    "supertrend": "follows ATR-band supertrend direction",
    "mean_reversion": "fades moves away from the rolling mean (z-score)",
    "z_score": "fades moves away from the rolling mean (z-score)",
    "bollinger_reversion": "fades moves toward the outer Bollinger bands",
    "rsi_signal": "buys oversold and sells overbought RSI readings",
    "bollinger_squeeze": "trades the direction of a volatility expansion after a squeeze",
    "linear_regression_channel": "fades deviations from a rolling linear-regression line",
    "atr_breakout": "trades bars whose range exceeds 1.5× ATR in the direction of the close",
}


class StrategyPlan(BaseModel):
    strategy: str
    lookback: int = Field(ge=3, le=200)
    threshold: float = Field(gt=0)
    max_loss_pct: float = Field(gt=0, le=0.5)


class PlanResult(BaseModel):
    strategy_plan: StrategyPlan
    analysis_paragraph: str
    quant_algo_description: str
    # "rules" or the provider that produced the plan (anthropic, openai, deepseek, nvidia, nearai).
    planner: str
    planner_model: str | None = None
    planner_note: str | None = None
    planner_attempts: list[dict] = Field(default_factory=list)


class SupervisorDecision(BaseModel):
    action: Literal["KEEP", "CLOSE", "ADJUST_TP_SL"]
    reasoning: str


def llm_available() -> bool:
    return llm.any_available()


# ---------------------------------------------------------------- planning


def rules_plan(summary: dict, candidates: list[str], risk: RiskProfile, note: str | None = None) -> PlanResult:
    lookback, atr_mult, max_loss = RISK_DEFAULTS[risk]
    strategy = candidates[0]
    atr_pct = summary.get("atr_pct") or 0.003
    threshold = 0.3 if strategy in BOUNDED else max(atr_pct * atr_mult, 0.0002)
    adx_v, vol = summary.get("adx"), summary.get("realized_vol_recent")
    regime = "trending" if (adx_v or 0) > 25 else "ranging" if (adx_v or 0) < 20 else "mixed"
    analysis = (
        f"{summary['symbol']} on the {summary['timeframe']} chart looks {regime}"
        + (f" (ADX {adx_v:.1f})" if adx_v else "")
        + (f", with annualised volatility near {vol:.0%}" if vol else "")
        + (f" and a {summary['change_24h_pct']:+.2f}% move over 24h" if summary.get("change_24h_pct") is not None else "")
        + f". The regime filter shortlisted {', '.join(candidates[:4])}; the rule-based planner takes the first, "
        f"{strategy}, with {risk} risk settings."
    )
    algo = (
        f"{strategy} {STRATEGY_BLURBS.get(strategy, 'scores the latest bars')}. It looks back {lookback} bars and "
        f"acts when the signal crosses ±{threshold:.4g}. Positions exit on take profit, stop loss, liquidation, "
        f"or when the signal reverses past the threshold."
    )
    return PlanResult(
        strategy_plan=StrategyPlan(strategy=strategy, lookback=lookback, threshold=threshold, max_loss_pct=max_loss),
        analysis_paragraph=analysis,
        quant_algo_description=algo,
        planner="rules",
        planner_note=note,
    )


def _plan_prompt(summary: dict, candidates: list[str], risk: RiskProfile, margin: float,
                 leverage: float, indicators: list[str], recent: list[dict]) -> str:
    lines = [
        "You are the strategy planner for a crypto trading agent. Pick ONE strategy for the next session and tune it.",
        f"Market: {summary['symbol']}/USDC, timeframe {summary['timeframe']}, {summary['bar_count']} bars.",
        f"Margin: ${margin:,.2f}, leverage {leverage:g}x, risk profile: {risk}.",
        "Fills are spot swaps priced by NEAR Intents solvers, so each round trip costs roughly 0.3-0.5% in fees "
        "and slippage. Prefer settings that don't churn.",
    ]
    if indicators:
        lines.append(f"The user wants these indicators considered: {', '.join(indicators)}.")
    lines += [
        "Regime summary (JSON):",
        json.dumps({k: v for k, v in summary.items() if v is not None}, default=float),
        "Last candles (oldest first, [open, high, low, close, volume]):",
        json.dumps(recent),
        f"Choose `strategy` from this shortlist only: {candidates}.",
        "Bounded strategies (signal in about ±0.5 to ±2) need a threshold of 0.2-1.0: "
        + ", ".join(sorted(BOUNDED & set(candidates)) or ["none here"]) + ".",
        "Return-based strategies (momentum, dual_momentum, ma_crossover, ema_crossover, trend_following) need a "
        "threshold expressed as a fractional move, typically 0.5-1.5x the ATR percentage "
        f"({(summary.get('atr_pct') or 0):.4%} here).",
        "`lookback` is in bars (5-50). `max_loss_pct` is the stop distance as a fraction of price (0.005-0.05).",
        "`analysis_paragraph`: 4-6 sentences on the regime and why this strategy fits. "
        "`quant_algo_description`: 3-4 sentences on how the chosen algorithm decides entries and exits.",
    ]
    return "\n".join(lines)


async def make_plan(*, summary: dict, candidates: list[str], risk: RiskProfile, margin: float,
                    leverage: float, indicators: list[str], recent_candles: list[list[float]],
                    provider: str, model: str | None = None) -> PlanResult:
    if provider == "rules":
        return rules_plan(summary, candidates, risk)
    if not llm_available():
        return rules_plan(summary, candidates, risk, note="No LLM provider key configured; used the rule-based planner.")

    schema = {
        "type": "object",
        "properties": {
            "strategy": {"type": "string", "enum": candidates},
            "lookback": {"type": "integer"},
            "threshold": {"type": "number"},
            "max_loss_pct": {"type": "number"},
            "analysis_paragraph": {"type": "string"},
            "quant_algo_description": {"type": "string"},
        },
        "required": ["strategy", "lookback", "threshold", "max_loss_pct", "analysis_paragraph", "quant_algo_description"],
        "additionalProperties": False,
    }
    prompt = _plan_prompt(summary, candidates, risk, margin, leverage, indicators, recent_candles)
    try:
        result = await llm.structured(prompt, schema, max_tokens=8000, preferred=provider, model=model,
                                      name="strategy_plan")
    except llm.LLMUnavailable as err:
        plan = rules_plan(summary, candidates, risk, note=f"No LLM produced a usable plan ({err}); used the rule-based planner.")
        plan.planner_attempts = err.attempts
        return plan
    except ValueError as err:  # unknown provider name
        return rules_plan(summary, candidates, risk, note=f"{err}; used the rule-based planner.")

    data = result.data
    try:
        plan = StrategyPlan(
            strategy=data["strategy"] if data["strategy"] in candidates else candidates[0],
            lookback=int(min(max(data["lookback"], 5), 50)),
            threshold=float(min(max(data["threshold"], 0.00005), 1.0)),
            max_loss_pct=float(min(max(data["max_loss_pct"], 0.005), 0.05)),
        )
    except (KeyError, TypeError, ValueError) as err:
        return rules_plan(summary, candidates, risk, note=f"Planner output unusable ({err}); used the rule-based planner.")
    return PlanResult(
        strategy_plan=plan,
        analysis_paragraph=data["analysis_paragraph"],
        quant_algo_description=data["quant_algo_description"],
        planner=result.provider,
        planner_model=result.model,
        planner_note=llm.attempt_note(result.attempts),
        planner_attempts=result.attempts,
    )


# ---------------------------------------------------------------- supervisor


async def supervise(*, symbol: str, side: str, entry: float, mark: float, pnl: float, roe_pct: float,
                    strategy: str, tp: float | None, sl: float | None, dynamic: bool,
                    provider: str = "auto", model: str | None = None) -> SupervisorDecision:
    """Ask the LLM whether to keep, close, or re-level an open position."""
    if not llm_available():
        return SupervisorDecision(action="KEEP", reasoning="Supervisor offline (no LLM provider configured).")
    schema = {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["KEEP", "CLOSE", "ADJUST_TP_SL"]},
            "reasoning": {"type": "string"},
        },
        "required": ["action", "reasoning"],
        "additionalProperties": False,
    }
    prompt = (
        "You supervise an open paper position for a trading agent. Decide KEEP, CLOSE (exit now), or "
        "ADJUST_TP_SL (recompute ATR-based take profit and stop loss; only valid in dynamic mode).\n"
        f"Position: {symbol} {side} entry {entry:.6g}, mark {mark:.6g}, PnL ${pnl:,.2f} ({roe_pct:+.2f}% on margin).\n"
        f"Strategy: {strategy}. TP {tp if tp is not None else 'none'}, SL {sl if sl is not None else 'none'}. "
        f"TP/SL mode: {'dynamic' if dynamic else 'fixed'}.\n"
        "Give one or two sentences of reasoning."
    )
    try:
        result = await llm.structured(prompt, schema, max_tokens=4000, preferred=provider, model=model,
                                      name="supervisor_decision")
        decision = SupervisorDecision(**result.data)
    except (llm.LLMUnavailable, ValueError, KeyError, TypeError) as err:
        return SupervisorDecision(action="KEEP", reasoning=f"Supervisor unavailable: {err}")
    who = llm.LABELS.get(result.provider, result.provider)
    if decision.action == "ADJUST_TP_SL" and not dynamic:
        return SupervisorDecision(action="KEEP", reasoning=f"[{who}] {decision.reasoning} (adjust ignored in fixed mode)")
    return SupervisorDecision(action=decision.action, reasoning=f"[{who}] {decision.reasoning}")
