"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { NetworkSwitch } from "@/components/wallet/NetworkToggle";
import { Card } from "@/components/dashboard/Card";
import { ProvidersPanel } from "@/components/llm/ModelPicker";
import type { NearNetwork } from "@/lib/near/config";

export default function SettingsPage() {
  const { network, accountId, switchNetwork } = useWallet();
  const [pending, setPending] = useState<NearNetwork | null>(null);
  const [switching, setSwitching] = useState(false);

  async function confirm() {
    if (!pending) return;
    setSwitching(true);
    await switchNetwork(pending);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6 lg:py-8">
      <div>
        <h1 className="display text-2xl">Settings</h1>
        <p className="mt-1 text-sm text-muted">Network and app preferences for this browser.</p>
      </div>

      <Card title="Network">
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
          <div className="rounded-xl border border-line bg-background/50 p-3">
            <dt className="font-medium">Paper trading</dt>
            <dd className="mt-1 text-muted">Works on both. Fills use live NEAR Intents quotes; no funds move.</dd>
          </div>
          <div className="rounded-xl border border-line bg-background/50 p-3">
            <dt className="font-medium">Live swaps</dt>
            <dd className="mt-1 text-muted">
              Mainnet only. NEAR Intents has no testnet, so live trading is turned off on testnet.
            </dd>
          </div>
        </dl>

        {pending && (
          <div role="alertdialog" aria-labelledby="switch-title" className="mt-5 rounded-xl border border-accent-2/40 bg-accent-2/10 p-4">
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
                className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
              >
                {switching ? "Switching…" : `Disconnect and switch`}
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={switching}
                className="rounded-full border border-line px-4 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Card>

      <Card title="AI model providers">
        <p className="mb-3 text-sm leading-6 text-muted">
          The trading planner, position supervisor and NIXO experiment agents can use any configured provider.
          &ldquo;Auto&rdquo; tries them in this order and skips one for 10 minutes after an auth or credit failure.
        </p>
        <ProvidersPanel />
      </Card>
    </div>
  );
}
