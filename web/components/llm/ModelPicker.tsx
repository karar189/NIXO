"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleSlash, Loader2, PlugZap, RefreshCw, TriangleAlert } from "lucide-react";
import { llmApi, tradingApi, type LlmChoice, type LlmProvider, type PingResult, type PlannerInfo } from "@/lib/trading/api";

const inputCls =
  "w-full rounded-lg border border-line bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-50";

/** Planner status: which providers are configured and which "auto" is skipping. */
export function usePlannerInfo() {
  const [info, setInfo] = useState<PlannerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    tradingApi
      .planner()
      .then((p) => {
        setInfo(p);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  return { info, error, reload: load };
}

function providerState(p: LlmProvider) {
  if (!p.configured) return { tone: "text-muted", label: "no key" };
  if (p.cooldown) return { tone: "text-amber-300", label: "skipped by auto" };
  return { tone: "text-clean", label: "ready" };
}

/**
 * Provider + optional model override. "auto" walks the configured providers in
 * order and falls through on failure; "rules" uses no LLM.
 */
export function ModelPicker({
  provider,
  model,
  onChange,
  info,
  idPrefix = "llm",
}: {
  provider: LlmChoice;
  model: string | null | undefined;
  onChange: (provider: LlmChoice, model: string | null) => void;
  info: PlannerInfo | null;
  idPrefix?: string;
}) {
  // Model catalog for the selected provider, keyed so a provider switch never shows stale models.
  const [catalog, setCatalog] = useState<{ key: string; models: string[] | null; error: string | null } | null>(null);
  const concrete = provider !== "auto" && provider !== "rules" ? (provider === "claude" ? "anthropic" : provider) : null;
  const p = info?.providers.find((x) => x.name === concrete);
  const models = catalog?.key === concrete ? catalog.models : null;
  const modelsError = catalog?.key === concrete ? catalog.error : null;

  useEffect(() => {
    if (!concrete || !p?.configured) return;
    let stop = false;
    llmApi
      .models(concrete)
      .then((r) => !stop && setCatalog({ key: concrete, models: r.models, error: null }))
      .catch((e: Error) => !stop && setCatalog({ key: concrete, models: null, error: e.message }));
    return () => {
      stop = true;
    };
  }, [concrete, p?.configured]);

  const autoFirst = info?.providers.find((x) => x.configured && !x.cooldown);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select
          id={`${idPrefix}-provider`}
          aria-label="LLM provider"
          className={inputCls}
          value={provider === "claude" ? "anthropic" : provider}
          onChange={(e) => onChange(e.target.value as LlmChoice, null)}
        >
          <option value="auto">Auto (fallback chain)</option>
          {(info?.providers ?? []).map((x) => (
            <option key={x.name} value={x.name} disabled={!x.configured}>
              {x.label}
              {!x.configured ? " — no key" : x.cooldown ? " — skipped by auto" : ""}
            </option>
          ))}
          <option value="rules">Rules (no LLM)</option>
        </select>
        <select
          id={`${idPrefix}-model`}
          aria-label="Model"
          className={`${inputCls} font-mono text-xs`}
          disabled={!concrete || !p?.configured}
          value={model ?? ""}
          onChange={(e) => onChange(provider, e.target.value || null)}
        >
          <option value="">{p ? `Default · ${p.default_model}` : provider === "rules" ? "—" : "Provider default"}</option>
          {(models ?? []).filter((m) => m !== p?.default_model).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <p className="text-[11px] leading-5 text-muted">
        {provider === "rules"
          ? "Deterministic rule-based logic. No model is called."
          : provider === "auto"
            ? autoFirst
              ? <>Auto starts with <span className="text-foreground">{autoFirst.label}</span> ({autoFirst.default_model}) and falls through to the next configured provider on any failure.</>
              : info
                ? "No provider is ready — the rule-based fallback will be used."
                : "Checking providers…"
            : p?.cooldown
              ? <span className="text-amber-300">Last call failed ({p.cooldown}). It will be tried first, then the others.</span>
              : <>Tried first{model ? ` with ${model}` : ""}; other providers are the fallback.</>}
        {modelsError && <span className="block text-amber-300">Model list unavailable: {modelsError}</span>}
      </p>
    </div>
  );
}

/** Provider table with a live "Test" button per provider. */
export function ProvidersPanel() {
  const { info, error, reload } = usePlannerInfo();
  const [pings, setPings] = useState<Record<string, PingResult | "pending">>({});

  async function test(name: string) {
    setPings((s) => ({ ...s, [name]: "pending" }));
    try {
      const r = await llmApi.ping(name);
      setPings((s) => ({ ...s, [name]: r }));
    } catch (e) {
      setPings((s) => ({ ...s, [name]: { provider: name, model: null, ok: false, error: (e as Error).message } }));
    }
    void reload();
  }

  if (error) return <p className="text-sm text-danger">Agents service unreachable: {error}</p>;
  if (!info) return <p className="text-sm text-muted">Loading providers…</p>;

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-line rounded-xl border border-line">
        {info.providers.map((p, i) => {
          const st = providerState(p);
          const ping = pings[p.name];
          return (
            <li key={p.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
              <span className="w-4 font-mono text-[11px] text-muted">{i + 1}</span>
              <span className="min-w-[9rem] font-medium">{p.label}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={p.default_model}>
                {p.default_model}
              </span>
              <span className={`inline-flex items-center gap-1 text-[11px] ${st.tone}`}>
                {!p.configured ? <CircleSlash className="size-3" /> : p.cooldown ? <TriangleAlert className="size-3" /> : <CheckCircle2 className="size-3" />}
                {st.label}
              </span>
              <button
                type="button"
                disabled={!p.configured || ping === "pending"}
                onClick={() => test(p.name)}
                className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] hover:border-accent/50 disabled:opacity-40"
              >
                {ping === "pending" ? <Loader2 className="size-3 animate-spin" /> : <PlugZap className="size-3" />}
                Test
              </button>
              {p.cooldown && <p className="basis-full pl-7 text-[11px] text-amber-300">{p.cooldown}</p>}
              {ping && ping !== "pending" && (
                <p className={`basis-full pl-7 text-[11px] ${ping.ok ? "text-clean" : "text-danger"}`}>
                  {ping.ok ? `OK · ${ping.model} · ${ping.latency_ms} ms` : `${ping.kind ?? "error"}: ${ping.error}`}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between text-[11px] text-muted">
        <span>Order is LLM_PROVIDER_ORDER in the root .env. Keys stay on the agents service.</span>
        <button type="button" onClick={() => void reload()} className="inline-flex items-center gap-1 hover:text-foreground">
          <RefreshCw className="size-3" /> Refresh
        </button>
      </div>
    </div>
  );
}
