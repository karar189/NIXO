"use client";

import { useWallet } from "@/components/wallet/WalletProvider";
import { KpiRow } from "@/components/dashboard/KpiRow";
import { AccountCard } from "@/components/dashboard/AccountCard";
import { MarketCard } from "@/components/dashboard/MarketCard";
import { GettingStarted } from "@/components/dashboard/GettingStarted";
import { AgentsCard, RecentTrades } from "@/components/dashboard/AgentsAndTrades";
import { CleanFundsCard } from "@/components/dashboard/CleanFundsCard";

export default function DashboardPage() {
  const { accountId } = useWallet();

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 px-4 py-6 sm:px-6 lg:py-8">
      <div>
        <p className="kicker">The desk</p>
        <h1 className="display mt-2 text-2xl">Overview</h1>
        <p className="mt-2 truncate text-sm text-muted">
          Signed in as <span className="font-mono text-foreground/80">{accountId}</span>
        </p>
      </div>

      <KpiRow />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-[1fr_1.4fr_1fr]">
        <AccountCard />
        <MarketCard />
        <GettingStarted />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1fr_1.6fr]">
        <CleanFundsCard />
        <AgentsCard />
        <RecentTrades />
      </div>
    </div>
  );
}
