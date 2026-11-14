"use client";

import { ExternalLink } from "lucide-react";
import { accountExplorerUrl } from "@/lib/near/config";
import { formatNear } from "@/lib/near/rpc";
import { useDashboardData } from "./DashboardData";
import { useWallet } from "@/components/wallet/WalletProvider";
import { Card, Skeleton } from "./Card";

export function AccountCard() {
  const { accountId, balance } = useDashboardData();
  const { network } = useWallet();
  const b = balance.data;

  const segments = b
    ? [
        { label: "Available", value: b.available, color: "bg-accent" },
        { label: "Staked", value: b.staked, color: "bg-accent-2" },
        { label: "Storage", value: b.storageReserved, color: "bg-muted" },
      ]
    : [];
  const sum = segments.reduce((s, x) => s + x.value, 0n);

  return (
    <Card
      title="Account"
      action={
        <a
          href={accountExplorerUrl(network, accountId)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
        >
          NearBlocks <ExternalLink className="size-3" />
        </a>
      }
    >
      <p className="break-all font-mono text-sm">{accountId}</p>

      <div className="mt-5">
        <p className="text-xs text-muted">Total balance</p>
        {b ? (
          <p className="mt-1 text-3xl font-semibold tracking-tight">
            {formatNear(b.total)} <span className="text-base font-normal text-muted">NEAR</span>
          </p>
        ) : balance.notFound ? (
          <p className="mt-1 text-sm text-muted">
            This account has no on-chain record yet. Fund it with testnet NEAR to activate it.
          </p>
        ) : balance.error ? (
          <p className="mt-1 text-sm text-danger">Couldn&apos;t load account: {balance.error}</p>
        ) : (
          <Skeleton className="mt-2 h-9 w-40" />
        )}
      </div>

      {b && sum > 0n && (
        <>
          <div className="mt-5 flex h-2 overflow-hidden rounded-full bg-surface-2" role="img" aria-label="Balance breakdown">
            {segments.map((s) =>
              s.value > 0n ? (
                <span
                  key={s.label}
                  className={`${s.color} h-full`}
                  style={{ width: `${Math.max(1, Number((s.value * 1000n) / sum) / 10)}%` }}
                />
              ) : null,
            )}
          </div>
          <dl className="mt-4 space-y-2.5 text-sm">
            {segments.map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-muted">
                  <span className={`h-2 w-2 rounded-full ${s.color}`} />
                  {s.label}
                </dt>
                <dd className="font-mono">{formatNear(s.value)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 text-xs">
            <div>
              <p className="text-muted">Storage used</p>
              <p className="mt-1 font-mono">{b.storageBytes.toLocaleString("en-US")} bytes</p>
            </div>
            <div>
              <p className="text-muted">Contract</p>
              <p className="mt-1 font-mono">{b.hasContract ? "Deployed" : "None"}</p>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
