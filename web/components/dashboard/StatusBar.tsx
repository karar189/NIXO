"use client";

import { useSyncExternalStore } from "react";
import { TICKER_COINS, formatPct, formatUsd } from "@/lib/market";
import { useDashboardData } from "./DashboardData";

const TICK_MS = 15_000;
const subscribeClock = (onChange: () => void) => {
  const id = setInterval(onChange, TICK_MS);
  return () => clearInterval(id);
};
// Snapshot must be stable between calls, so bucket the time.
const clockSnapshot = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;

function Clock() {
  const now = useSyncExternalStore(subscribeClock, clockSnapshot, () => null);
  return (
    <span>
      {now === null ? "" : new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

export function StatusBar() {
  const { blockHeight, quotes } = useDashboardData();
  const online = blockHeight.data !== null && !blockHeight.error;

  return (
    <footer className="relative z-10 flex h-9 shrink-0 items-center gap-4 overflow-hidden border-t border-line bg-surface/80 px-4 font-mono text-[11px] text-muted backdrop-blur-sm">
      <span className={`flex shrink-0 items-center gap-1.5 ${online ? "text-accent" : "text-danger"}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-accent" : "bg-danger"}`} />
        {online ? "RPC ONLINE" : blockHeight.loading ? "CONNECTING" : "RPC OFFLINE"}
      </span>
      {blockHeight.data !== null && (
        <span className="hidden shrink-0 sm:inline">#{blockHeight.data.toLocaleString("en-US")}</span>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-5 overflow-hidden">
        {TICKER_COINS.map(({ id, symbol }) => {
          const q = quotes.data?.[id];
          return (
            <span key={id} className="flex shrink-0 items-center gap-1.5">
              <span className="text-foreground/80">{symbol}</span>
              <span>{q ? formatUsd(q.usd, q.usd < 10 ? 3 : 0) : "—"}</span>
              {q && (
                <span className={q.change24h >= 0 ? "text-accent" : "text-danger"}>
                  {formatPct(q.change24h)}
                </span>
              )}
            </span>
          );
        })}
      </div>

      <span className="hidden shrink-0 md:inline">
        <Clock />
      </span>
    </footer>
  );
}
