"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban,
  Bot,
  CheckCircle2,
  CircleDashed,
  Download,
  FlaskConical,
  Loader2,
  Lock,
  Play,
  Plus,
  X,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { Card } from "@/components/dashboard/Card";
import { ModelPicker, usePlannerInfo } from "@/components/llm/ModelPicker";
import { AgentBrain } from "@/components/agents/AgentBrain";
import { RunCharts } from "@/components/agents/RunCharts";
import { AssetPicker, chainOf, symbolOf, useCatalogue } from "@/components/agents/AssetPicker";
import {
  ALLOCATION_CODE,
  nixoApi,
  type AgentId,
  type AgentStep,
  type AuditEvent,
  type Catalogue,
  type ExperimentConfig,
  type RunReport,
  type RunSummary,
  type StepOutcome,
} from "@/lib/nixo/experiment";
import { PROVIDER_SHORT } from "@/lib/trading/api";

const DEFAULTS: ExperimentConfig = {
  allocation_usdc: "1000",
  task_targets: [
    { asset: "NEAR@near", usdc: "300" },
    { asset: "ETH@eth", usdc: "200" },
    { asset: "SOL@sol", usdc: "100" },
  ],
  steps: 8,
  max_trade_amount: "200",
  max_total_spend: "1000",
  allowed_assets: [ALLOCATION_CODE, "NEAR@near", "ETH@eth", "SOL@sol"],
  allowed_chains: ["near", "eth", "sol"],
  recipients: {},
  market: "recorded",
  llm_provider: "auto",
  llm_model: null,
  fee_bps: 30,
  run_adversarial: true,
  revoke_at_end: true,
};
const PHASES = ["setup", "task", "adversarial", "revocation", "done"] as const;
const COMMON_CHAINS = ["near", "eth", "sol", "base", "arb", "btc", "bsc"];
const ADDRESS_HINT: Record<string, string> = {
  eth: "0x…", base: "0x…", arb: "0x…", op: "0x…", bsc: "0x…", pol: "0x…", avax: "0x…",
  sol: "Solana address", btc: "bc1… or 1…/3…", near: "account.near",
};

const inputCls =
  "w-full rounded-lg border border-line bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-50";

// ---------------------------------------------------------------- formatting

function num(s: string | null | undefined, dp = 2): string {
  if (s === null || s === undefined || s === "") return "—";
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-US", { maximumFractionDigits: dp });
}

/** "0.0541 ETH on eth" for an amount of a SYMBOL@chain code (USDC on NEAR shown as plain USDC). */
function amt(s: string | null | undefined, code: string = ALLOCATION_CODE): string {
  const sym = symbolOf(code);
  const chain = chainOf(code);
  const dp = sym.toUpperCase().startsWith("USD") ? 2 : 6;
  return `${num(s, dp)} ${sym}${chain && chain !== "near" ? ` on ${chain}` : ""}`;
}

const assetLabel = (code: string) => `${symbolOf(code)}${chainOf(code) !== "near" ? ` (${chainOf(code)})` : ""}`;

function time(ts: number | null | undefined): string {
  return ts ? new Date(ts * 1000).toLocaleTimeString() : "—";
}

function sourceLabel(src: string): string {
  if (src === "rules") return "rules";
  if (src === "rules_fallback") return "rules (LLM fallback)";
  const [p, ...m] = src.split(":");
  return `${PROVIDER_SHORT[p] ?? p} · ${m.join(":")}`;
}

// ---------------------------------------------------------------- small pieces

function Tag({ tone, children, title }: { tone: "clean" | "reject" | "mock" | "warn" | "muted" | "accent"; children: React.ReactNode; title?: string }) {
  const cls = {
    clean: "border-clean/40 bg-clean-bg text-clean",
    reject: "border-reject/40 bg-reject-bg text-reject",
    mock: "border-mock/40 bg-mock-bg text-mock",
    warn: "border-amber-300/40 bg-amber-300/10 text-amber-300",
    muted: "border-line text-muted",
    accent: "border-accent/40 bg-accent/10 text-accent",
  }[tone];
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${cls}`}>
      {children}
    </span>
  );
}

function OutcomeTag({ o }: { o: Pick<StepOutcome, "status" | "reason"> }) {
  switch (o.status) {
    case "executed":
      return <Tag tone="clean">executed</Tag>;
    case "rejected":
      return <Tag tone="reject" title={o.reason ?? undefined}>rejected · {o.reason}</Tag>;
    case "failed":
      return <Tag tone="warn" title={o.reason ?? undefined}>failed · {o.reason}</Tag>;
    case "held":
      return <Tag tone="mock">held · fail-closed</Tag>;
    default:
      return <Tag tone="muted">hold</Tag>;
  }
}

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs text-muted">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function KV({ k, v, mono = true }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-xs">
      <dt className="text-muted">{k}</dt>
      <dd className={`text-right ${mono ? "font-mono" : ""}`}>{v}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- setup form

function Chip({ on, children, onClick, title }: { on: boolean; children: React.ReactNode; onClick?: () => void; title?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[11px] ${on ? "border-accent/50 bg-accent/10 text-accent" : "border-line text-muted hover:text-foreground"}`}>
      {children}
    </button>
  );
}

function SetupCard({
  cfg,
  setCfg,
  onRun,
  busy,
  disabled,
  account,
}: {
  cfg: ExperimentConfig;
  setCfg: (c: ExperimentConfig) => void;
  onRun: () => void;
  busy: boolean;
  disabled: boolean;
  account: string;
}) {
  const { info } = usePlannerInfo();
  const { cat, error: catError } = useCatalogue(account);
  const up = (patch: Partial<ExperimentConfig>) => setCfg({ ...cfg, ...patch });
  const dec = (v: string) => v.replace(/[^\d.]/g, "");

  const total = cfg.task_targets.reduce((s, t) => s + (Number(t.usdc) || 0), 0);
  const over = total > (Number(cfg.allocation_usdc) || 0);
  const targetCodes = cfg.task_targets.map((t) => t.asset);
  const chains = Array.from(new Set([...COMMON_CHAINS, ...cfg.allowed_chains]));
  const moreChains = (cat?.chains.map((g) => g.chain) ?? []).filter((c) => !chains.includes(c));
  const pinnable = cfg.allowed_chains.filter((c) => c !== "near");

  // A task asset is always allowed, and so is its chain.
  const withAsset = (c: ExperimentConfig, code: string): ExperimentConfig => ({
    ...c,
    allowed_assets: c.allowed_assets.includes(code) ? c.allowed_assets : [...c.allowed_assets, code],
    allowed_chains: c.allowed_chains.includes(chainOf(code)) ? c.allowed_chains : [...c.allowed_chains, chainOf(code)],
  });
  const setLeg = (i: number, patch: Partial<{ asset: string; usdc: string }>) => {
    const legs = cfg.task_targets.map((t, j) => (j === i ? { ...t, ...patch } : t));
    setCfg(patch.asset ? withAsset({ ...cfg, task_targets: legs }, patch.asset) : { ...cfg, task_targets: legs });
  };
  const addLeg = () => {
    const pick = (cat?.chains.flatMap((g) => g.assets) ?? []).find((a) => a.code !== ALLOCATION_CODE && !targetCodes.includes(a.code) && cfg.allowed_assets.includes(a.code))
      ?? (cat?.chains.flatMap((g) => g.assets) ?? []).find((a) => a.code !== ALLOCATION_CODE && !targetCodes.includes(a.code));
    if (pick) setCfg(withAsset({ ...cfg, task_targets: [...cfg.task_targets, { asset: pick.code, usdc: "50" }] }, pick.code));
  };
  const toggleChain = (c: string) => {
    if (c === "near") return; // the allocation lives on NEAR
    if (cfg.allowed_chains.includes(c)) {
      if (targetCodes.some((t) => chainOf(t) === c)) return; // a task asset needs it
      const recipients = { ...cfg.recipients };
      delete recipients[c];
      up({ allowed_chains: cfg.allowed_chains.filter((x) => x !== c), recipients });
    } else up({ allowed_chains: [...cfg.allowed_chains, c] });
  };
  const nAttacks = 14 + 3;

  return (
    <Card title="Experiment setup">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Allocation per agent (USDC)" htmlFor="x-alloc" hint="Two equivalent, separate deposits.">
          <input id="x-alloc" inputMode="decimal" className={`${inputCls} font-mono`} value={cfg.allocation_usdc} onChange={(e) => up({ allocation_usdc: dec(e.target.value) })} />
        </Field>
        <Field label="Steps (15-min bars)" htmlFor="x-steps">
          <input id="x-steps" type="number" min={1} max={20} className={`${inputCls} font-mono`} value={cfg.steps} onChange={(e) => up({ steps: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} />
        </Field>
        <Field label="Market" htmlFor="x-market" hint="Frozen at run start; both agents see the same prices.">
          <select id="x-market" className={inputCls} value={cfg.market} onChange={(e) => up({ market: e.target.value as ExperimentConfig["market"] })}>
            <option value="recorded">Recorded prices + live 1Click routes</option>
            <option value="synthetic">Synthetic (offline, deterministic)</option>
          </select>
        </Field>
        <Field label="Run">
          <div className="space-y-1.5 text-xs">
            <label className="flex items-center gap-2"><input type="checkbox" checked={cfg.run_adversarial} onChange={(e) => up({ run_adversarial: e.target.checked })} /> Adversarial suite ({nAttacks} tests)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={cfg.revoke_at_end} onChange={(e) => up({ revoke_at_end: e.target.checked })} /> Revoke Agent B at the end</label>
          </div>
        </Field>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Task · target portfolio</p>
          <p className={`text-[11px] ${over ? "text-danger" : "text-muted"}`}>
            {total.toLocaleString("en-US")} of {Number(cfg.allocation_usdc || 0).toLocaleString("en-US")} USDC{over ? " · over the allocation" : ""}
          </p>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {cfg.task_targets.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_auto] items-center gap-2">
              <AssetPicker cat={cat} value={t.asset} label={`Task asset ${i + 1}`} exclude={[ALLOCATION_CODE, ...targetCodes.filter((c) => c !== t.asset)]}
                onChange={(code) => setLeg(i, { asset: code })} />
              <input aria-label={`USDC into ${t.asset}`} inputMode="decimal" className={`${inputCls} font-mono`} value={t.usdc} onChange={(e) => setLeg(i, { usdc: dec(e.target.value) })} />
              <button type="button" aria-label={`Remove ${t.asset}`} disabled={cfg.task_targets.length <= 1}
                onClick={() => up({ task_targets: cfg.task_targets.filter((_, j) => j !== i) })}
                className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-30">
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {cfg.task_targets.length < 4 && (
            <button type="button" onClick={addLeg} disabled={!cat} className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs hover:border-accent/50 disabled:opacity-40">
              <Plus className="size-3.5" /> Add asset
            </button>
          )}
          <p className="text-[11px] text-muted">
            {cat ? `${cat.count} tokens across ${cat.chains.length} chains via NEAR Intents.` : catError ? `Token list unavailable: ${catError}` : "Loading tokens…"} USDC on NEAR is what the agents spend.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 border-t border-line pt-4 md:grid-cols-2 xl:grid-cols-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted md:col-span-2 xl:col-span-4">
          Agent B policy · enforced by the vault
        </p>
        <Field label="Per-trade limit (USDC)" htmlFor="x-max">
          <input id="x-max" inputMode="decimal" className={`${inputCls} font-mono`} value={cfg.max_trade_amount} onChange={(e) => up({ max_trade_amount: dec(e.target.value) })} />
        </Field>
        <Field label="Total-spend limit (USDC)" htmlFor="x-total">
          <input id="x-total" inputMode="decimal" className={`${inputCls} font-mono`} value={cfg.max_total_spend} onChange={(e) => up({ max_total_spend: dec(e.target.value) })} />
        </Field>
        <Field label="Allowed chains" hint="Output on any other chain is refused (CHAIN_NOT_ALLOWED).">
          <div className="flex flex-wrap gap-1.5">
            {chains.map((c) => (
              <Chip key={c} on={cfg.allowed_chains.includes(c)} onClick={() => toggleChain(c)}
                title={c === "near" ? "Always allowed: the allocation lives on NEAR" : targetCodes.some((t) => chainOf(t) === c) ? "Needed by a task asset" : undefined}>
                {c}
              </Chip>
            ))}
            {moreChains.length > 0 && (
              <select aria-label="Allow another chain" className="rounded-full border border-line bg-background px-2 py-1 font-mono text-[11px] text-muted" value=""
                onChange={(e) => e.target.value && toggleChain(e.target.value)}>
                <option value="">+ chain</option>
                {moreChains.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </div>
        </Field>
        <Field label="Allowed tokens" hint="Swaps only; withdrawals disabled.">
          <div className="flex flex-wrap items-center gap-1.5">
            {cfg.allowed_assets.map((a) => {
              const locked = a === ALLOCATION_CODE || targetCodes.includes(a);
              return (
                <Chip key={a} on title={locked ? "Required by the task" : `Remove ${a}`}
                  onClick={locked ? undefined : () => up({ allowed_assets: cfg.allowed_assets.filter((x) => x !== a) })}>
                  {assetLabel(a)}{!locked && <X className="size-3" />}
                </Chip>
              );
            })}
          </div>
          <div className="mt-2 max-w-[220px]">
            <AssetPicker cat={cat} value="" placeholder="+ add token" label="Allow another token" exclude={cfg.allowed_assets}
              onChange={(code) => setCfg(withAsset(cfg, code))} />
          </div>
        </Field>
        {pinnable.length > 0 && (
          <div className="md:col-span-2 xl:col-span-4">
            <p className="mb-1.5 text-xs text-muted">Pinned recipients · where cross-chain output may be sent (anything else: RECIPIENT_NOT_ALLOWED)</p>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {pinnable.map((c) => (
                <label key={c} className="grid grid-cols-[56px_1fr] items-center gap-2 text-xs">
                  <span className="font-mono text-muted">{c}</span>
                  <input className={`${inputCls} font-mono text-xs`} placeholder={`Keep in vault · or your ${ADDRESS_HINT[c] ?? "address"}`}
                    value={cfg.recipients[c] ?? ""} onChange={(e) => up({ recipients: { ...cfg.recipients, [c]: e.target.value.trim() } })} />
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 grid gap-4 border-t border-line pt-4 md:grid-cols-[1fr_auto] md:items-end">
        <Field label="Model (same model and settings for both agents)">
          <ModelPicker idPrefix="x-llm" info={info} provider={cfg.llm_provider} model={cfg.llm_model}
            onChange={(llm_provider, llm_model) => up({ llm_provider, llm_model })} />
        </Field>
        <button type="button" onClick={onRun} disabled={busy || disabled || over}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-accent-ink disabled:opacity-50 md:mb-7">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {busy ? "Running…" : "Run experiment"}
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- progress

function Progress({ run }: { run: RunSummary }) {
  const idx = PHASES.indexOf(run.phase);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface/90 px-4 py-3 text-xs">
      {PHASES.map((p, i) => (
        <span key={p} className={`inline-flex items-center gap-1.5 ${i < idx || run.status === "done" ? "text-clean" : i === idx ? "text-accent" : "text-muted"}`}>
          {i < idx || run.status === "done" ? <CheckCircle2 className="size-3.5" /> : i === idx ? <Loader2 className="size-3.5 animate-spin" /> : <CircleDashed className="size-3.5" />}
          {p}{p === "task" && i === idx ? ` ${run.step}/${run.steps}` : ""}
          {i < PHASES.length - 1 && <span className="ml-1 text-line">—</span>}
        </span>
      ))}
      <span className="ml-auto font-mono text-muted">
        {run.llm?.provider ? (run.llm.provider === "rules" ? "rules agent" : `${PROVIDER_SHORT[run.llm.provider] ?? run.llm.provider} · ${run.llm.model}`) : "resolving model…"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- capital & policy

function AgentCards({ r, onRevoke, busy }: { r: RunReport; onRevoke: () => void; busy: boolean }) {
  const a = r.agents.agent_a;
  const b = r.agents.agent_b;
  const asg = b.assignment;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Agent A · baseline" action={<Tag tone="muted">no NIXO policy</Tag>}>
        <dl className="divide-y divide-line">
          <KV k="Deposit" v={a.deposit?.deposit_id} />
          <KV k="Provenance" v={<span className="inline-flex items-center gap-1.5">{a.deposit?.verification_status} <Tag tone="mock">stub</Tag></span>} />
          <KV k="Allocation" v={amt(a.deposit?.amount, a.deposit?.asset)} />
          <KV k="Allocation id" v={a.wallet?.allocation_id} />
          <KV k="Balances now" v={Object.entries(a.wallet?.balances ?? {}).map(([k, v]) => amt(v, k)).join(" · ")} />
          <KV k="Spending cap · chains · recipients" v="none" />
          <KV k="Revocation" v="none" />
          {(a.mirror_wallet?.delivered.length ?? 0) > 0 && (
            <KV k="Paid out to other addresses" v={<span className="text-reject">{a.mirror_wallet!.delivered.map((d) => `${amt(d.amount, d.asset)} → ${d.recipient.slice(0, 14)}…`).join(" · ")}</span>} />
          )}
        </dl>
        <p className="mt-3 text-[11px] leading-5 text-muted">
          Executes through the same paper adapter with only physical checks (it can&apos;t spend what it doesn&apos;t hold).
          Adversarial requests are mirrored on a fresh, equivalent allocation.
        </p>
      </Card>

      <Card
        title="Agent B · constrained"
        action={asg?.status === "revoked" ? <Tag tone="reject"><Lock className="size-3" /> revoked {time(asg.revoked_at)}</Tag> : asg ? <Tag tone="clean">active</Tag> : null}
      >
        <dl className="divide-y divide-line">
          <KV k="Deposit" v={b.deposit?.deposit_id} />
          <KV k="Provenance" v={<span className="inline-flex items-center gap-1.5">{b.deposit?.verification_status} <Tag tone="mock">stub</Tag></span>} />
          <KV k="Assignment" v={asg?.assignment_id} />
          {b.policy && (
            <>
              <KV k="Per-trade limit" v={amt(b.policy.max_trade_amount)} />
              <KV k="Total-spend limit" v={amt(b.policy.max_total_spend)} />
              <KV k="Allowed actions" v={b.policy.allowed_actions.join(", ")} />
              <KV k="Allowed chains" v={b.policy.allowed_chains.join(", ") || "—"} />
              <KV k="Allowed tokens" v={b.policy.allowed_assets.map(assetLabel).join(", ")} />
              <KV k="Pinned recipients" v={Object.keys(b.policy.recipients).length ? Object.entries(b.policy.recipients).map(([c, r]) => `${c}: ${r.slice(0, 10)}…`).join(" · ") : "none (output stays in the vault)"} />
              <KV k="Withdrawals" v={b.policy.withdrawals_allowed ? "allowed" : "blocked"} />
            </>
          )}
          {asg && (
            <>
              <KV k="Settled spend / reserved" v={`${num(asg.accounting.settled_spend)} / ${num(asg.accounting.reserved_amount)}`} />
              <KV k="Remaining" v={amt(asg.accounting.remaining)} />
              <KV k="Held by vault" v={Object.entries(asg.holdings).map(([k, v]) => amt(v, k)).join(" · ") || "—"} />
              {asg.delivered.length > 0 && <KV k="Delivered to pinned addresses" v={asg.delivered.map((d) => amt(d.amount, d.asset)).join(" · ")} />}
            </>
          )}
        </dl>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted">Every rule above is checked by the vault before execution.</p>
          <button type="button" onClick={onRevoke} disabled={busy || !asg || asg.status === "revoked"}
            className="inline-flex items-center gap-1.5 rounded-full border border-reject/50 px-3 py-1.5 text-xs text-reject hover:bg-reject-bg disabled:opacity-40">
            <Ban className="size-3.5" /> Revoke Agent B
          </button>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- task timeline

function StepCell({ s }: { s: AgentStep | undefined }) {
  if (!s) return <td className="px-3 py-2 text-muted">…</td>;
  const p = s.proposal;
  return (
    <td className="px-3 py-2 align-top">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono">{p.action === "hold" ? "hold" : `${num(p.amount_in)} USDC → ${assetLabel(p.asset_out)}`}</span>
        <OutcomeTag o={s.outcome} />
        {s.outcome.would_violate && <Tag tone="warn" title="Would have been rejected under Agent B's policy">would violate · {s.outcome.would_violate}</Tag>}
      </div>
      {s.outcome.status === "executed" && s.outcome.amount_out !== "0" && (
        <p className="mt-0.5 font-mono text-[11px] text-muted">→ {amt(s.outcome.amount_out, s.outcome.asset_out ?? p.asset_out)} @ ${num(s.outcome.price, 4)}</p>
      )}
      <details className="mt-0.5 text-[11px] text-muted">
        <summary className="cursor-pointer select-none">{sourceLabel(p.source)}{p.latency_ms ? ` · ${(p.latency_ms / 1000).toFixed(1)}s` : ""}</summary>
        <p className="mt-1 max-w-md leading-5">{p.rationale}</p>
        {p.note && <p className="text-amber-300">{p.note}</p>}
        {s.outcome.event_ids?.length ? <p className="font-mono">{s.outcome.event_ids.join(" ")}</p> : null}
      </details>
    </td>
  );
}

function TaskTable({ r }: { r: RunReport }) {
  const a = r.agents.agent_a.steps;
  const b = r.agents.agent_b.steps;
  const n = Math.max(a.length, b.length, r.status === "running" && r.phase === "task" ? r.step : 0);
  const codes = (r.task_targets ?? []).map((t) => t.asset);
  const hist = r.market?.history ?? 0;
  return (
    <Card title="Same task, side by side" action={r.market && <Tag tone="mock">{r.market.source === "synthetic" ? "synthetic market" : "recorded market"} · simulated</Tag>}>
      <p className="mb-3 text-sm leading-6">{r.task}</p>
      {r.market?.note && <p className="mb-3 text-[11px] text-amber-300">{r.market.note}</p>}
      <MarketRoutes r={r} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2">Step</th>
              {codes.map((c) => <th key={c} className="px-3 py-2">{assetLabel(c)} $</th>)}
              <th className="px-3 py-2">Agent A · baseline</th>
              <th className="px-3 py-2">Agent B · constrained</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {Array.from({ length: n }, (_, i) => (
              <tr key={i}>
                <td className="px-3 py-2 align-top font-mono">{i + 1}</td>
                {codes.map((c) => <td key={c} className="px-3 py-2 align-top font-mono">{num(r.market?.prices[c]?.[hist + i], 4)}</td>)}
                <StepCell s={a[i]} />
                <StepCell s={b[i]} />
              </tr>
            ))}
            {n === 0 && (
              <tr><td colSpan={3 + codes.length} className="px-3 py-6 text-center text-muted">Waiting for the first step…</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MarketRoutes({ r }: { r: RunReport }) {
  const m = r.market;
  if (!m) return null;
  const codes = Object.keys(r.assets ?? {}).filter((c) => c !== r.allocation_asset);
  const role = (c: string) =>
    r.task_targets.some((t) => t.asset === c) ? "task" : c === r.attack_assets?.unapproved ? "attack: unapproved" : c === r.attack_assets?.forbidden_chain ? "attack: forbidden chain" : "allowed";
  return (
    <details className="mb-3 rounded-xl border border-line bg-background/50 text-xs">
      <summary className="cursor-pointer select-none px-3 py-2 text-muted">
        Prices &amp; NEAR Intents routes · {codes.length} assets · token list from {r.catalogue_source === "1click" ? "1Click (live)" : "offline fallback"}
      </summary>
      <div className="overflow-x-auto px-3 pb-3">
        <table className="w-full min-w-[560px]">
          <thead className="text-left text-[10px] uppercase tracking-wider text-muted">
            <tr><th className="py-1.5 pr-3">Asset</th><th className="py-1.5 pr-3">Role</th><th className="py-1.5 pr-3">Price source</th><th className="py-1.5 pr-3">1Click route (100 USDC probe)</th><th className="py-1.5">Cost applied</th></tr>
          </thead>
          <tbody className="divide-y divide-line font-mono">
            {codes.map((c) => {
              const q = m.quotes?.[c];
              return (
                <tr key={c}>
                  <td className="py-1.5 pr-3">{assetLabel(c)}</td>
                  <td className="py-1.5 pr-3 text-muted">{role(c)}</td>
                  <td className="py-1.5 pr-3 text-muted">{{ binance_recorded: "recorded (Binance)", flat_1click: "flat · 1Click spot", synthetic: "synthetic" }[m.sources?.[c] ?? "synthetic"]}</td>
                  <td className="py-1.5 pr-3">{q ? (q.routable ? <span className="text-clean">✓ routable</span> : <span className="text-reject" title={q.error}>✕ {q.error?.slice(0, 40)}</span>) : <span className="text-muted">not probed</span>}</td>
                  <td className="py-1.5">{m.costs_bps?.[c] ? `${(Number(m.costs_bps[c]) / 100).toFixed(2)}%` : `${(r.config.fee_bps / 100).toFixed(2)}% (flat fee)`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- results

function Comparison({ r }: { r: RunReport }) {
  if (!r.comparison.length) return null;
  return (
    <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
      <Card title="Comparison">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wider text-muted">
              <tr><th className="px-3 py-2">Metric</th><th className="px-3 py-2">Agent A</th><th className="px-3 py-2">Agent B</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.comparison.map((row) => (
                <tr key={row.metric}>
                  <td className="px-3 py-2 text-muted">{row.metric}</td>
                  <td className="px-3 py-2 font-mono">{row.agent_a}</td>
                  <td className={`px-3 py-2 font-mono ${row.metric === "Policy violations executed" ? (row.agent_b === "0" ? "text-clean" : "text-reject") : ""}`}>{row.agent_b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Success criteria (§3.3)">
        <ul className="space-y-2 text-sm">
          {r.success_criteria.map((c) => (
            <li key={c.criterion} className="flex gap-2">
              {c.met ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-clean" /> : c.met === null ? <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-reject" />}
              <span className={c.met === false ? "text-reject" : ""}>{c.criterion}</span>
            </li>
          ))}
          {!r.success_criteria.length && <li className="text-muted">Shown when the run finishes.</li>}
        </ul>
        <p className="mt-4 border-t border-line pt-3 text-[11px] leading-5 text-muted">
          The proof is not that B makes more money: it&apos;s that B stays useful without unrestricted control of the capital.
        </p>
      </Card>
    </div>
  );
}

function Adversarial({ r }: { r: RunReport }) {
  if (!r.adversarial.length) return null;
  return (
    <Card title={`Adversarial suite · ${r.adversarial_passed}/${r.adversarial_total} passed`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2">Test</th>
              <th className="px-3 py-2">Expected (Agent B)</th>
              <th className="px-3 py-2">Actual (Agent B)</th>
              <th className="px-3 py-2">Same request on Agent A</th>
              <th className="px-3 py-2">Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {r.adversarial.map((t) => (
              <tr key={t.id} className="align-top">
                <td className="px-3 py-2">
                  <div className="flex items-start gap-2">
                    {t.passed ? <ShieldCheck className="mt-0.5 size-4 shrink-0 text-clean" /> : <ShieldAlert className="mt-0.5 size-4 shrink-0 text-reject" />}
                    <div>
                      <p>{t.name}</p>
                      <p className="font-mono text-[10px] text-muted">{t.id} · {t.plan_ref}{t.detail ? ` · ${t.detail}` : ""}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-muted">{t.expected}</td>
                <td className={`px-3 py-2 font-mono ${t.passed ? "text-clean" : "text-reject"}`}>{t.actual}</td>
                <td className="px-3 py-2">{t.baseline ? <OutcomeTag o={t.baseline} /> : <span className="text-muted">—</span>}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-muted">{t.event_ids.join(" ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function OwnerConsole({ r, account, onReport, cat }: { r: RunReport; account: string; onReport: (r: RunReport) => void; cat: Catalogue | null }) {
  const [agent, setAgent] = useState<AgentId>("agent_b");
  const [action, setAction] = useState<"swap" | "withdraw">("swap");
  const [amount, setAmount] = useState("50");
  const [asset, setAsset] = useState(r.task_targets?.[0]?.asset ?? "NEAR@near");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = r.status === "done" || r.status === "error";

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await nixoApi.attempt(account, r.run_id, {
        agent, action, amount_in: amount, asset_out: action === "swap" ? asset : null,
        destination: action === "withdraw" ? "external.near" : null, recipient: action === "swap" && recipient ? recipient : null,
      });
      onReport(res.report);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Revocation & owner console">
      {r.revocation && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-background/50 p-3 text-xs">
            <p className="text-muted">After revoking B, B requested swap {num(r.revocation.post_revoke_request.amount_in)} USDC</p>
            <p className="mt-1.5"><OutcomeTag o={{ status: r.revocation.agent_b.status as StepOutcome["status"], reason: r.revocation.agent_b.reason }} /></p>
          </div>
          <div className="rounded-xl border border-line bg-background/50 p-3 text-xs">
            <p className="text-muted">Agent A, same request (no NIXO revoke control)</p>
            <p className="mt-1.5"><OutcomeTag o={r.revocation.agent_a} /></p>
          </div>
        </div>
      )}
      <p className="mb-3 text-[11px] text-muted">
        Send your own request through the same path. Agent B&apos;s go to the vault first; Agent A&apos;s go straight to the adapter.
      </p>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-[auto_auto_110px_200px_1fr_auto]">
        <select aria-label="Agent" className={inputCls} value={agent} onChange={(e) => setAgent(e.target.value as AgentId)}>
          <option value="agent_b">Agent B</option>
          <option value="agent_a">Agent A</option>
        </select>
        <select aria-label="Action" className={inputCls} value={action} onChange={(e) => setAction(e.target.value as "swap" | "withdraw")}>
          <option value="swap">swap</option>
          <option value="withdraw">withdraw</option>
        </select>
        <input aria-label="Amount (USDC)" inputMode="decimal" className={`${inputCls} font-mono`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        <AssetPicker cat={cat} value={asset} label="Buy asset" exclude={[ALLOCATION_CODE]} onChange={setAsset} />
        <input aria-label="Recipient (optional)" disabled={action !== "swap"} className={`${inputCls} font-mono text-xs`}
          placeholder={`Recipient on ${chainOf(asset)} · empty = keep in vault`} value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} />
        <button type="button" onClick={send} disabled={!ready || busy || !(Number(amount) > 0)}
          className="rounded-full border border-accent/50 px-4 py-2 text-sm text-accent disabled:opacity-40">
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
      {!ready && <p className="mt-2 text-[11px] text-muted">Available when the run finishes.</p>}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      {r.manual_attempts.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line text-xs">
          {[...r.manual_attempts].reverse().map((m) => (
            <li key={m.request.request_id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="font-mono text-muted">{time(m.at)}</span>
              <span>{m.agent === "agent_b" ? "B" : "A"}</span>
              <span className="font-mono">{m.request.action} {num(m.request.amount_in)} USDC{m.request.asset_out ? ` → ${assetLabel(m.request.asset_out)}` : ""}{m.request.recipient ? ` to ${m.request.recipient.slice(0, 14)}…` : ""}</span>
              <OutcomeTag o={m.outcome} />
              <span className="ml-auto font-mono text-[10px] text-muted">{m.event_ids.join(" ")}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const EVENT_TONE: Record<string, "clean" | "reject" | "mock" | "warn" | "muted" | "accent"> = {
  trade_settled: "clean",
  trade_authorized: "accent",
  trade_rejected: "reject",
  post_revoke_attempt_rejected: "reject",
  revoke_rejected: "reject",
  agent_revoked: "reject",
  trade_failed: "warn",
  trade_held: "mock",
  assignment_frozen: "mock",
};

function AuditTrail({ r, account, events, error }: { r: RunReport; account: string; events: AuditEvent[] | null; error: string | null }) {
  const [agent, setAgent] = useState<"all" | AgentId | "none">("all");
  const [type, setType] = useState("all");

  const types = useMemo(() => Array.from(new Set((events ?? []).map((e) => e.event_type))).sort(), [events]);
  const shown = (events ?? []).filter(
    (e) => (agent === "all" || (agent === "none" ? !e.agent_id : e.agent_id === agent)) && (type === "all" || e.event_type === type),
  );

  async function exportJson() {
    const data = await nixoApi.audit(account, r.run_id);
    const blob = new Blob([JSON.stringify({ report: r, audit: data }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nixo-${r.run_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card
      title={`Audit trail · ${r.audit_count} events`}
      action={
        <button type="button" onClick={exportJson} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs hover:border-accent/50">
          <Download className="size-3.5" /> Export JSON
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select aria-label="Filter by agent" className={`${inputCls} w-auto`} value={agent} onChange={(e) => setAgent(e.target.value as typeof agent)}>
          <option value="all">All agents</option>
          <option value="agent_a">Agent A</option>
          <option value="agent_b">Agent B</option>
          <option value="none">Registry (deposits)</option>
        </select>
        <select aria-label="Filter by event type" className={`${inputCls} w-auto`} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All event types</option>
          {types.map((t) => <option key={t}>{t}</option>)}
        </select>
        <span className="text-[11px] text-muted">Service logs from the agents service, not on-chain events.</span>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="max-h-[420px] overflow-auto rounded-xl border border-line">
        <table className="w-full min-w-[900px] text-[11px]">
          <thead className="sticky top-0 bg-surface text-left text-[10px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-2 py-1.5">Event</th><th className="px-2 py-1.5">Phase</th><th className="px-2 py-1.5">Agent</th>
              <th className="px-2 py-1.5">Type</th><th className="px-2 py-1.5">Request</th><th className="px-2 py-1.5">Action</th>
              <th className="px-2 py-1.5">Reason</th><th className="px-2 py-1.5">Source</th><th className="px-2 py-1.5">Reference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line font-mono">
            {shown.map((e) => (
              <tr key={e.event_id}>
                <td className="px-2 py-1 text-muted">{e.event_id}</td>
                <td className="px-2 py-1 text-muted">{e.phase ?? "—"}</td>
                <td className="px-2 py-1">{e.agent_id?.replace("agent_", "").toUpperCase() ?? "—"}</td>
                <td className="px-2 py-1"><Tag tone={EVENT_TONE[e.event_type] ?? "muted"}>{e.event_type}</Tag></td>
                <td className="px-2 py-1 text-muted">{e.request_id ?? "—"}</td>
                <td className="px-2 py-1">{e.action ? `${e.action} ${num(e.amount_in)} ${e.asset_in ? symbolOf(e.asset_in) : ""}${e.asset_out ? ` → ${assetLabel(e.asset_out)}` : ""}${e.recipient ? ` to ${e.recipient.slice(0, 12)}…` : ""}` : e.amount_in ? `${num(e.amount_in)} ${e.asset_in ? symbolOf(e.asset_in) : ""}` : "—"}</td>
                <td className="px-2 py-1 text-reject">{e.reason_code ?? ""}</td>
                <td className="px-2 py-1 text-muted">{e.source}</td>
                <td className="px-2 py-1 text-muted">{e.execution_reference ?? ""}</td>
              </tr>
            ))}
            {events && !shown.length && <tr><td colSpan={9} className="px-2 py-4 text-center text-muted">No events match.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Honesty({ labels }: { labels: RunReport["labels"] }) {
  return (
    <Card title="What is real, simulated and stubbed">
      <dl className="grid gap-3 text-sm md:grid-cols-3">
        <div className="rounded-xl border border-line bg-background/50 p-3"><dt className="font-medium">Execution</dt><dd className="mt-1 text-xs leading-5 text-muted">{labels.execution}</dd></div>
        <div className="rounded-xl border border-line bg-background/50 p-3"><dt className="font-medium">Provenance</dt><dd className="mt-1 text-xs leading-5 text-muted">{labels.provenance}</dd></div>
        <div className="rounded-xl border border-line bg-background/50 p-3"><dt className="font-medium">Enforcement</dt><dd className="mt-1 text-xs leading-5 text-muted">{labels.enforcement}</dd></div>
      </dl>
      <p className="mt-3 text-[11px] leading-5 text-muted">
        Real: the LLM decisions, the vault&apos;s checks and accounting, and (in recorded mode) the Binance prices and live NEAR Intents
        route checks. Cross-chain output is simulated too: &ldquo;delivered&rdquo; means the vault would have released it to that address.
        Revocation blocks new actions; it can&apos;t undo a trade that already settled.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------- page

export default function AgentsPage() {
  const { accountId } = useWallet();
  const account = accountId ?? "";
  const [cfg, setCfg] = useState<ExperimentConfig>(DEFAULTS);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [report, setReport] = useState<RunReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    if (!account) return;
    try {
      const { runs } = await nixoApi.list(account);
      setRuns(runs);
      setRunId((cur) => cur ?? runs[0]?.run_id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [account]);

  useEffect(() => {
    if (!account) return;
    let stop = false;
    nixoApi
      .list(account)
      .then(({ runs }) => {
        if (stop) return;
        setRuns(runs);
        setRunId((cur) => cur ?? runs[0]?.run_id ?? null);
      })
      .catch((e: Error) => !stop && setError(e.message));
    return () => {
      stop = true;
    };
  }, [account]);

  const active = report?.status === "running" || report?.status === "pending";
  const { cat } = useCatalogue(account);

  // Audit events feed the brain graph, the charts and the audit table. Refetch when the count changes.
  const [audit, setAudit] = useState<{ runId: string; events: AuditEvent[] } | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const auditRun = report?.run_id;
  const auditCount = report?.audit_count;
  useEffect(() => {
    if (!account || !auditRun) return;
    let stop = false;
    nixoApi
      .audit(account, auditRun)
      .then((x) => {
        if (stop) return;
        setAudit({ runId: auditRun, events: x.events });
        setAuditError(null);
      })
      .catch((e: Error) => !stop && setAuditError(e.message));
    return () => {
      stop = true;
    };
  }, [account, auditRun, auditCount]);
  const events = audit && audit.runId === report?.run_id ? audit.events : null;

  // Load the selected run; keep polling every 2 s while it is still running.
  useEffect(() => {
    if (!account || !runId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const r = await nixoApi.get(account, runId);
        if (stop) return;
        setReport(r);
        if (r.status === "running" || r.status === "pending") timer = setTimeout(load, 2000);
        else void loadRuns();
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [account, runId, loadRuns]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await nixoApi.start(account, cfg);
      setReport(r);
      setRunId(r.run_id);
      void loadRuns();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!report) return;
    setError(null);
    try {
      setReport(await nixoApi.revoke(account, report.run_id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!accountId) return null;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker !text-[10px]">Agents &amp; vaults · NIXO v0.1</p>
          <h1 className="display text-2xl">Verified capital &amp; agent authorization</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            Two agents, the same task and equivalent capital. Agent B works through an authorization vault that enforces its
            owner&apos;s rules at the transaction boundary; Agent A is the unrestricted baseline.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Tag tone="mock">simulated execution</Tag>
          <Tag tone="mock">stub provenance</Tag>
          <Tag tone="warn">service-enforced · off-chain</Tag>
        </div>
      </div>

      <SetupCard cfg={cfg} setCfg={setCfg} onRun={run} busy={busy || Boolean(active)} disabled={!account} account={account} />

      {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">{error}</p>}

      {runs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <FlaskConical className="size-3.5 text-muted" />
          <span className="text-muted">Runs:</span>
          {runs.map((x) => (
            <button key={x.run_id} type="button" onClick={() => setRunId(x.run_id)} aria-pressed={x.run_id === runId}
              className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${x.run_id === runId ? "border-accent/50 text-accent" : "border-line text-muted hover:text-foreground"}`}>
              {time(x.started_at)} · {x.status === "done" ? `${x.adversarial_passed}/${x.adversarial_total}` : x.status}
            </button>
          ))}
        </div>
      )}

      {!report && !runs.length && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line py-14 text-sm text-muted">
          <Bot className="size-6" />
          Configure the experiment and press Run. A full run with an LLM takes about a minute.
        </div>
      )}

      {report && (
        <>
          <Progress run={report} />
          {report.llm?.note && <p className="text-[11px] text-amber-300">{report.llm.note}</p>}
          {report.error && <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">Run failed: {report.error}</p>}
          {events && report.agents.agent_b.assignment && (
            <>
              <Card title="Inside the run · how the agents decide and what the vault does">
                <AgentBrain report={report} events={events} />
              </Card>
              <RunCharts report={report} events={events} />
            </>
          )}
          {report.agents.agent_b.assignment && <AgentCards r={report} onRevoke={revoke} busy={busy} />}
          <TaskTable r={report} />
          <Comparison r={report} />
          <Adversarial r={report} />
          {report.agents.agent_b.assignment && <OwnerConsole r={report} account={account} onReport={setReport} cat={cat} />}
          <AuditTrail r={report} account={account} events={events} error={auditError} />
          <Honesty labels={report.labels} />
        </>
      )}
    </div>
  );
}
