"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Bot, Loader2, Pause, Play, Plus, Square } from "lucide-react";
import { Card } from "./Card";
import { useAgentSession } from "./AgentSession";
import { AgentSetupModal, DEFAULT_CONFIG } from "@/components/trade/AgentSetupModal";
import { PROVIDER_SHORT, tradingApi, type Market, type SessionConfig } from "@/lib/trading/api";
import { fmtPrice, fmtUsd, humanize, pnlTone } from "@/lib/trading/format";

const AGENTS_HINT = "Start the agents service with `pnpm dev:agents` (or `pnpm dev`) and set AGENTS_API_URL on the web server.";

export function AgentsCard() {
  const s = useAgentSession();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [config, setConfig] = useState<SessionConfig>(DEFAULT_CONFIG);
  const [setupOpen, setSetupOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    tradingApi.markets().then(setMarkets).catch(() => {});
  }, []);

  const session = s?.status?.session ?? null;
  const running = Boolean(s?.running);
  const account = s?.account ?? "";
  const canCreate = Boolean(s) && !running && markets.length > 0 && !s?.error;

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setActionError(null);
    try {
      await fn();
      await s?.refresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const stats = s?.stats ?? null;
  const unreal = stats?.unrealized_pnl ?? 0;
  const total = (stats?.total_pnl ?? 0) + unreal;
  const lastLog = s?.logs.length ? s.logs[s.logs.length - 1] : null;
  const position = running ? session?.position : null;

  return (
    <Card
      title="Your agents"
      action={
        <button
          type="button"
          disabled={!canCreate}
          title={running ? "Stop the current agent first" : !s || s.error ? "Agents service unreachable" : undefined}
          onClick={() => setSetupOpen(true)}
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="size-3.5" /> New agent
        </button>
      }
    >
      {running && session ? (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="min-w-0 rounded-xl border border-accent/40 bg-accent/5 p-3">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-sm font-medium">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full bg-accent ${session.paused ? "" : "animate-pulse"}`} />
                <span className="truncate">
                  {session.pair} · {session.mode === "agent" ? (session.paused ? "paused" : "running") : "manual position"}
                </span>
              </span>
              <span className="shrink-0 rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-muted">PAPER</span>
            </div>
            {session.strategy && (
              <p className="mt-1 truncate text-xs text-muted">
                {humanize(session.strategy.strategy)} · planned by {PROVIDER_SHORT[session.planner ?? "rules"] ?? session.planner}
                {session.planner_model && <span className="font-mono"> ({session.planner_model})</span>}
              </p>
            )}
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-2">
            <div className="min-w-0 rounded-xl border border-line bg-background/50 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wider text-muted">Session P&amp;L</p>
              <p className={`mt-1 truncate font-mono text-sm ${pnlTone(total)}`}>{fmtUsd(total, true)}</p>
            </div>
            <div className="min-w-0 rounded-xl border border-line bg-background/50 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wider text-muted">Position</p>
              <p className={`mt-1 truncate font-mono text-sm ${position ? (position.side === "LONG" ? "text-accent" : "text-danger") : "text-muted"}`}>
                {position ? `${position.side} ${position.leverage}x @ ${fmtPrice(position.entry_price)}` : "Flat · watching"}
              </p>
            </div>
          </div>

          {lastLog && (
            <p className="min-w-0 truncate font-mono text-[11px] text-muted" title={lastLog.message}>
              {lastLog.ts.slice(11, 19)} {lastLog.message}
            </p>
          )}
          {actionError && <p className="text-xs text-danger">{actionError}</p>}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {session.mode === "agent" && (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => act("pause", () => (session.paused ? tradingApi.resume(account) : tradingApi.pause(account)))}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs disabled:opacity-50"
              >
                {busy === "pause" ? <Loader2 className="size-3.5 animate-spin" /> : session.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                {session.paused ? "Resume" : "Pause"}
              </button>
            )}
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => act("stop", () => tradingApi.stop(account, true))}
              className="inline-flex items-center gap-1.5 rounded-full border border-danger/40 px-3 py-1.5 text-xs text-danger disabled:opacity-50"
            >
              {busy === "stop" ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
              {position ? "Close & stop" : "Stop"}
            </button>
            <Link href="/dashboard/trade" className="ml-auto inline-flex items-center gap-1 text-xs text-accent hover:underline">
              Open desk <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-8 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl border border-line bg-surface-2 text-accent">
            <Bot className="size-5" />
          </span>
          <p className="mt-4 font-medium">{s?.error ? "Agents service unreachable" : "No agents yet"}</p>
          <p className="mt-1 max-w-xs text-sm leading-6 text-balance text-muted">
            {s?.error
              ? AGENTS_HINT
              : "An agent reads the market regime, has an LLM pick and tune a strategy, then paper-trades it with fills priced by NEAR Intents 1Click quotes. No funds move."}
          </p>
          {s?.error && <p className="mt-2 font-mono text-[11px] text-danger">{s.error}</p>}
          {!s?.error && (
            <button
              type="button"
              disabled={!canCreate}
              onClick={() => setSetupOpen(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-accent/50 px-4 py-1.5 text-xs text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              <Plus className="size-3.5" /> Create your first agent
            </button>
          )}
          {actionError && <p className="mt-2 text-xs text-danger">{actionError}</p>}
        </div>
      )}

      {setupOpen && s && (
        <AgentSetupModal
          open
          onClose={() => setSetupOpen(false)}
          account={account}
          markets={markets}
          initial={config}
          onStarted={(cfg) => {
            setConfig(cfg);
            void s.refresh();
          }}
        />
      )}
    </Card>
  );
}

const TRADE_COLUMNS = ["Agent", "Pair", "Side", "Size", "Price", "Status", "Time"];

const timeOf = (unix: number) => new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function RecentTrades() {
  const s = useAgentSession();
  const session = s?.status?.session ?? null;
  const open = s?.running ? session?.position : null;
  const trades = s?.history?.trades ?? [];
  const empty = !open && trades.length === 0;

  return (
    <Card title="Recent trades">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              {TRADE_COLUMNS.map((c) => (
                <th key={c} scope="col" className="pb-3 pr-4 font-mono text-[11px] font-normal uppercase tracking-wider text-muted">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {empty ? (
              <tr>
                <td colSpan={TRADE_COLUMNS.length} className="py-10 text-center font-sans text-sm text-muted">
                  {s?.error ? "Agents service unreachable." : "No trades yet. Paper and live trades from your agents will show up here."}
                </td>
              </tr>
            ) : (
              <>
                {open && session && (
                  <tr className="border-b border-line/60">
                    <td className="py-2 pr-4 text-muted">{open.strategy ? humanize(open.strategy) : "manual"}</td>
                    <td className="py-2 pr-4">{session.pair}</td>
                    <td className={`py-2 pr-4 ${open.side === "LONG" ? "text-accent" : "text-danger"}`}>{open.side} {open.leverage}x</td>
                    <td className="py-2 pr-4">{fmtUsd(open.notional)}</td>
                    <td className="py-2 pr-4">{fmtPrice(open.entry_price)} → {fmtPrice(open.mark_price)}</td>
                    <td className={`py-2 pr-4 ${pnlTone(open.unrealized_pnl)}`}>open · {fmtUsd(open.unrealized_pnl, true)}</td>
                    <td className="py-2 text-muted">{timeOf(open.opened_at)}</td>
                  </tr>
                )}
                {trades.slice(0, 8).map((t) => (
                  <tr key={t.id} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pr-4 text-muted">{t.strategy ? humanize(t.strategy) : "manual"}</td>
                    <td className="py-2 pr-4">{t.symbol}/USDC</td>
                    <td className={`py-2 pr-4 ${t.side === "LONG" ? "text-accent" : "text-danger"}`}>{t.side} {t.leverage}x</td>
                    <td className="py-2 pr-4">{fmtUsd(t.notional)}</td>
                    <td className="py-2 pr-4">{fmtPrice(t.entry_price)} → {fmtPrice(t.exit_price)}</td>
                    <td className={`py-2 pr-4 ${pnlTone(t.pnl)}`}>{humanize(t.close_reason)} · {fmtUsd(t.pnl, true)}</td>
                    <td className="py-2 text-muted">{timeOf(t.closed_at)}</td>
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
