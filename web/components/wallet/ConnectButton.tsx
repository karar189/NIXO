"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "./WalletProvider";

const styles = {
  primary:
    "rounded-full bg-accent px-6 py-3 text-sm font-medium text-background transition hover:brightness-110 disabled:opacity-60",
  compact:
    "rounded-full bg-accent px-4 py-2 text-sm font-medium text-background transition hover:brightness-110 disabled:opacity-60",
};

export function ConnectButton({
  variant = "compact",
  showError = false,
}: {
  variant?: keyof typeof styles;
  showError?: boolean;
}) {
  const { ready, accountId, connecting, error, connect } = useWallet();
  const router = useRouter();

  if (accountId) {
    return (
      <Link href="/trade" className={styles[variant]}>
        Open dashboard
      </Link>
    );
  }

  async function onClick() {
    const id = await connect();
    if (id) router.push("/trade");
  }

  return (
    <span className="inline-flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={!ready || connecting}
        className={styles[variant]}
      >
        {connecting ? "Connecting…" : "Connect Meteor Wallet"}
      </button>
      {showError && error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
