"use client";

import { ExternalLink } from "lucide-react";
import { tradingApi } from "@/lib/trading/api";
import { fmtPrice } from "@/lib/trading/format";
import { usePolling } from "@/lib/usePolling";

const TONE: Record<string, string> = {
  SUCCESS: "text-clean",
  REFUNDED: "text-warn",
  FAILED: "text-danger",
  TX_FAILED: "text-danger",
};

/** Real swaps the live agent made through NEAR Intents, with explorer links. */
export function LiveOrders() {
  const live = usePolling(() => tradingApi.liveStatus(), 5000);
  const d = live.data;
  if (!d) return null;
  return (
    <div className="space-y-2 rounded-xl border border-danger/40 bg-danger/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium text-danger">Live agent · NEAR Intents mainnet</span>
        <span className="font-mono text-muted">
          {d.spent_24h_usdc}/{d.caps.daily_budget_usdc} USDC 24h · {d.confidential ? "confidential" : "public"} settlement
        </span>
      </div>
      {d.balances && !d.balances.error && (
        <p className="font-mono text-[11px] text-muted">
          {d.account}: {Number(d.balances.usdc ?? 0).toFixed(2)} USDC
          {d.markets.map((m) => ` · ${Number(d.balances?.[m] ?? 0).toPrecision(4)} ${m}`).join("")}
        </p>
      )}
      {d.orders.length === 0 ? (
        <p className="text-[11px] text-muted">No live orders yet. The agent swaps when its signal fires.</p>
      ) : (
        <ul className="divide-y divide-line/60 text-[11px]">
          {d.orders.slice(0, 8).map((o) => (
            <li key={o.order_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5">
              <span>
                <span className={o.side === "BUY" ? "text-clean" : "text-danger"}>{o.side}</span> {o.symbol}
                {o.side === "BUY" && <span className="text-muted"> · {o.usdc_in} USDC</span>}
                <span className="text-muted"> @ {fmtPrice(o.price ?? o.quoted_price)}</span>
              </span>
              <span className={`font-mono ${TONE[o.status] ?? "text-muted"}`}>{o.status.replace(/_/g, " ").toLowerCase()}</span>
              <span className="flex gap-2">
                {o.tx_explorer && (
                  <a href={o.tx_explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent-2 hover:underline">
                    tx <ExternalLink className="size-3" />
                  </a>
                )}
                <a href={o.explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent-2 hover:underline">
                  intents <ExternalLink className="size-3" />
                </a>
              </span>
              {o.error && <span className="w-full text-danger">{o.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
