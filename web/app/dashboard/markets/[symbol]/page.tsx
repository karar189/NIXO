"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { AssetSwapPanel } from "@/components/markets/AssetSwapPanel";
import { TokenIcon } from "@/components/markets/TokenIcon";
import { fmtCompactUsd, fmtPct, fmtUsdPrice } from "@/lib/markets/format";
import type { MarketToken } from "@/lib/markets/types";

export default function MarketAssetPage() {
  const params = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(params.symbol ?? "").toUpperCase();
  const [tokens, setTokens] = useState<MarketToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const res = await fetch("/api/markets?per_page=80", { cache: "no-store" });
        if (!res.ok) throw new Error(`Markets unavailable (${res.status})`);
        const data = (await res.json()) as { tokens: MarketToken[] };
        if (!stop) setTokens(data.tokens ?? []);
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : "Failed to load asset");
      } finally {
        if (!stop) setLoading(false);
      }
    })();
    return () => {
      stop = true;
    };
  }, []);

  const token = useMemo(
    () => tokens.find((t) => t.symbol === symbol) ?? null,
    [tokens, symbol],
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 px-4 py-6 sm:px-6 lg:py-8">
      <Link
        href="/dashboard/markets"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to markets
      </Link>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <section className="rounded-2xl border border-line bg-surface/90 p-5">
          {loading && !token ? (
            <div className="h-40 animate-pulse rounded-xl bg-surface-2/50" />
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <TokenIcon symbol={symbol} image={token?.image} size={44} />
                  <div>
                    <p className="kicker !text-[10px]">{token?.name ?? "Asset"}</p>
                    <h1 className="display mt-1 text-2xl">{symbol}</h1>
                  </div>
                </div>
                {token && (
                  <div className="text-right">
                    <p className="font-mono text-3xl tracking-tight">{fmtUsdPrice(token.price)}</p>
                    <p className={`mt-1 font-mono text-sm ${token.change24h >= 0 ? "text-clean" : "text-danger"}`}>
                      {fmtPct(token.change24h)} <span className="text-muted">24h</span>
                    </p>
                  </div>
                )}
              </div>

              {token ? (
                <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ["Market cap", fmtCompactUsd(token.marketCap)],
                    ["24h volume", fmtCompactUsd(token.volume24h)],
                    ["7d change", fmtPct(token.change7d)],
                    ["Rank", token.rank ? `#${token.rank}` : "—"],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl border border-line bg-background/50 px-3 py-3">
                      <dt className="text-[10px] uppercase tracking-wider text-muted">{k}</dt>
                      <dd className="mt-1 font-mono text-sm">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                !loading && (
                  <p className="mt-6 text-sm text-muted">
                    No live quote for {symbol}. You can still swap NEAR ↔ USDC from your wallet on the right.
                  </p>
                )
              )}

              <div className="mt-6 rounded-xl border border-accent-2/25 bg-accent-2/5 px-4 py-3 text-xs leading-5 text-muted">
                Swap this asset against <span className="text-foreground">NEAR</span> or{" "}
                <span className="text-foreground">USDC</span> available in your connected account. Confidential
                Intents settles live NEAR ↔ USDC on mainnet; other desk pairs open the Swap desk.
              </div>
            </>
          )}
        </section>

        <aside className="rounded-2xl border border-line bg-surface/90 p-5">
          <AssetSwapPanel
            symbol={symbol}
            liveEnabled={token?.liveEnabled ?? (symbol === "NEAR" || symbol === "USDC")}
            deskSymbol={
              token?.deskSymbol ??
              (["NEAR", "BTC", "ETH", "SOL", "USDC"].includes(symbol) ? symbol : null)
            }
          />
        </aside>
      </div>
    </div>
  );
}
