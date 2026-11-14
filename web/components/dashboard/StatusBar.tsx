"use client";

import { useSyncExternalStore } from "react";
import { TICKER_COINS, formatPct, formatUsd } from "@/lib/market";
import { useDashboardData } from "./DashboardData";

const TICK_MS = 15_000;
const subscribeClock = (onChange: () => void) => {
  const id = setInterval(onChange, TICK_MS);
  return () => clearInterval(id);
};
const clockSnapshot = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;

function Clock() {
  const now = useSyncExternalStore(subscribeClock, clockSnapshot, () => null);
  return (
    <span className="tabular-nums">
      {now === null ? "" : new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

/** One crawl segment — duplicated so the loop never gaps. */
function CrawlSegment({
  online,
  connecting,
  block,
  quotes,
}: {
  online: boolean;
  connecting: boolean;
  block: number | null;
  quotes: ReturnType<typeof useDashboardData>["quotes"];
}) {
  return (
    <div className="flex shrink-0 items-center gap-6 pr-10">
      <span className={`flex items-center gap-1.5 ${online ? "text-accent" : "text-danger"}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-accent" : "bg-danger"}`} />
        {online ? "RPC ONLINE" : connecting ? "CONNECTING" : "RPC OFFLINE"}
      </span>
      {block !== null && <span>#{block.toLocaleString("en-US")}</span>}
      <span className="text-line" aria-hidden>
        ◆
      </span>
      {TICKER_COINS.map(({ id, symbol }) => {
        const q = quotes.data?.[id];
        return (
          <span key={id} className="flex items-center gap-1.5">
            <span className="text-foreground/85">{symbol}</span>
            <span className="tabular-nums text-foreground">{q ? formatUsd(q.usd, q.usd < 10 ? 3 : 0) : "—"}</span>
            {q && (
              <span className={`tabular-nums ${q.change24h >= 0 ? "text-accent" : "text-danger"}`}>
                {formatPct(q.change24h)}
              </span>
            )}
          </span>
        );
      })}
      <span className="text-line" aria-hidden>
        ◆
      </span>
      <span className="tracking-[0.18em] text-accent-2 uppercase">Live markets</span>
    </div>
  );
}

export function StatusBar() {
  const { blockHeight, quotes } = useDashboardData();
  const online = blockHeight.data !== null && !blockHeight.error;
  const block = blockHeight.data;

  const props = {
    online,
    connecting: blockHeight.loading,
    block,
    quotes,
  };

  return (
    <footer className="news-ticker relative z-10 flex h-9 shrink-0 items-center overflow-hidden border-t border-line bg-surface/90 font-mono text-[11px] text-muted backdrop-blur-sm">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-surface to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center bg-gradient-to-l from-surface via-surface to-transparent pl-16 pr-4">
        <span className="hidden text-muted md:inline">
          <Clock />
        </span>
      </div>

      <div className="news-ticker-track flex w-max items-center">
        <CrawlSegment {...props} />
        <CrawlSegment {...props} />
        <CrawlSegment {...props} />
        <div aria-hidden="true" className="flex">
          <CrawlSegment {...props} />
          <CrawlSegment {...props} />
          <CrawlSegment {...props} />
        </div>
      </div>
    </footer>
  );
}
