"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, Lock, ShieldAlert, Unlock } from "lucide-react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { Sparkline } from "@/components/keys/Sparkline";
import { copyApi, type CopyConfig, type MirrorConfig, type MirrorLog, type TraderCard } from "@/lib/copykeys/api";
import {
  decryptEntries,
  getOrCreateKeypair,
  loadKeypair,
  unwrapEpochKeys,
  verifyChain,
  type Decrypted,
} from "@/lib/copykeys/crypto";
import { buildSubscribeCall, periodLabel, yoctoToNear } from "@/lib/copykeys/sdk";
import { fmtPrice, fmtUsd } from "@/lib/trading/format";
import { usePolling } from "@/lib/usePolling";

export function ago(ts: number | null | undefined): string {
  if (!ts) return "—";
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function StatsGrid({ card }: { card: TraderCard }) {
  const s = card.stats;
  if (!s) return null;
  const items = [
    { label: "Agent PnL", value: fmtUsd(s.total_pnl, true), tone: s.total_pnl >= 0 ? "text-clean" : "text-danger" },
    { label: "ROE", value: `${s.roe_pct >= 0 ? "+" : ""}${s.roe_pct.toFixed(1)}%`, tone: s.roe_pct >= 0 ? "text-clean" : "text-danger" },
    { label: "Win rate", value: `${Math.round(s.win_rate * 100)}%` },
    { label: "Max drawdown", value: fmtUsd(-s.max_drawdown) },
    { label: "Trades", value: String(s.trades) },
    { label: "Last trade", value: ago(s.last_trade_at) },
  ];
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {items.map((i) => (
        <div key={i.label} className="rounded-xl border border-line bg-background/50 px-3 py-2">
          <p className="text-[9px] uppercase tracking-wider text-muted">{i.label}</p>
          <p className={`font-mono text-sm ${i.tone ?? ""}`}>{i.value}</p>
        </div>
      ))}
    </div>
  );
}

type KeysState = { active: boolean; expires_at: number; x25519_pub: string } | null;

export function TraderPanel({ trader, cfg }: { trader: string; cfg: CopyConfig | null }) {
  const { accountId, network, signAndSend, connect } = useWallet();
  const card = usePolling(() => copyApi.trader(trader), 15000, [trader]);
  const c = card.data;
  const contract = cfg?.contract ?? null;
  const isMe = accountId === trader;
  const [periods, setPeriods] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedKey, setFeedKey] = useState(0);

  const canSubscribe = Boolean(c && !c.demo && c.listing?.active && contract && !isMe && network === "testnet");
  const total = c?.listing ? (BigInt(c.listing.price_per_period) * BigInt(periods)).toString() : "0";

  async function subscribe() {
    if (!c?.listing || !contract) return;
    setBusy(true);
    setError(null);
    try {
      const acct = accountId ?? (await connect());
      if (!acct) return;
      const kp = await getOrCreateKeypair(acct);
      await signAndSend([
        buildSubscribeCall(contract, { trader, periods, x25519Pub: kp.pub_b64, pricePerPeriodYocto: c.listing.price_per_period }),
      ]);
      setFeedKey((k) => k + 1);
      await card.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (card.error && !c) {
    return <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{card.error}</p>;
  }
  if (!c) {
    return <div className="h-40 animate-pulse rounded-2xl border border-line bg-surface/60" />;
  }

  return (
    <section className="space-y-4 rounded-2xl border border-line bg-surface/90 p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="kicker !text-[10px]">Trader</p>
          <h2 className="truncate font-mono text-lg">{c.profile?.label ? `${c.profile.label} · ` : ""}{trader}</h2>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
            {c.demo && <span className="rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-warn">demo · simulated history</span>}
            {c.profile?.style && <span className="rounded-full border border-line px-2 py-0.5 text-muted">{c.profile.style}</span>}
            {c.listing && (
              <span className={`rounded-full border px-2 py-0.5 ${c.listing.active ? "border-accent/40 text-accent" : "border-line text-muted"}`}>
                {c.listing.active ? `${yoctoToNear(c.listing.price_per_period)} NEAR / ${periodLabel(c.listing.period_secs)}` : "not selling new keys"}
              </span>
            )}
            {c.listing && <span className="rounded-full border border-line px-2 py-0.5 text-muted">{c.listing.subscriber_count} subscribers</span>}
          </div>
        </div>
        {c.stats && <Sparkline points={c.stats.equity} className="max-w-[240px]" height={44} />}
      </header>

      {!c.listed && !c.demo ? (
        <p className="rounded-xl border border-line bg-background/50 px-4 py-3 text-sm text-muted">
          <span className="font-mono text-foreground">{trader}</span> isn&apos;t selling copy keys, so its PnL stays private. Ask them to open the
          trade desk and press <span className="text-foreground">Deploy copy agent</span>.
        </p>
      ) : (
        <StatsGrid card={c} />
      )}

      {c.listed || c.demo ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-background/40 p-3">
          {isMe ? (
            <p className="text-sm text-muted">This is your own listing. Followers see the PnL above until they subscribe.</p>
          ) : c.demo ? (
            <p className="text-sm text-muted">Demo traders show how a listing looks. They can&apos;t be subscribed to.</p>
          ) : !contract ? (
            <p className="text-sm text-muted">Copy-keys contract not configured on this deployment.</p>
          ) : network !== "testnet" ? (
            <p className="text-sm text-muted">Switch your wallet to testnet to subscribe.</p>
          ) : !c.listing?.active ? (
            <p className="text-sm text-muted">This trader stopped selling new keys. Existing subscriptions keep working until they expire.</p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted">Periods</span>
                <select value={periods} onChange={(e) => setPeriods(Number(e.target.value))} className="rounded-lg border border-line bg-background px-2 py-1 text-sm">
                  {[1, 2, 3, 6, 12, 24].map((n) => (
                    <option key={n} value={n}>
                      {n} × {periodLabel(c.listing!.period_secs)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || !canSubscribe}
                onClick={() => void subscribe()}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
                {accountId ? `Subscribe · ${yoctoToNear(total)} NEAR` : "Connect wallet to subscribe"}
              </button>
              <p className="w-full text-[11px] text-muted">
                Paid on-chain to {trader}. Your browser makes a private key that never leaves this device. Only its public half goes on-chain,
                and feed keys are encrypted to it.
              </p>
            </>
          )}
          {error && <p className="w-full text-[11px] text-danger">{error}</p>}
        </div>
      ) : null}

      {(c.listed || c.demo) && <FeedView key={`${trader}-${feedKey}`} trader={trader} demo={c.demo} isMe={isMe} />}
    </section>
  );
}

type FeedState = { rows: Decrypted[]; chainOk: boolean; keys: KeysState; note: string | null };

async function loadFeed(trader: string, account: string | null, demo: boolean, isMe: boolean): Promise<FeedState> {
  const feed = await copyApi.entries(trader);
  const chainOk = await verifyChain(feed.entries);
  let keyMap = new Map<number, CryptoKey>();
  let keys: KeysState = null;
  let note: string | null = null;
  if (account && !demo && !isMe) {
    try {
      const k = await copyApi.keys(trader, account);
      keys = { active: k.active, expires_at: k.expires_at, x25519_pub: k.x25519_pub };
      const kp = loadKeypair(account);
      if (!kp || kp.pub_b64 !== k.x25519_pub) {
        note = "You subscribed from another browser or device. Extend the subscription here to register this browser's key.";
      } else {
        keyMap = await unwrapEpochKeys(kp, k.keys);
      }
    } catch {
      keys = null; // not subscribed
    }
  }
  return { rows: await decryptEntries(feed.entries, keyMap), chainOk, keys, note };
}

function FeedView({ trader, demo, isMe }: { trader: string; demo: boolean; isMe: boolean }) {
  const { accountId } = useWallet();
  const feed = usePolling(() => loadFeed(trader, accountId, demo, isMe), 5000, [trader, accountId, demo, isMe]);
  const rows = feed.data?.rows ?? [];
  const chainOk = feed.data ? feed.data.chainOk : null;
  const keys = feed.data?.keys ?? null;
  const note = feed.data?.note ?? null;

  const ordered = useMemo(() => [...(feed.data?.rows ?? [])].reverse(), [feed.data]);
  const unlocked = rows.filter((r) => r.data).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
          {unlocked ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />} Agent trade feed
        </h3>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {chainOk !== null && (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${chainOk ? "border-clean/40 text-clean" : "border-danger/40 text-danger"}`}
              title="Every entry's hash links to the one before it, so nothing was edited, removed or reordered."
            >
              {chainOk ? <CheckCircle2 className="size-3" /> : <ShieldAlert className="size-3" />} {chainOk ? "chain verified" : "chain broken"}
            </span>
          )}
          {keys && (
            <span className={`rounded-full border px-2 py-0.5 ${keys.active ? "border-accent/40 text-accent" : "border-line text-muted"}`}>
              {keys.active ? `subscribed · expires ${new Date(keys.expires_at * 1000).toLocaleString()}` : "subscription expired"}
            </span>
          )}
          <span className="rounded-full border border-line px-2 py-0.5 text-muted">
            {unlocked}/{rows.length} decrypted
          </span>
        </div>
      </div>
      {note && <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{note}</p>}
      {isMe && <p className="text-xs text-muted">Your own feed, as others see it: encrypted rows plus public hashes.</p>}

      {ordered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
          No published agent trades yet. New agent opens and closes appear here within seconds.
        </p>
      ) : (
        <ul className="divide-y divide-line/70 overflow-hidden rounded-xl border border-line">
          {ordered.slice(0, 60).map((r) => (
            <FeedRow key={r.entry.seq} row={r} />
          ))}
        </ul>
      )}

      {keys?.active && accountId && !demo && <MirrorControls trader={trader} account={accountId} />}
    </div>
  );
}

function FeedRow({ row }: { row: Decrypted }) {
  const { entry, data } = row;
  if (!data) {
    return (
      <li className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
        <span className="inline-flex items-center gap-2 text-muted">
          <Lock className="size-3" /> #{entry.seq} · encrypted {entry.kind.toLowerCase()}
        </span>
        <span className="truncate font-mono text-[10px] text-muted/70">{entry.ciphertext_b64.slice(0, 28)}…</span>
        <span className="shrink-0 text-muted">{ago(entry.ts)}</span>
      </li>
    );
  }
  const d = data as Record<string, number | string | null>;
  const side = String(d.side);
  const sideTone = side === "LONG" ? "text-clean" : "text-danger";
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 text-xs">
      <span className="inline-flex items-center gap-2">
        <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px]">{String(d.type)}</span>
        <span className={sideTone}>{side}</span>
        <span className="font-medium">{String(d.symbol)}</span>
        <span className="text-muted">{Number(d.leverage)}x · ${Number(d.margin).toFixed(0)} margin</span>
      </span>
      {d.type === "OPEN" ? (
        <span className="font-mono text-muted">
          entry {fmtPrice(Number(d.entry_price))} · TP {d.tp ? fmtPrice(Number(d.tp)) : "—"} · SL {d.sl ? fmtPrice(Number(d.sl)) : "—"}
        </span>
      ) : (
        <span className="font-mono">
          <span className="text-muted">
            {fmtPrice(Number(d.entry_price))} → {fmtPrice(Number(d.exit_price))} · {String(d.close_reason).replace(/_/g, " ").toLowerCase()} ·{" "}
          </span>
          <span className={Number(d.pnl) >= 0 ? "text-clean" : "text-danger"}>{fmtUsd(Number(d.pnl), true)}</span>
        </span>
      )}
      <span className="text-muted">{ago(entry.ts)}</span>
    </li>
  );
}

function MirrorControls({ trader, account }: { trader: string; account: string }) {
  const mirror = usePolling(() => copyApi.mirror(account), 5000, [account]);
  const current: MirrorConfig | undefined = mirror.data?.configs.find((c) => c.trader === trader);
  const [form, setForm] = useState({ scale: "1", max_margin_usdc: "500", max_leverage: "5", max_total_loss_usdc: "200" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the saved limits into the form when they first arrive.
  const savedKey = current ? `${current.trader}:${current.created_at}` : null;
  const [syncedKey, setSyncedKey] = useState<string | null>(null);
  if (current && savedKey !== syncedKey) {
    setSyncedKey(savedKey);
    setForm({
      scale: String(current.scale),
      max_margin_usdc: String(current.max_margin_usdc),
      max_leverage: String(current.max_leverage),
      max_total_loss_usdc: String(current.max_total_loss_usdc),
    });
  }

  async function save(enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      await copyApi.setMirror(account, {
        trader,
        enabled,
        scale: Number(form.scale),
        max_margin_usdc: Number(form.max_margin_usdc),
        max_leverage: Number(form.max_leverage),
        max_total_loss_usdc: Number(form.max_total_loss_usdc),
      });
      await mirror.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const fields: { key: keyof typeof form; label: string }[] = [
    { key: "scale", label: "Size × trader" },
    { key: "max_margin_usdc", label: "Max margin $" },
    { key: "max_leverage", label: "Max leverage" },
    { key: "max_total_loss_usdc", label: "Stop at loss $" },
  ];
  const log: MirrorLog[] = (mirror.data?.log ?? []).filter((l) => l.trader === trader).slice(0, 8);

  return (
    <div className="space-y-3 rounded-xl border border-line bg-background/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">Auto-mirror into my paper account</h4>
          <p className="text-[11px] text-muted">
            Each new agent position opens a matching paper position for you within your limits, and closes when theirs closes. Paper fills priced by
            1Click quotes: no funds move.
          </p>
        </div>
        {current && (
          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${current.enabled ? "border-accent/40 text-accent" : "border-line text-muted"}`}>
            {current.enabled ? "mirroring" : current.paused_reason ? `paused · ${current.paused_reason}` : "off"} · {current.copies_closed} closed ·{" "}
            {fmtUsd(current.realized_pnl, true)}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {fields.map((f) => (
          <label key={f.key} className="text-[10px] uppercase tracking-wider text-muted">
            {f.label}
            <input
              inputMode="decimal"
              value={form[f.key]}
              onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value.replace(/[^0-9.]/g, "") }))}
              className="mt-1 w-full rounded-lg border border-line bg-background px-2 py-1.5 font-mono text-sm normal-case tracking-normal text-foreground"
            />
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(true)}
          className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {current?.enabled ? "Update limits" : "Start auto-mirror"}
        </button>
        {current?.enabled && (
          <button type="button" disabled={busy} onClick={() => void save(false)} className="rounded-full border border-line px-4 py-1.5 text-sm disabled:opacity-50">
            Stop
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-danger">{error}</p>}
      {log.length > 0 && (
        <ul className="space-y-1 text-[11px]">
          {log.map((l, i) => (
            <li key={i} className={l.level === "warn" || l.level === "error" ? "text-warn" : "text-muted"}>
              <span className="font-mono">{new Date(l.ts * 1000).toLocaleTimeString()}</span> · {l.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
