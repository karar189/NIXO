"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, RefreshCw, Search } from "lucide-react";
import { TokenIcon } from "@/components/markets/TokenIcon";
import { fmtCompactUsd, fmtPct, fmtUsdPrice } from "@/lib/markets/format";
import type { MarketTab, MarketToken } from "@/lib/markets/types";

const TABS: MarketTab[] = ["All", "Gainers", "Losers"];

function ChangePill({ v }: { v: number }) {
  const pos = v >= 0;
  const Icon = pos ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md px-2 py-0.5 font-mono text-[11px] ${
        pos ? "bg-clean/10 text-clean" : "bg-danger/10 text-danger"
      }`}
    >
      <Icon className="size-3" />
      {fmtPct(v)}
    </span>
  );
}

function BadgeCard({
  label,
  accent,
  tokens,
}: {
  label: string;
  accent: string;
  tokens: MarketToken[];
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface/90">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`size-1.5 rounded-full ${accent}`} />
          <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{label}</h2>
        </div>
        <span className="text-[10px] text-muted">24h</span>
      </header>
      <ul className="divide-y divide-line/70">
        {tokens.length === 0
          ? Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="h-12 animate-pulse bg-surface-2/40" />
            ))
          : tokens.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/dashboard/markets/${encodeURIComponent(t.symbol)}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/60"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <TokenIcon symbol={t.symbol} image={t.image} size={26} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{t.symbol}</p>
                      <p className="truncate text-[10px] text-muted">{t.deskSymbol ? "Desk" : "Spot"}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[13px]">{fmtUsdPrice(t.price)}</p>
                    <div className="mt-0.5 flex justify-end">
                      <ChangePill v={t.change24h} />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
      </ul>
    </section>
  );
}

export default function MarketsPage() {
  const [tokens, setTokens] = useState<MarketToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<MarketTab>("All");
  const [search, setSearch] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/markets?per_page=50", { cache: "no-store" });
      if (!res.ok) throw new Error(`Markets unavailable (${res.status})`);
      const data = (await res.json()) as { tokens: MarketToken[]; updatedAt: string };
      setTokens(data.tokens ?? []);
      setUpdatedAt(data.updatedAt ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load markets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const popular = useMemo(() => {
    const want = ["BTC", "ETH", "NEAR", "SOL", "USDC"];
    return want.map((s) => tokens.find((t) => t.symbol === s)).filter(Boolean) as MarketToken[];
  }, [tokens]);

  const movers = useMemo(
    () => [...tokens].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, 5),
    [tokens],
  );

  const desk = useMemo(() => tokens.filter((t) => t.deskSymbol).slice(0, 5), [tokens]);

  const rows = useMemo(() => {
    let list = [...tokens];
    if (tab === "Gainers") list = list.filter((t) => t.change24h > 0).sort((a, b) => b.change24h - a.change24h);
    if (tab === "Losers") list = list.filter((t) => t.change24h < 0).sort((a, b) => a.change24h - b.change24h);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
      );
    }
    return list;
  }, [tokens, tab, search]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 px-4 py-6 sm:px-6 lg:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">Desk · Markets</p>
          <h1 className="display mt-2 text-2xl">Markets</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Top assets by market cap. Open any token to swap against NEAR or USDC held in your wallet.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm text-muted hover:text-foreground"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
          {updatedAt && (
            <span className="font-mono text-[10px] text-muted">
              · {new Date(updatedAt).toLocaleTimeString()}
            </span>
          )}
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <BadgeCard label="Popular" accent="bg-accent" tokens={popular} />
        <BadgeCard label="Top movers" accent="bg-accent-2" tokens={movers} />
        <BadgeCard label="NIXO desk" accent="bg-clean" tokens={desk} />
      </div>

      <section className="overflow-hidden rounded-2xl border border-line bg-surface/90">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <div className="flex rounded-lg border border-line bg-background p-0.5" role="tablist">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  tab === t ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search symbol or name…"
              className="w-full rounded-lg border border-line bg-background py-2 pl-9 pr-3 text-sm focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Asset</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">24h</th>
                <th className="px-4 py-3 font-medium">7d</th>
                <th className="px-4 py-3 font-medium">Volume</th>
                <th className="px-4 py-3 font-medium">Market cap</th>
                <th className="px-4 py-3 font-medium">Rail</th>
              </tr>
            </thead>
            <tbody>
              {loading && tokens.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-muted">
                    Loading markets…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-muted">
                    No assets match this filter.
                  </td>
                </tr>
              ) : (
                rows.map((t, i) => (
                  <tr key={t.id} className="border-b border-line/60 transition-colors hover:bg-surface-2/40">
                    <td className="px-4 py-3 font-mono text-xs text-muted">{t.rank ?? i + 1}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/markets/${encodeURIComponent(t.symbol)}`}
                        className="flex items-center gap-2.5"
                      >
                        <TokenIcon symbol={t.symbol} image={t.image} size={28} />
                        <span>
                          <span className="block font-medium">{t.symbol}</span>
                          <span className="block text-[11px] text-muted">{t.name}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono">{fmtUsdPrice(t.price)}</td>
                    <td className="px-4 py-3">
                      <ChangePill v={t.change24h} />
                    </td>
                    <td className={`px-4 py-3 font-mono text-xs ${(t.change7d ?? 0) >= 0 ? "text-clean" : "text-danger"}`}>
                      {fmtPct(t.change7d)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{fmtCompactUsd(t.volume24h)}</td>
                    <td className="px-4 py-3 font-mono text-xs">{fmtCompactUsd(t.marketCap)}</td>
                    <td className="px-4 py-3">
                      {t.liveEnabled ? (
                        <span className="rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
                          Live swap
                        </span>
                      ) : t.deskSymbol ? (
                        <span className="rounded-md border border-accent-2/30 bg-accent-2/10 px-2 py-0.5 text-[10px] text-accent-2">
                          Desk
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted">Track</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
