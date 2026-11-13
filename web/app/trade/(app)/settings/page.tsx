"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { Card } from "@/components/dashboard/Card";
import type { NearNetwork } from "@/lib/near/config";

function NetworkSwitch({
  network,
  onRequest,
  disabled,
}: {
  network: NearNetwork;
  onRequest: (next: NearNetwork) => void;
  disabled: boolean;
}) {
  const mainnet = network === "mainnet";
  return (
    <div className="flex items-center gap-3">
      <span className={`text-sm ${!mainnet ? "font-medium text-foreground" : "text-muted"}`}>Testnet</span>
      <button
        type="button"
        role="switch"
        aria-checked={mainnet}
        aria-label="Use mainnet"
        disabled={disabled}
        onClick={() => onRequest(mainnet ? "testnet" : "mainnet")}
        className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
          mainnet ? "border-accent/50 bg-accent/25" : "border-line bg-surface-2"
        }`}
      >
        <span
          className={`absolute top-0.5 size-5.5 rounded-full shadow transition-all ${
            mainnet ? "left-[calc(100%-1.5rem)] bg-accent" : "left-0.5 bg-accent-2"
          }`}
        />
      </button>
      <span className={`text-sm ${mainnet ? "font-medium text-foreground" : "text-muted"}`}>Mainnet</span>
    </div>
  );
}

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
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
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
    </div>
  );
}
