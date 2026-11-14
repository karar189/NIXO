"use client";

import Link from "next/link";
import { useState } from "react";
import { Copy, Loader2, Radio } from "lucide-react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { copyApi, type CopyConfig } from "@/lib/copykeys/api";
import { buildListKeyCall, buildUnlistCall, periodLabel, PERIOD_OPTIONS, yoctoToNear } from "@/lib/copykeys/sdk";
import { fmtUsd } from "@/lib/trading/format";
import { usePolling } from "@/lib/usePolling";

/**
 * Header button on the agent trading desk. Hover (or click) opens a small box
 * where the trader sells access to their agent's trades: set a price per period
 * and sign `list_key` on the copy-keys contract.
 */
export function DeployCopyAgent() {
  const { accountId, network, signAndSend } = useWallet();
  const [open, setOpen] = useState(false);
  const cfgPoll = usePolling(() => copyApi.config(), 60000);
  const mePoll = usePolling(() => copyApi.me(accountId!), 15000, [accountId], Boolean(accountId));
  const cfg: CopyConfig | null = cfgPoll.data;
  const me = mePoll.data;
  const [price, setPrice] = useState("0.1");
  const [period, setPeriod] = useState<number>(3600);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Prefill the form from the live listing whenever it changes.
  const listingKey = me?.listing ? `${me.listing.price_per_period}:${me.listing.period_secs}` : null;
  const [syncedKey, setSyncedKey] = useState<string | null>(null);
  if (listingKey !== syncedKey) {
    setSyncedKey(listingKey);
    if (me?.listing) {
      setPrice(yoctoToNear(me.listing.price_per_period));
      setPeriod(me.listing.period_secs);
    }
  }
  const load = () => Promise.all([cfgPoll.refresh(), mePoll.refresh()]);

  const contract = cfg?.contract ?? null;
  const listing = me?.listing ?? null;
  const live = Boolean(listing?.active);

  async function send(label: string, build: () => Parameters<typeof signAndSend>[0]) {
    setBusy(label);
    setError(null);
    try {
      await signAndSend(build());
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const shareLink = typeof window !== "undefined" && accountId ? `${window.location.origin}/dashboard/keys?trader=${accountId}` : "";

  return (
    <div
      className="group relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm ${
          live ? "border-accent/50 text-accent" : "border-line"
        }`}
      >
        <Radio className={`size-3.5 ${live ? "animate-pulse" : ""}`} />
        {live ? "Copy agent live" : "Deploy copy agent"}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 w-[min(22rem,calc(100vw-2rem))] pt-2" role="dialog" aria-label="Deploy copy agent">
          <div className="space-y-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-2xl">
            <div>
              <p className="kicker !text-[10px]">Viewing keys · copy trading</p>
              <h3 className="mt-0.5 text-sm font-medium">Let others copy your agent</h3>
              <p className="mt-1 text-xs text-muted">
                Followers pay NEAR on-chain to see your <span className="text-foreground">agent session</span> trades,
                decrypted in their browser, and can auto-mirror them. Everyone else sees only your PnL. Manual positions
                and swaps stay private.
              </p>
            </div>

            {me?.stats && me.stats.trades > 0 && (
              <div className="grid grid-cols-3 gap-2 rounded-xl border border-line bg-background/60 p-2 text-center">
                <Stat label="Agent PnL" value={fmtUsd(me.stats.total_pnl, true)} tone={me.stats.total_pnl >= 0 ? "text-clean" : "text-danger"} />
                <Stat label="Win rate" value={`${Math.round(me.stats.win_rate * 100)}%`} />
                <Stat label="Trades" value={String(me.stats.trades)} />
              </div>
            )}

            {!contract ? (
              <p className="rounded-lg border border-line bg-background/50 px-3 py-2 text-xs text-muted">
                The copy-keys contract isn&apos;t configured yet (<code className="font-mono">NIXO_KEYS_CONTRACT</code>). Deploy it with{" "}
                <code className="font-mono">scripts/deploy-copykeys-testnet.sh</code>.
              </p>
            ) : network !== "testnet" ? (
              <p className="rounded-lg border border-line bg-background/50 px-3 py-2 text-xs text-muted">
                Copy keys run on testnet in this version. Switch your wallet network to testnet.
              </p>
            ) : (
              <>
                {live && listing && (
                  <div className="flex items-center justify-between rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-xs">
                    <span>
                      <span className="text-accent">● Live</span> · {yoctoToNear(listing.price_per_period)} NEAR / {periodLabel(listing.period_secs)}
                    </span>
                    <span className="text-muted">
                      {listing.subscriber_count} subs · {yoctoToNear(listing.earned_total)} NEAR earned
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <label className="text-[10px] uppercase tracking-wider text-muted">
                    Price (NEAR)
                    <input
                      inputMode="decimal"
                      value={price}
                      onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                      className="mt-1 w-full rounded-lg border border-line bg-background px-2 py-1.5 font-mono text-sm normal-case tracking-normal text-foreground"
                    />
                  </label>
                  <label className="text-[10px] uppercase tracking-wider text-muted">
                    Per
                    <select
                      value={period}
                      onChange={(e) => setPeriod(Number(e.target.value))}
                      className="mt-1 block rounded-lg border border-line bg-background px-2 py-1.5 text-sm normal-case tracking-normal text-foreground"
                    >
                      {PERIOD_OPTIONS.map((p) => (
                        <option key={p.secs} value={p.secs}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={Boolean(busy) || !(Number(price) >= 0.001)}
                    onClick={() => send("list", () => [buildListKeyCall(contract, price, period)])}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
                  >
                    {busy === "list" && <Loader2 className="size-3.5 animate-spin" />}
                    {live ? "Update price" : "Deploy copy agent"}
                  </button>
                  {live && (
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => send("unlist", () => [buildUnlistCall(contract)])}
                      className="rounded-full border border-danger/40 px-3 py-1.5 text-sm text-danger disabled:opacity-50"
                    >
                      {busy === "unlist" ? <Loader2 className="size-3.5 animate-spin" /> : "Stop selling"}
                    </button>
                  )}
                </div>
                {!(Number(price) >= 0.001) && <p className="text-[11px] text-danger">Minimum price is 0.001 NEAR.</p>}
              </>
            )}

            {live && shareLink && (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(shareLink).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-background/60 px-3 py-1.5 text-left text-xs"
              >
                <span className="truncate font-mono text-muted">{accountId}</span>
                <span className="inline-flex shrink-0 items-center gap-1 text-accent-2">
                  <Copy className="size-3" /> {copied ? "Copied" : "Copy share link"}
                </span>
              </button>
            )}

            {(error ?? mePoll.error) && <p className="text-[11px] text-danger">{error ?? mePoll.error}</p>}
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>Paper fills · keys don&apos;t hide on-chain transfers</span>
              <Link href="/dashboard/keys?tab=sell" className="text-accent-2 hover:underline">
                Viewing keys →
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`font-mono text-sm ${tone}`}>{value}</p>
    </div>
  );
}
