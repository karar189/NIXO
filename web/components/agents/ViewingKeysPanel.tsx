"use client";

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { Card } from "@/components/dashboard/Card";

const BASE = "/api/agents";

async function api(path: string, account: string | null, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(account ? { "X-Near-Account": account } : {}),
      ...(init?.headers as object),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail ?? body.message ?? res.statusText);
  return body;
}

export function ViewingKeysPanel({ runId }: { runId: string | null }) {
  const { accountId, connect, ready } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [offer, setOffer] = useState<Record<string, unknown> | null>(null);
  const [redeemed, setRedeemed] = useState<Record<string, unknown> | null>(null);
  const [delay, setDelay] = useState("5");

  async function appendSample() {
    if (!accountId || !runId) return;
    setBusy(true);
    setError(null);
    try {
      await api("/nixo/viewing/append", accountId, {
        method: "POST",
        body: JSON.stringify({
          run_id: runId,
          payload: { action: "swap", amount: "1.0", target: "intents.near", note: "demo trade log entry" },
        }),
      });
      setStatus("Encrypted trade log entry appended for this run.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function createDelayed() {
    if (!accountId || !runId) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api("/nixo/viewing/offer", accountId, {
        method: "POST",
        body: JSON.stringify({ run_id: runId, key_type: "delayed", delay_seconds: Number(delay) }),
      });
      setOffer(out.offer);
      setStatus(`Delayed key ${out.offer.key_id} redeemable after ${delay}s.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    if (!accountId || !offer) return;
    setBusy(true);
    setError(null);
    try {
      const kp = await api("/nixo/viewing/keypair", accountId, { method: "POST" });
      const out = await api("/nixo/viewing/redeem", accountId, {
        method: "POST",
        body: JSON.stringify({ key_id: offer.key_id, buyer_x25519_pub_b64: kp.public_b64 }),
      });
      setRedeemed(out);
      setStatus(`Redeemed receipt ${out.receipt_id}. Ciphertexts returned; decrypt off-chain with wrapped data key.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Encrypted trade log · delayed viewing key"
      action={
        <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-muted">
          <KeyRound className="size-3.5" /> delayed only
        </span>
      }
    >
      <p className="mb-3 text-xs leading-5 text-muted">
        Live / time-limited / auditor key types are typed but not shipped. A viewing key decrypts NIXO&apos;s
        off-chain trade log for its scope — it does <strong>not</strong> hide vault or Intents activity on explorers.
      </p>
      {!ready ? (
        <p className="text-sm text-muted">Loading wallet…</p>
      ) : !accountId ? (
        <button type="button" onClick={() => void connect()} className="rounded-lg bg-accent px-3 py-2 text-sm text-background">
          Connect wallet
        </button>
      ) : !runId ? (
        <p className="text-sm text-muted">Start an off-chain agents run first (used as the log scope id).</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            Delay (seconds)
            <input
              className="mt-1 block w-24 rounded-lg border border-line bg-background px-2 py-1.5 text-sm"
              value={delay}
              onChange={(e) => setDelay(e.target.value)}
              disabled={busy}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void appendSample()}
            className="rounded-lg border border-line px-3 py-2 text-xs hover:border-accent/50 disabled:opacity-50"
          >
            Append sample ciphertext
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void createDelayed()}
            className="rounded-lg border border-line px-3 py-2 text-xs hover:border-accent/50 disabled:opacity-50"
          >
            Create delayed key
          </button>
          <button
            type="button"
            disabled={busy || !offer}
            onClick={() => void redeem()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Redeem as buyer
          </button>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-danger break-all">{error}</p>}
      {status && <p className="mt-3 text-xs text-muted">{status}</p>}
      {offer && (
        <pre className="mt-3 max-h-40 overflow-auto rounded-xl border border-line bg-background/50 p-2 font-mono text-[10px]">
          {JSON.stringify(offer, null, 2)}
        </pre>
      )}
      {redeemed && (
        <pre className="mt-3 max-h-48 overflow-auto rounded-xl border border-line bg-background/50 p-2 font-mono text-[10px]">
          {JSON.stringify(
            {
              receipt_id: redeemed.receipt_id,
              entry_count: redeemed.entry_count,
              disclaimer: redeemed.disclaimer,
              ephemeral_pub_b64: redeemed.ephemeral_pub_b64,
              wrapped_data_key_b64: redeemed.wrapped_data_key_b64,
            },
            null,
            2,
          )}
        </pre>
      )}
    </Card>
  );
}
