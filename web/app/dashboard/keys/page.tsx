"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { PageHeader } from "@/components/dashboard/ui";
import { Card } from "@/components/dashboard/Card";
import { DeployCopyAgent } from "@/components/keys/DeployCopyAgent";
import { Sparkline } from "@/components/keys/Sparkline";
import { ago, StatsGrid, TraderPanel } from "@/components/keys/TraderPanel";
import { copyApi, type CopyConfig } from "@/lib/copykeys/api";
import { periodLabel, yoctoToNear } from "@/lib/copykeys/sdk";
import { fmtUsd } from "@/lib/trading/format";
import { usePolling } from "@/lib/usePolling";

const ACCOUNT_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
type Tab = "leaderboard" | "sell" | "following";

export default function KeysPage() {
  return (
    <Suspense fallback={null}>
      <KeysDesk />
    </Suspense>
  );
}

function KeysDesk() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const trader = params.get("trader");
  const tab = (params.get("tab") as Tab | null) ?? "leaderboard";
  const [input, setInput] = useState(trader ?? "");
  const [inputError, setInputError] = useState<string | null>(null);
  const [cfg, setCfg] = useState<CopyConfig | null>(null);

  const [shownTrader, setShownTrader] = useState(trader);
  if (trader !== shownTrader) {
    // Keep the input in sync when the URL changes (leaderboard click, back button).
    setShownTrader(trader);
    setInput(trader ?? "");
  }
  useEffect(() => {
    copyApi.config().then(setCfg).catch(() => setCfg(null));
  }, []);

  function go(next: { trader?: string | null; tab?: Tab }) {
    const q = new URLSearchParams(params.toString());
    if (next.trader !== undefined) {
      if (next.trader) q.set("trader", next.trader);
      else q.delete("trader");
    }
    if (next.tab) q.set("tab", next.tab);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }

  function lookUp(e: React.FormEvent) {
    e.preventDefault();
    const id = input.trim().toLowerCase();
    if (!ACCOUNT_RE.test(id)) {
      setInputError("Enter a NEAR account ID, e.g. alice.testnet");
      return;
    }
    setInputError(null);
    go({ trader: id });
  }

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 py-6 sm:px-6">
      <PageHeader
        kicker="07 · Viewing keys · copy trading"
        title="Copy a profitable agent"
        description={
          <>
            Paste a trader&apos;s NEAR ID to see their public agent PnL. Subscribe on-chain to decrypt their agent trades live in your browser, and
            optionally auto-mirror them into your paper account. Only <span className="text-foreground">agent sessions</span> are shared.
          </>
        }
        actions={<DeployCopyAgent />}
      />

      <form onSubmit={lookUp} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface/90 p-4 sm:flex-row sm:items-center">
        <label htmlFor="trader-id" className="sr-only">
          Trader NEAR account ID
        </label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            id="trader-id"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a trader ID, e.g. alice.testnet"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-xl border border-line bg-background py-2.5 pl-9 pr-3 font-mono text-sm"
          />
        </div>
        <button type="submit" className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink">
          Look up <ArrowRight className="size-4" />
        </button>
        {trader && (
          <button type="button" onClick={() => go({ trader: null })} className="rounded-xl border border-line px-4 py-2.5 text-sm text-muted">
            Clear
          </button>
        )}
      </form>
      {inputError && <p className="-mt-3 text-xs text-danger">{inputError}</p>}

      {trader && <TraderPanel trader={trader} cfg={cfg} />}

      <div className="flex gap-1 rounded-xl border border-line bg-surface p-1 sm:w-fit" role="tablist">
        {(
          [
            ["leaderboard", "Leaderboard"],
            ["sell", "Sell my keys"],
            ["following", "Following"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => go({ tab: id })}
            className={`flex-1 rounded-lg px-4 py-1.5 text-sm sm:flex-none ${tab === id ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "leaderboard" && <Leaderboard onPick={(t) => go({ trader: t })} />}
      {tab === "sell" && <SellTab cfg={cfg} />}
      {tab === "following" && <FollowingTab onPick={(t) => go({ trader: t })} />}

      <p className="rounded-xl border border-line bg-background/50 px-4 py-3 text-xs leading-5 text-muted">
        What a key does and doesn&apos;t do: a key decrypts NIXO&apos;s encrypted log of a trader&apos;s agent trades for the epochs you paid for.
        It doesn&apos;t hide vault or Intents transfers on explorers, and a subscriber can re-share what they see. Public PnL is computed by the
        NIXO service from 1Click-priced paper fills and backed by a hash chain. It is not a zero-knowledge proof.
      </p>
    </div>
  );
}

function Leaderboard({ onPick }: { onPick: (trader: string) => void }) {
  const board = usePolling(() => copyApi.leaderboard(), 20000);
  if (board.error && !board.data) return <p className="text-sm text-danger">{board.error}</p>;
  const traders = board.data?.traders ?? [];
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {board.loading && !board.data
        ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-44 animate-pulse rounded-2xl border border-line bg-surface/60" />)
        : traders.map((t) => (
            <button
              key={t.trader}
              type="button"
              onClick={() => onPick(t.trader)}
              className="flex flex-col gap-3 rounded-2xl border border-line bg-surface/90 p-4 text-left transition-colors hover:border-accent/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm">{t.profile?.label ?? t.trader}</p>
                  <p className="truncate text-[11px] text-muted">{t.profile?.style ?? t.trader}</p>
                </div>
                {t.demo ? (
                  <span className="shrink-0 rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[10px] text-warn">demo</span>
                ) : t.listing ? (
                  <span className="shrink-0 rounded-full border border-accent/40 px-2 py-0.5 text-[10px] text-accent">
                    {yoctoToNear(t.listing.price_per_period)} NEAR / {periodLabel(t.listing.period_secs)}
                  </span>
                ) : null}
              </div>
              {t.stats && <Sparkline points={t.stats.equity} />}
              {t.stats && (
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <span>
                    <span className="block text-[9px] uppercase tracking-wider text-muted">PnL</span>
                    <span className={`font-mono ${t.stats.total_pnl >= 0 ? "text-clean" : "text-danger"}`}>{fmtUsd(t.stats.total_pnl, true)}</span>
                  </span>
                  <span>
                    <span className="block text-[9px] uppercase tracking-wider text-muted">Win rate</span>
                    <span className="font-mono">{Math.round(t.stats.win_rate * 100)}%</span>
                  </span>
                  <span>
                    <span className="block text-[9px] uppercase tracking-wider text-muted">Trades</span>
                    <span className="font-mono">{t.stats.trades}</span>
                  </span>
                </div>
              )}
            </button>
          ))}
      {board.data && traders.length === 0 && <p className="text-sm text-muted">No traders are selling keys yet.</p>}
    </div>
  );
}

function SellTab({ cfg }: { cfg: CopyConfig | null }) {
  const { accountId } = useWallet();
  const me = usePolling(() => copyApi.me(accountId!), 10000, [accountId], Boolean(accountId));
  if (!accountId) return <p className="text-sm text-muted">Connect your wallet to sell keys.</p>;
  const m = me.data;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card
        title="Your agent, as followers see it"
        action={<DeployCopyAgent />}
        description={
          m?.listing?.active
            ? `Live at ${yoctoToNear(m.listing.price_per_period)} NEAR / ${periodLabel(m.listing.period_secs)} · ${yoctoToNear(m.listing.earned_total)} NEAR earned`
            : "Not listed. Press Deploy copy agent to start selling access."
        }
      >
        {m ? (
          <div className="space-y-3">
            <StatsGrid card={m} />
            {m.stats && <Sparkline points={m.stats.equity} height={48} />}
            <p className="text-xs text-muted">
              Only agent sessions count and get published. Start one from the{" "}
              <Link href="/dashboard/trade" className="text-accent-2 hover:underline">
                trade desk → Paper agent
              </Link>
              . Feed: {m.entry_count} encrypted entries · chain head <span className="font-mono">{m.chain_head.slice(0, 12)}…</span>
            </p>
            {!cfg?.contract && <p className="text-xs text-warn">Copy-keys contract not configured on this deployment.</p>}
          </div>
        ) : (
          <div className="h-24 animate-pulse rounded-xl bg-surface-2/40" />
        )}
      </Card>
      <Card title="Subscribers" description="Paid on-chain. Payments go straight to your wallet.">
        {m && m.subscribers.length > 0 ? (
          <ul className="divide-y divide-line/70 text-sm">
            {m.subscribers.map((s) => {
              const active = Boolean(s.active);
              return (
                <li key={s.follower} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate font-mono">{s.follower}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {yoctoToNear(s.paid_total)} NEAR · {active ? `until ${new Date(Number(s.expires_at_ns) / 1e6).toLocaleString()}` : "expired"}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">No subscribers yet.</p>
        )}
      </Card>
    </div>
  );
}

function FollowingTab({ onPick }: { onPick: (trader: string) => void }) {
  const { accountId } = useWallet();
  const following = usePolling(() => copyApi.following(accountId!), 15000, [accountId], Boolean(accountId));
  const mirror = usePolling(() => copyApi.mirror(accountId!), 5000, [accountId], Boolean(accountId));
  if (!accountId) return <p className="text-sm text-muted">Connect your wallet to see who you follow.</p>;
  const subs = following.data?.subscriptions ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card title="Subscriptions">
        {following.error && <p className="text-sm text-danger">{following.error}</p>}
        {subs.length === 0 ? (
          <p className="text-sm text-muted">You haven&apos;t subscribed to anyone yet. Paste a trader ID above or pick one from the leaderboard.</p>
        ) : (
          <ul className="divide-y divide-line/70 text-sm">
            {subs.map((s) => (
              <li key={s.trader}>
                <button type="button" onClick={() => onPick(s.trader)} className="flex w-full items-center justify-between gap-3 py-2 text-left hover:text-accent">
                  <span className="truncate font-mono">{s.trader}</span>
                  <span className={`shrink-0 text-xs ${s.active ? "text-accent" : "text-muted"}`}>
                    {s.active ? `active · until ${new Date(Number(s.expires_at_ns) / 1e6).toLocaleString()}` : "expired"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        title="Auto-mirror"
        description={mirror.data?.copying ? `Copying ${mirror.data.copying[0]} right now` : "Copies open when a trader you mirror opens a position."}
      >
        {(mirror.data?.configs ?? []).length === 0 ? (
          <p className="text-sm text-muted">Open a trader you subscribe to and press Start auto-mirror.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {mirror.data!.configs.map((c) => (
              <li key={c.trader} className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => onPick(c.trader)} className="truncate font-mono hover:text-accent">
                  {c.trader}
                </button>
                <span className="shrink-0 text-xs text-muted">
                  {c.enabled ? "on" : c.paused_reason ?? "off"} · {c.copies_closed} closed ·{" "}
                  <span className={c.realized_pnl >= 0 ? "text-clean" : "text-danger"}>{fmtUsd(c.realized_pnl, true)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {(mirror.data?.log ?? []).length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[11px] text-muted">
            {mirror.data!.log.slice(0, 10).map((l, i) => (
              <li key={i} className={l.level === "warn" || l.level === "error" ? "text-warn" : ""}>
                {ago(l.ts)} · {l.trader}: {l.message}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
