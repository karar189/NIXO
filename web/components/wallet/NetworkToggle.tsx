"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useWallet } from "./WalletProvider";
import type { NearNetwork } from "@/lib/near/config";

/** Settings-style switch: Testnet ↔ Mainnet. */
export function NetworkSwitch({
  network,
  onRequest,
  disabled = false,
}: {
  network: NearNetwork;
  onRequest: (next: NearNetwork) => void;
  disabled?: boolean;
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

/**
 * Compact nav control to switch NEAR network. Confirms before disconnecting /
 * reloading (same behaviour as Settings).
 */
export function NetworkToggle({ className = "" }: { className?: string }) {
  const { network, accountId, switchNetwork } = useWallet();
  const [pending, setPending] = useState<NearNetwork | null>(null);
  const [switching, setSwitching] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pending) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setPending(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPending(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pending]);

  function request(next: NearNetwork) {
    if (next === network || switching) return;
    setPending(next);
  }

  async function confirm() {
    if (!pending) return;
    setSwitching(true);
    await switchNetwork(pending);
  }

  const opts: NearNetwork[] = ["testnet", "mainnet"];

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div
        role="group"
        aria-label="NEAR network"
        className="inline-flex items-center rounded-full border border-line/80 bg-surface p-0.5"
      >
        {opts.map((opt) => {
          const active = network === opt;
          return (
            <button
              key={opt}
              type="button"
              disabled={switching}
              aria-pressed={active}
              onClick={() => request(opt)}
              className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors disabled:opacity-50 sm:px-3 sm:text-[11px] ${
                active
                  ? opt === "mainnet"
                    ? "bg-accent/20 text-accent"
                    : "bg-accent-2/20 text-accent-2"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>

      {pending && (
        <div
          role="alertdialog"
          aria-labelledby="nav-network-title"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-xl border border-accent-2/40 bg-surface p-3 shadow-2xl shadow-black/50"
        >
          <p id="nav-network-title" className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-3.5 shrink-0 text-accent-2" />
            Switch to {pending}?
          </p>
          <p className="mt-1.5 text-xs leading-5 text-muted">
            {pending === "mainnet"
              ? "Mainnet uses real NEAR. Live swaps can spend funds you approve."
              : "You'll use a testnet account. Live swaps are unavailable."}
            {accountId ? " Your wallet will disconnect and reconnect." : ""}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={switching}
              className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-background disabled:opacity-60"
            >
              {switching ? "Switching…" : "Switch"}
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              disabled={switching}
              className="rounded-full border border-line px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
