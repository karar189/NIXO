"use client";

import { useEffect, useState } from "react";
import { tradingApi, type Decision, type LogEntry, type SessionStatus, type Statistics, type Trade } from "@/lib/trading/api";
import { fmtPct, fmtPrice, fmtQty, fmtUsd, humanize, pnlTone } from "@/lib/trading/format";

const LEVEL_STYLE: Record<string, string> = {
  error: "border-danger/40 text-danger",
  warn: "border-amber-400/40 text-amber-300",
  action: "border-accent/40 text-accent",
  sl_tp: "border-accent-2/40 text-accent-2",
  supervisor: "border-accent-2/40 text-accent-2",
  start: "border-accent/40 text-accent",
  stop: "border-line text-muted",
};

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-background/50 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 font-mono text-sm ${tone}`}>{value}</p>
    </div>
  );
}

function PositionCard({ status, running }: { status: NonNullable<SessionStatus["session"]>; running: boolean }) {
  const p = status.position;
  if (!p) {
    return (
      <div className="rounded-xl border border-dashed border-line px-4 py-3 text-xs text-muted">
        No open position.{" "}
        {status.mode === "agent" && running
          ? status.paused
            ? "Agent is paused — no new entries."
            : "The agent is watching for an entry signal."
          : ""}
      </div>
    );
  }
  const f = p.entry_fill;
  return (
    <div className="rounded-xl border border-line bg-background/50 p-3">
      <div className="flex items-center justify-between">
        <span className={`rounded-md px-2 py-0.5 font-mono text-xs ${p.side === "LONG" ? "bg-accent/15 text-accent" : "bg-danger/15 text-danger"}`}>
          {p.side} {p.leverage}x
        </span>
        <span className={`font-mono text-sm ${pnlTone(p.unrealized_pnl)}`}>
          {fmtUsd(p.unrealized_pnl, true)} <span className="text-xs">({fmtPct(p.roe_pct)})</span>
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
        {[
          ["Entry", fmtPrice(p.entry_price)],
          ["Mark", fmtPrice(p.mark_price)],
          ["Size", `${fmtQty(p.qty)}`],
          ["Take profit", fmtPrice(p.tp_price)],
          ["Stop loss", fmtPrice(p.sl_price)],
          ["Liquidation", fmtPrice(p.liq_price)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted">{k}</dt>
            <dd className="mt-0.5 font-mono">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 border-t border-line pt-2 text-[11px] leading-5 text-muted">
        {f.source === "intents" ? (
          <>
            Filled by a NEAR Intents 1Click quote, {f.slippage_bps >= 0 ? "+" : ""}
            {f.slippage_bps.toFixed(1)} bps vs mark
            {f.correlation_id && <> · quote <span className="font-mono">{f.correlation_id.slice(0, 8)}</span></>}
          </>
        ) : (
          <>Filled at mark price — {f.note ?? "1Click quote unavailable"}</>
        )}
      </p>
    </div>
  );
}

function Logs({ logs }: { logs: LogEntry[] }) {
  const rows = [...logs].reverse().slice(0, 120);
  if (!rows.length) return <p className="py-8 text-center text-xs text-muted">Logs appear once a session starts.</p>;
  return (
    <ol className="max-h-[300px] space-y-1.5 overflow-y-auto pr-1 font-mono text-[11px] leading-5">
      {rows.map((l, i) => (
        <li key={`${l.ts}-${i}`} className="flex gap-2">
          <span className="shrink-0 text-muted/70">{l.ts.slice(11, 19)}</span>
          <span className={`h-fit shrink-0 rounded border px-1 text-[9px] uppercase ${LEVEL_STYLE[l.level] ?? "border-line text-muted"}`}>
            {l.level}
          </span>
          <span className="min-w-0 break-words text-foreground/85">{l.message}</span>
        </li>
      ))}
    </ol>
  );
}

function History({ account, active }: { account: string; active: boolean }) {
  const [data, setData] = useState<{ decisions: Decision[]; trades: Trade[] } | null>(null);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const load = () => tradingApi.history(account).then((d) => !stop && setData(d)).catch(() => {});
    void load();
    const id = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [account, active]);

  if (!data) return <p className="py-8 text-center text-xs text-muted">Loading…</p>;
  const filled = data.decisions.filter((d) => d.status === "filled").length;
  const rejected = data.decisions.length - filled;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {[["Filled", filled], ["Rejected", rejected], ["Closed trades", data.trades.length]].map(([k, v]) => (
          <span key={k} className="rounded-full border border-line px-2 py-0.5 text-muted">
            {k} <span className="font-mono text-foreground">{v}</span>
          </span>
        ))}
      </div>
      {data.trades.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted">No closed trades yet.</p>
      ) : (
        <div className="max-h-[260px] overflow-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-surface text-muted">
              <tr>
                {["Closed", "Side", "Entry → Exit", "PnL", "Reason"].map((h) => (
                  <th key={h} className="pb-2 pr-2 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono">
              {data.trades.map((t) => (
                <tr key={t.id} className="border-t border-line/60">
                  <td className="py-1.5 pr-2 text-muted">{new Date(t.closed_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                  <td className={`pr-2 ${t.side === "LONG" ? "text-accent" : "text-danger"}`}>{t.symbol} {t.side[0]} {t.leverage}x</td>
                  <td className="pr-2">{fmtPrice(t.entry_price)} → {fmtPrice(t.exit_price)}</td>
                  <td className={`pr-2 ${pnlTone(t.pnl)}`}>{fmtUsd(t.pnl, true)}</td>
                  <td className="text-muted">{humanize(t.close_reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AgentPanel({
  account,
  status,
  logs,
  stats,
}: {
  account: string;
  status: SessionStatus | null;
  logs: LogEntry[];
  stats: Statistics | null;
}) {
  const [tab, setTab] = useState<"logs" | "history">("logs");
  const session = status?.session ?? null;
  const unreal = stats?.unrealized_pnl ?? 0;
  const total = (stats?.total_pnl ?? 0) + unreal;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-background/50 p-4">
        <p className="text-[10px] uppercase tracking-wider text-muted">Session P&amp;L (realized + open)</p>
        <p className={`mt-1 text-2xl font-semibold tracking-tight ${pnlTone(total)}`}>{fmtUsd(total, true)}</p>
        <p className="mt-1 text-[11px] text-muted">
          Realized {fmtUsd(stats?.total_pnl ?? 0, true)} · open {fmtUsd(unreal, true)} · all sessions{" "}
          {fmtUsd(stats?.lifetime_pnl ?? 0, true)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Trades" value={String(stats?.total_trades ?? 0)} />
        <Stat label="Win rate" value={stats?.total_trades ? `${(stats.win_rate * 100).toFixed(0)}%` : "—"} />
        <Stat label="Avg profit" value={stats?.avg_profit ? fmtUsd(stats.avg_profit, true) : "—"} tone="text-accent" />
        <Stat label="Avg loss" value={stats?.avg_loss ? fmtUsd(stats.avg_loss, true) : "—"} tone="text-danger" />
        <Stat
          label="Avg Intents slippage"
          value={stats?.avg_slippage_bps != null ? `${stats.avg_slippage_bps.toFixed(1)} bps` : "—"}
        />
        <Stat label="Intents fills" value={String(stats?.intents_fills ?? 0)} />
      </div>

      {session && <PositionCard status={session} running={Boolean(status?.running)} />}

      <div className="rounded-xl border border-line bg-background/50 p-3">
        <div className="mb-3 flex gap-1" role="tablist">
          {(["logs", "history"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-md px-2.5 py-1 text-xs ${tab === t ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}
            >
              {t === "logs" ? "Agent logs" : "Trade history"}
            </button>
          ))}
        </div>
        {tab === "logs" ? <Logs logs={logs} /> : <History account={account} active={tab === "history"} />}
      </div>
    </div>
  );
}
