"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Wallet } from "lucide-react";
import { useWallet } from "./WalletProvider";

/**
 * "Connect wallet" opens the NEAR wallet picker (Meteor, MyNearWallet, HERE,
 * Sender, Intear, Nightly). Once signed in it becomes "Open dashboard"; a
 * sign-in started here goes straight to the dashboard.
 */
export function ConnectButton({ variant = "compact", showError = false }: { variant?: "primary" | "compact"; showError?: boolean }) {
  const { ready, accountId, connecting, error, connect } = useWallet();
  const router = useRouter();
  const requested = useRef(false);

  useEffect(() => {
    if (accountId && requested.current) {
      requested.current = false;
      router.push("/dashboard");
    }
  }, [accountId, router]);

  const cls = variant === "primary" ? "btn-primary" : "btn-primary !px-4 !py-2 !text-[11px]";

  if (accountId) {
    return (
      <Link href="/dashboard" className={cls}>
        Open dashboard <ArrowUpRight className="size-3.5" />
      </Link>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={() => {
          requested.current = true;
          void connect();
        }}
        disabled={!ready || connecting}
        className={cls}
      >
        <Wallet className="size-3.5" />
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
      {showError && error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
