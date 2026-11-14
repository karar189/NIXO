"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { ModelPicker, usePlannerInfo } from "@/components/llm/ModelPicker";
import {
  INDICATORS,
  PROVIDER_SHORT,
  tradingApi,
  type Analysis,
  type Market,
  type RiskProfile,
  type SessionConfig,
  type Timeframe,
} from "@/lib/trading/api";
import { fmtPct, fmtPrice, fmtUsd, humanize } from "@/lib/trading/format";

const STEPS = ["Configure", "AI plan", "Run"] as const;

export const DEFAULT_CONFIG: SessionConfig = {
  symbol: "NEAR",
  amount_usdc: 1000,
  leverage: 5,
  timeframe: "15m",
  risk_profile: "moderate",
  tp_sl_mode: "dynamic",
  tp_pct: 0.02,
  sl_pct: 0.01,
  risk_sizing_mode: "fixed",
  poll_seconds: 3,
  supervisor_interval_seconds: 120,
  llm_provider: "auto",
  llm_model: null,
  indicators: [],
};

function Field({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs text-muted">{label}</label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-line bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-50";

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-lg border border-line bg-background p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`flex-1 rounded-md px-2 py-1.5 text-xs ${value === o.value ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AgentSetupModal({
  open,
  onClose,
  account,
  markets,
  initial,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  account: string;
  markets: Market[];
  initial: SessionConfig;
  onStarted: (cfg: SessionConfig) => void;
}) {
  const [step, setStep] = useState(0);
  const [cfg, setCfg] = useState<SessionConfig>(initial);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { info: planner, reload: reloadPlanner } = usePlannerInfo();

  useEffect(() => {
    if (!open) return;
    void reloadPlanner();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !loading && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, onClose]);

  if (!open) return null;

  const market = markets.find((m) => m.symbol === cfg.symbol) ?? markets[0];
  const update = (patch: Partial<SessionConfig>) => {
    setCfg((c) => ({ ...c, ...patch }));
    setAnalysis(null); // any change invalidates the plan
  };

  async function fetchPlan() {
    setStep(1);
    setLoading(true);
    setError(null);
    try {
      setAnalysis(await tradingApi.analyze(account, cfg));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function run() {
    if (!analysis) return;
    setLoading(true);
    setError(null);
    try {
      await tradingApi.start(account, cfg, analysis.plan_id);
      onStarted(cfg);
      onClose();
      setStep(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const s = analysis?.market_regime_summary;
  const sp = analysis?.strategy_plan;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <div className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-line bg-surface sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 id="setup-title" className="font-semibold">Configure AI agent</h2>
            <ol className="mt-2 flex gap-4 text-xs">
              {STEPS.map((label, i) => (
                <li key={label} className={`flex items-center gap-1.5 ${i === step ? "text-foreground" : "text-muted"}`}>
                  <span className={`flex size-5 items-center justify-center rounded-full border font-mono text-[10px] ${i <= step ? "border-accent/50 text-accent" : "border-line"}`}>{i + 1}</span>
                  {label}
                </li>
              ))}
            </ol>
          </div>
          <button type="button" onClick={onClose} disabled={loading} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {step === 0 && (
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Parameters</p>
                <Field label="Asset" htmlFor="cfg-asset">
                  <select id="cfg-asset" className={inputCls} value={cfg.symbol} onChange={(e) => update({ symbol: e.target.value })}>
                    {markets.map((m) => (
                      <option key={m.symbol} value={m.symbol}>{m.pair} — {m.name}</option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Margin (USDC)" htmlFor="cfg-amt">
                    <input id="cfg-amt" inputMode="decimal" className={`${inputCls} font-mono`} value={cfg.amount_usdc} onChange={(e) => update({ amount_usdc: Number(e.target.value) || 0 })} />
                  </Field>
                  <Field label={`Leverage (max ${market?.maxLeverage ?? 50}x)`} htmlFor="cfg-lev">
                    <input id="cfg-lev" type="number" min={1} max={market?.maxLeverage ?? 50} className={`${inputCls} font-mono`} value={cfg.leverage}
                      onChange={(e) => update({ leverage: Math.max(1, Math.min(market?.maxLeverage ?? 50, Number(e.target.value) || 1)) })} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Timeframe" htmlFor="cfg-tf">
                    <select id="cfg-tf" className={inputCls} value={cfg.timeframe} onChange={(e) => update({ timeframe: e.target.value as Timeframe })}>
                      {["1m", "5m", "15m", "1h", "4h"].map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Risk level" htmlFor="cfg-risk">
                    <select id="cfg-risk" className={inputCls} value={cfg.risk_profile} onChange={(e) => update({ risk_profile: e.target.value as RiskProfile })}>
                      <option value="conservative">Conservative</option>
                      <option value="moderate">Moderate</option>
                      <option value="aggressive">Aggressive</option>
                    </select>
                  </Field>
                </div>
                <Field label="TP / SL mode">
                  <Segmented value={cfg.tp_sl_mode} onChange={(v) => update({ tp_sl_mode: v })}
                    options={[{ value: "dynamic", label: "Dynamic (ATR)" }, { value: "fixed", label: "Fixed %" }]} />
                  <p className="mt-1.5 text-[11px] text-muted">
                    {cfg.tp_sl_mode === "dynamic" ? "Stop at 2× ATR, target at 2× the stop distance." : "Fixed percentage of price from the fill."}
                  </p>
                </Field>
                {cfg.tp_sl_mode === "fixed" && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Take profit %" htmlFor="cfg-tp">
                      <input id="cfg-tp" inputMode="decimal" className={`${inputCls} font-mono`} value={cfg.tp_pct ? +(cfg.tp_pct * 100).toFixed(4) : ""}
                        onChange={(e) => update({ tp_pct: Number(e.target.value) > 0 ? Number(e.target.value) / 100 : null })} />
                    </Field>
                    <Field label="Stop loss %" htmlFor="cfg-sl">
                      <input id="cfg-sl" inputMode="decimal" className={`${inputCls} font-mono`} value={cfg.sl_pct ? +(cfg.sl_pct * 100).toFixed(4) : ""}
                        onChange={(e) => update({ sl_pct: Number(e.target.value) > 0 ? Number(e.target.value) / 100 : null })} />
                    </Field>
                  </div>
                )}
                <p className="rounded-lg border border-line bg-background/50 px-3 py-2 text-xs text-muted">
                  Exposure <span className="font-mono text-foreground">{fmtUsd(cfg.amount_usdc * cfg.leverage)}</span>
                  {cfg.tp_sl_mode === "fixed" && cfg.tp_pct && cfg.sl_pct && (
                    <> · TP <span className="text-accent">{fmtUsd(cfg.amount_usdc * cfg.leverage * cfg.tp_pct, true)}</span> · SL{" "}
                      <span className="text-danger">{fmtUsd(-cfg.amount_usdc * cfg.leverage * cfg.sl_pct, true)}</span></>
                  )}
                </p>
              </div>

              <div className="space-y-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Intelligence &amp; execution</p>
                <Field label="Planner model (picks the strategy, supervises positions)">
                  <ModelPicker
                    idPrefix="cfg-llm"
                    info={planner}
                    provider={cfg.llm_provider}
                    model={cfg.llm_model}
                    onChange={(llm_provider, llm_model) => update({ llm_provider, llm_model })}
                  />
                </Field>
                <Field label="Position sizing">
                  <Segmented value={cfg.risk_sizing_mode} onChange={(v) => update({ risk_sizing_mode: v })}
                    options={[{ value: "fixed", label: "Fixed" }, { value: "kelly", label: "Kelly" }, { value: "vol_scaling", label: "Vol-scaled" }]} />
                </Field>
                <Field label="Indicators (chart + planner context)">
                  <div className="flex flex-wrap gap-1.5">
                    {INDICATORS.map((ind) => {
                      const on = cfg.indicators.includes(ind);
                      return (
                        <button key={ind} type="button" aria-pressed={on}
                          onClick={() => update({ indicators: on ? cfg.indicators.filter((x) => x !== ind) : [...cfg.indicators, ind] })}
                          className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${on ? "border-accent/50 bg-accent/10 text-accent" : "border-line text-muted hover:text-foreground"}`}>
                          {ind}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <Field label="Execution">
                  <div className="space-y-2">
                    <div className="rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-xs">
                      <p className="font-medium text-accent">Paper · NEAR Intents pricing</p>
                      <p className="mt-0.5 text-muted">Every fill is a real 1Click dry-run quote. No funds move.</p>
                    </div>
                    <div className="rounded-lg border border-line px-3 py-2 text-xs opacity-60">
                      <p className="font-medium">Live agent · coming next</p>
                      <p className="mt-0.5 text-muted">
                        Autonomous live execution needs agent sub-accounts with scoped keys. Until then, trade live by hand from the Order tab.
                      </p>
                    </div>
                  </div>
                </Field>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              {loading && (
                <div className="flex flex-col items-center gap-3 py-14 text-sm text-muted">
                  <Loader2 className="size-6 animate-spin text-accent" />
                  Reading {cfg.symbol} {cfg.timeframe} market regime and planning a strategy…
                </div>
              )}
              {error && !loading && (
                <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm">
                  <p className="text-danger">{error}</p>
                  <button type="button" onClick={fetchPlan} className="mt-3 rounded-full border border-line px-3 py-1 text-xs">Retry</button>
                </div>
              )}
              {analysis && sp && s && !loading && (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${analysis.planner !== "rules" ? "border-accent/40 text-accent" : "border-line text-muted"}`}>
                      <Sparkles className="size-3" />{" "}
                      {analysis.planner !== "rules"
                        ? `Planned by ${PROVIDER_SHORT[analysis.planner] ?? analysis.planner}`
                        : "Rule-based plan"}
                    </span>
                    {analysis.planner_model && <span className="font-mono text-[11px] text-muted">{analysis.planner_model}</span>}
                    <span className="text-muted">{analysis.symbol} · {analysis.timeframe} · {analysis.bar_count} bars</span>
                  </div>
                  {analysis.planner_note && <p className="text-[11px] text-amber-300">{analysis.planner_note}</p>}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-line bg-background/50 p-4">
                      <p className="text-[10px] uppercase tracking-wider text-muted">Strategy selected</p>
                      <p className="mt-1 text-lg font-semibold">{humanize(sp.strategy)}</p>
                      <dl className="mt-2 grid grid-cols-3 gap-2 font-mono text-xs">
                        <div><dt className="text-muted">Lookback</dt><dd>{sp.lookback} bars</dd></div>
                        <div><dt className="text-muted">Threshold</dt><dd>{sp.threshold < 0.1 ? `${(sp.threshold * 100).toFixed(3)}%` : sp.threshold.toFixed(2)}</dd></div>
                        <div><dt className="text-muted">Max loss</dt><dd>{(sp.max_loss_pct * 100).toFixed(1)}%</dd></div>
                      </dl>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {analysis.strategy_shortlist.map((x) => (
                          <span key={x} className={`rounded-full border px-2 py-0.5 text-[10px] ${x === sp.strategy ? "border-accent/50 text-accent" : "border-line text-muted"}`}>{humanize(x)}</span>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-line bg-background/50 p-4">
                      <p className="text-[10px] uppercase tracking-wider text-muted">Market regime</p>
                      <dl className="mt-2 grid grid-cols-2 gap-2 font-mono text-xs">
                        <div><dt className="text-muted">Price</dt><dd>{fmtPrice(s.last_price)}</dd></div>
                        <div><dt className="text-muted">24h</dt><dd>{fmtPct(s.change_24h_pct)}</dd></div>
                        <div><dt className="text-muted">ATR</dt><dd>{fmtPrice(s.atr)} ({s.atr_pct ? (s.atr_pct * 100).toFixed(2) : "—"}%)</dd></div>
                        <div><dt className="text-muted">ADX</dt><dd>{s.adx?.toFixed(1) ?? "—"}</dd></div>
                        <div><dt className="text-muted">Volatility (ann.)</dt><dd>{s.realized_vol_recent ? `${(s.realized_vol_recent * 100).toFixed(0)}%` : "—"}</dd></div>
                        <div><dt className="text-muted">MA slope</dt><dd>{s.ma_slope !== null ? fmtPct(s.ma_slope * 100) : "—"}</dd></div>
                      </dl>
                    </div>
                  </div>
                  <div className="rounded-xl border border-line bg-background/50 p-4">
                    <p className="text-[10px] uppercase tracking-wider text-muted">Analysis</p>
                    <p className="mt-2 text-sm leading-6">{analysis.analysis_paragraph}</p>
                  </div>
                  <div className="rounded-xl border border-line bg-background/50 p-4">
                    <p className="text-[10px] uppercase tracking-wider text-muted">Quant algorithm</p>
                    <p className="mt-2 text-sm leading-6">{analysis.quant_algo_description}</p>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 2 && analysis && (
            <div className="space-y-4">
              <div className="rounded-xl border border-accent/40 bg-accent/5 p-4 text-sm">
                <p className="font-medium text-accent">Paper session</p>
                <p className="mt-1 text-muted">Simulated positions, real NEAR Intents prices. Nothing is signed and no funds move.</p>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                {[
                  ["Asset", market?.pair],
                  ["Margin", fmtUsd(cfg.amount_usdc)],
                  ["Leverage", `${cfg.leverage}x`],
                  ["Exposure", fmtUsd(cfg.amount_usdc * cfg.leverage)],
                  ["Risk", cfg.risk_profile],
                  ["Strategy", humanize(analysis.strategy_plan.strategy)],
                  ["TP / SL", cfg.tp_sl_mode === "dynamic" ? "Dynamic (ATR)" : `${fmtPct((cfg.tp_pct ?? 0) * 100)} / ${fmtPct(-(cfg.sl_pct ?? analysis.strategy_plan.max_loss_pct) * 100)}`],
                  ["Timeframe", cfg.timeframe],
                  ["Sizing", cfg.risk_sizing_mode.replace("_", " ")],
                  ["Planner", analysis.planner === "rules" ? "rules" : `${PROVIDER_SHORT[analysis.planner] ?? analysis.planner}`],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-line bg-background/50 p-3">
                    <dt className="text-[10px] uppercase tracking-wider text-muted">{k}</dt>
                    <dd className="mt-1 font-mono">{v}</dd>
                  </div>
                ))}
              </dl>
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-4">
          <button type="button" disabled={step === 0 || loading} onClick={() => setStep((x) => x - 1)} className="rounded-full border border-line px-4 py-2 text-sm disabled:opacity-40">
            Back
          </button>
          {step === 0 && (
            <button type="button" onClick={fetchPlan} disabled={!(cfg.amount_usdc > 0)} className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-background disabled:opacity-50">
              Get AI plan →
            </button>
          )}
          {step === 1 && (
            <button type="button" onClick={() => setStep(2)} disabled={!analysis || loading} className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-background disabled:opacity-50">
              Review →
            </button>
          )}
          {step === 2 && (
            <button type="button" onClick={run} disabled={loading} className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-background disabled:opacity-50">
              {loading ? "Starting…" : "Start paper agent"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
