"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, Vault } from "lucide-react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { Card } from "@/components/dashboard/Card";
import { NIXO_CONTRACT, NIXO_VAULT_CONTRACT } from "@/lib/config";
import {
  buildAssignCall,
  buildDepositCall,
  buildExecuteCall,
  buildRevokeCall,
  buildWithdrawCall,
  listDepositsByOwner,
  type VaultDeposit,
} from "@/lib/vault-sdk";

const inputCls =
  "w-full rounded-lg border border-line bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-50";

function yoctoToNear(y: string): string {
  try {
    const v = BigInt(y);
    const whole = v / 10n ** 24n;
    const frac = (v % 10n ** 24n).toString().padStart(24, "0").replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : whole.toString();
  } catch {
    return y;
  }
}

export function OnchainVaultPanel() {
  const { accountId, ready, connect, signAndSend, network } = useWallet();
  const [deposits, setDeposits] = useState<VaultDeposit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("0.5");
  const [agentId, setAgentId] = useState("");
  const [target, setTarget] = useState("intents.near");
  const [maxTx, setMaxTx] = useState("0.2");
  const [maxWindow, setMaxWindow] = useState("0.5");
  const [execAmount, setExecAmount] = useState("0.1");
  const [selected, setSelected] = useState<string>("");

  const refresh = useCallback(async () => {
    if (!accountId || !NIXO_VAULT_CONTRACT) return;
    try {
      const rows = await listDepositsByOwner(accountId);
      setDeposits(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [accountId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (accountId && !agentId) setAgentId(`${accountId}`);
  }, [accountId, agentId]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!NIXO_VAULT_CONTRACT) {
    return (
      <Card title="On-chain vault">
        <p className="text-sm text-muted">Set NEXT_PUBLIC_NIXO_VAULT_CONTRACT to enable Layer 2 deposit / assign / execute.</p>
      </Card>
    );
  }

  if (!ready) {
    return (
      <Card title="On-chain vault">
        <p className="text-sm text-muted">Loading wallet…</p>
      </Card>
    );
  }

  if (!accountId) {
    return (
      <Card title="On-chain vault">
        <p className="mb-3 text-sm text-muted">Connect a testnet wallet that holds a Clean certificate on {NIXO_CONTRACT}.</p>
        <button type="button" onClick={() => void connect()} className="rounded-lg bg-accent px-3 py-2 text-sm text-background">
          Connect wallet
        </button>
      </Card>
    );
  }

  const dep = deposits.find((d) => d.deposit_id === selected) ?? deposits[0];

  return (
    <Card
      title="On-chain vault"
      action={
        <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-muted">
          <Vault className="size-3.5" /> {NIXO_VAULT_CONTRACT}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-5 text-muted">
        Native NEAR deposits call <code className="font-mono">{NIXO_CONTRACT}.is_clean</code> at deposit time.
        Dirty / warn / missing / expired certificates are refunded with no provenance row. Agent{" "}
        <code className="font-mono">execute</code> defaults to dry-run (debits remaining, no transfer).
        Explorers still show vault transfers — viewing keys do not hide them.
      </p>
      {network !== "testnet" && (
        <p className="mb-3 text-xs text-amber-300">Switch to testnet in Settings — the vault lives on testnet.</p>
      )}
      {error && <p className="mb-3 text-xs text-danger break-all">{error}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-xs text-muted">
            Deposit amount (NEAR)
            <input className={`${inputCls} mt-1`} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("deposit", () => signAndSend([buildDepositCall(amount)]))}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-background disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Deposit (gated by is_clean)
          </button>

          <div className="rounded-xl border border-line p-3">
            <p className="mb-2 text-xs font-medium">Your deposits</p>
            {deposits.length === 0 && <p className="text-[11px] text-muted">None yet.</p>}
            <ul className="space-y-1">
              {deposits.map((d) => (
                <li key={d.deposit_id}>
                  <button
                    type="button"
                    onClick={() => setSelected(d.deposit_id)}
                    className={`w-full rounded-lg border px-2 py-1.5 text-left font-mono text-[11px] ${
                      (dep?.deposit_id === d.deposit_id ? "border-accent/50 bg-accent/10" : "border-line")
                    }`}
                  >
                    #{d.deposit_id} · {yoctoToNear(d.remaining)} / {yoctoToNear(d.amount)} NEAR · {d.status}
                    {d.assignment_id ? ` · asg ${d.assignment_id}` : ""}
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => void refresh()} className="mt-2 text-[11px] text-muted underline">
              Refresh
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <label className="block text-xs text-muted">
            Agent account
            <input className={`${inputCls} mt-1`} value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={busy} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-muted">
              Max / tx (NEAR)
              <input className={`${inputCls} mt-1`} value={maxTx} onChange={(e) => setMaxTx(e.target.value)} disabled={busy} />
            </label>
            <label className="block text-xs text-muted">
              Max / window (NEAR)
              <input className={`${inputCls} mt-1`} value={maxWindow} onChange={(e) => setMaxWindow(e.target.value)} disabled={busy} />
            </label>
          </div>
          <label className="block text-xs text-muted">
            Allowlisted target
            <input className={`${inputCls} mt-1`} value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !dep || !!dep.assignment_id}
              onClick={() => {
                if (!dep) return;
                const expires = (BigInt(Date.now()) * 1_000_000n + 7n * 24n * 3600n * 1_000_000_000n).toString();
                void run("assign", () =>
                  signAndSend([
                    buildAssignCall({
                      deposit_id: dep.deposit_id,
                      agent_id: agentId,
                      max_per_tx_near: maxTx,
                      max_per_window_near: maxWindow,
                      window_ns: (3600n * 1_000_000_000n).toString(),
                      expires_at_ns: expires,
                      allowlist: [target],
                    }),
                  ]),
                );
              }}
              className="rounded-lg border border-line px-3 py-2 text-xs hover:border-accent/50 disabled:opacity-50"
            >
              Assign agent
            </button>
            <button
              type="button"
              disabled={busy || !dep?.assignment_id}
              onClick={() => {
                if (!dep?.assignment_id) return;
                void run("revoke", () => signAndSend([buildRevokeCall(dep.assignment_id!)]));
              }}
              className="rounded-lg border border-line px-3 py-2 text-xs hover:border-accent/50 disabled:opacity-50"
            >
              Revoke
            </button>
            <button
              type="button"
              disabled={busy || !dep || !!dep.assignment_id || dep.remaining === "0"}
              onClick={() => {
                if (!dep) return;
                void run("withdraw", () =>
                  signAndSend([buildWithdrawCall(dep.deposit_id, yoctoToNear(dep.remaining))]),
                );
              }}
              className="rounded-lg border border-line px-3 py-2 text-xs hover:border-accent/50 disabled:opacity-50"
            >
              Withdraw remaining
            </button>
          </div>

          <label className="block text-xs text-muted">
            Execute amount (NEAR, dry-run)
            <input className={`${inputCls} mt-1`} value={execAmount} onChange={(e) => setExecAmount(e.target.value)} disabled={busy} />
          </label>
          <button
            type="button"
            disabled={busy || !dep?.assignment_id}
            onClick={() => {
              if (!dep?.assignment_id) return;
              void run("execute", () =>
                signAndSend([
                  buildExecuteCall({
                    assignment_id: dep.assignment_id!,
                    amount_near: execAmount,
                    target,
                    dry_run: true,
                  }),
                ]),
              );
            }}
            className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent disabled:opacity-50"
          >
            Execute dry-run (agent key / owner)
          </button>
          <p className="text-[11px] leading-5 text-muted">
            For a limited agent key: <code className="font-mono">scripts/vault-fc-key.sh</code>. Contract still enforces caps and allowlist.
          </p>
        </div>
      </div>
    </Card>
  );
}
