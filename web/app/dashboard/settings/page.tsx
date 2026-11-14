"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, ExternalLink, Server, UserRound } from "lucide-react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { NetworkSwitch } from "@/components/wallet/NetworkToggle";
import { Card } from "@/components/dashboard/Card";
import { KV, PageHeader, Tag } from "@/components/dashboard/ui";
import { usePlannerInfo } from "@/components/llm/ModelPicker";
import { NIXO_CONTRACT, NIXO_VAULT_CONTRACT } from "@/lib/config";
import { accountExplorerUrl, rpcUrl } from "@/lib/near/config";
import { ProvidersPanel } from "@/components/llm/ModelPicker";
import type { NearNetwork } from "@/lib/near/config";

export default function SettingsPage() {
  const { network, accountId, walletName, switchNetwork } = useWallet();
  const { info: planner, error: plannerError } = usePlannerInfo();
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<NearNetwork | null>(null);
  const [switching, setSwitching] = useState(false);

  async function copy() {
    if (!accountId) return;
    await navigator.clipboard.writeText(accountId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function confirm() {
    if (!pending) return;
    setSwitching(true);
    await switchNetwork(pending);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6 lg:py-8">
      <PageHeader kicker="Account" title="Settings" description="Your connection, the services behind the desk, and AI provider preferences for this browser." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Connected account"
          icon={<UserRound />}
          tag={walletName ?? "wallet"}
          action={
            accountId && (
              <div className="flex items-center gap-1">
                <button type="button" onClick={copy} className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Copy account ID">
                  {copied ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5" />}
                </button>
                <a href={accountExplorerUrl(network, accountId)} target="_blank" rel="noreferrer" className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-foreground" aria-label="View on NearBlocks">
                  <ExternalLink className="size-3.5" />
                </a>
              </div>
            )
          }
        >
          <p className="break-all font-mono text-sm">{accountId}</p>
          <dl className="mt-3 divide-y divide-line/60">
            <KV k="Network" v={network} />
            <KV k="Wallet" v={walletName ?? "—"} mono={false} />
            <KV k="RPC" v={rpcUrl(network)} />
          </dl>
        </Card>

        <Card title="Services" icon={<Server />} tag={plannerError ? "agents offline" : planner ? "agents online" : "checking…"}>
          <dl className="divide-y divide-line/60">
            <KV k="NIXO contract" v={NIXO_CONTRACT} />
            <KV k="Vault contract" v={NIXO_VAULT_CONTRACT || "not set"} />
            <KV
              k="Agents service"
              mono={false}
              v={
                plannerError ? (
                  <Tag tone="reject">unreachable</Tag>
                ) : planner ? (
                  <Tag tone="clean">{planner.providers.filter((p) => p.configured).length} providers ready</Tag>
                ) : (
                  <Tag tone="muted">checking</Tag>
                )
              }
            />
            <KV k="Auto planner" v={planner?.provider ? `${planner.provider} · ${planner.model}` : plannerError ? "—" : "rules fallback"} />
          </dl>
        </Card>
      </div>

      <Card title="Network" tag={network}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-md">
            <p className="font-medium">NEAR network</p>
            <p className="mt-1 text-sm leading-6 text-muted">
              Choose which network your wallet, balances and explorer links use. Switching disconnects
              {accountId ? <> <span className="font-mono text-foreground/80">{accountId}</span></> : " your wallet"} and
              asks you to reconnect on the other network.
            </p>
          </div>
          <NetworkSwitch network={network} onRequest={setPending} disabled={switching} />
        </div>

        <dl className="mt-5 grid gap-3 border-t border-line pt-4 text-sm sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-background/50 p-3">
            <dt className="font-medium">Paper trading</dt>
            <dd className="mt-1 text-muted">Works on both. Fills use live NEAR Intents quotes; no funds move.</dd>
          </div>
          <div className="rounded-lg border border-line bg-background/50 p-3">
            <dt className="font-medium">Live swaps</dt>
            <dd className="mt-1 text-muted">
              Mainnet only. NEAR Intents has no testnet, so live trading is turned off on testnet.
            </dd>
          </div>
        </dl>

        {pending && (
          <div role="alertdialog" aria-labelledby="switch-title" className="mt-5 rounded-lg border border-accent-2/40 bg-accent-2/10 p-4">
            <p id="switch-title" className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4 text-accent-2" />
              Switch to {pending}?
            </p>
            <p className="mt-1 text-sm text-muted">
              {pending === "mainnet"
                ? "Mainnet uses real NEAR and real tokens. Live swaps will be able to spend funds you approve in Meteor."
                : "You'll reconnect with a testnet account. Live swaps are unavailable on testnet."}{" "}
              Any running paper session keeps running on the server.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={confirm}
                disabled={switching}
                className="btn-primary !px-4 !py-2 !text-[11px] disabled:opacity-60"
              >
                {switching ? "Switching…" : `Disconnect and switch`}
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={switching}
                className="btn-secondary !px-4 !py-2 !text-[11px]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Card>

      <Card title="AI model providers" tag="agents service">
        <p className="mb-3 text-sm leading-6 text-muted">
          The trading planner, position supervisor and NIXO experiment agents can use any configured provider.
          &ldquo;Auto&rdquo; tries them in this order and skips one for 10 minutes after an auth or credit failure.
        </p>
        <ProvidersPanel />
      </Card>
    </div>
  );
}
