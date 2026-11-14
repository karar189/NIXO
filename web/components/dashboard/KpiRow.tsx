"use client";

import { formatNear, yoctoToNear } from "@/lib/near/rpc";
import { formatPct, formatUsd } from "@/lib/market";
import { useDashboardData } from "./DashboardData";
import { Skeleton } from "./Card";

type Kpi = {
  label: string;
  /** null = still loading; string = ready (use "—" for unavailable). */
  value: string | null;
  sub: string;
  tone: "up" | "down" | "muted" | "error";
};

export function KpiRow() {
  const { balance, quotes } = useDashboardData();
  const near = quotes.data?.near;
  const balanceFailed = Boolean(balance.error) && !balance.notFound && !balance.data;
  const totalNear = balance.data ? yoctoToNear(balance.data.total) : balance.notFound ? 0 : null;

  const kpis: Kpi[] = [
    {
      label: "Available balance",
      value: balance.data
        ? `${formatNear(balance.data.available)} NEAR`
        : balance.notFound
          ? "0 NEAR"
          : balanceFailed
            ? "—"
            : null,
      sub: balance.notFound
        ? "Account not funded yet"
        : balanceFailed
          ? "Couldn't reach NEAR RPC"
          : "Spendable, after storage",
      tone: balanceFailed ? "error" : "muted",
    },
    {
      label: "Account value",
      value:
        totalNear !== null && near
          ? formatUsd(totalNear * near.usd)
          : balanceFailed || quotes.error
            ? "—"
            : null,
      sub: near
        ? `NEAR ${formatPct(near.change24h)} today`
        : quotes.error
          ? "Price feed unavailable"
          : "Fetching price…",
      tone: near ? (near.change24h >= 0 ? "up" : "down") : quotes.error ? "error" : "muted",
    },
    { label: "Active agents", value: "0", sub: "Create your first agent", tone: "muted" },
    { label: "24h agent P&L", value: "—", sub: "No trades yet", tone: "muted" },
  ];

  const toneClass = {
    up: "text-accent",
    down: "text-danger",
    error: "text-danger",
    muted: "text-muted",
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((k) => (
        <div key={k.label} className="rounded-2xl border border-line bg-surface/90 p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{k.label}</p>
          <div className="mt-3 h-8">
            {k.value === null ? (
              <Skeleton className="h-7 w-32" />
            ) : (
              <p className="truncate text-2xl font-semibold tracking-tight">{k.value}</p>
            )}
          </div>
          <p className={`mt-2 text-xs ${toneClass[k.tone]}`}>{k.sub}</p>
        </div>
      ))}
    </div>
  );
}
