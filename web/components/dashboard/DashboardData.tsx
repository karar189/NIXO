"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { usePolling } from "@/lib/usePolling";
import { latestBlockHeight, toBalance, viewAccount, type AccountBalance } from "@/lib/near/rpc";
import { useWallet } from "@/components/wallet/WalletProvider";
import { fetchQuotes, type Quotes } from "@/lib/market";

type Loadable<T> = { data: T | null; error: string | null; loading: boolean };

type DashboardData = {
  accountId: string;
  balance: Loadable<AccountBalance> & { notFound: boolean };
  quotes: Loadable<Quotes>;
  blockHeight: Loadable<number>;
};

const Ctx = createContext<DashboardData | null>(null);

export function DashboardDataProvider({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) {
  const { network } = useWallet();
  const account = usePolling(async () => toBalance(await viewAccount(network, accountId)), 30_000, [accountId, network]);
  const quotes = usePolling(fetchQuotes, 60_000);
  const block = usePolling(() => latestBlockHeight(network), 10_000, [network]);

  const value = useMemo<DashboardData>(
    () => ({
      accountId,
      balance: {
        data: account.data,
        error: account.error,
        loading: account.loading,
        // A brand-new implicit account has no on-chain record until it's funded.
        notFound: account.error === "UNKNOWN_ACCOUNT",
      },
      quotes: { data: quotes.data, error: quotes.error, loading: quotes.loading },
      blockHeight: { data: block.data, error: block.error, loading: block.loading },
    }),
    [accountId, account.data, account.error, account.loading, quotes.data, quotes.error, quotes.loading, block.data, block.error, block.loading],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Inert stand-in while there is no account yet: the wallet gate in
// DashboardShell and static prerender at build time. Same shape, everything
// loading, and no polling, so hidden pages render without network calls.
const PLACEHOLDER: DashboardData = {
  accountId: "",
  balance: { data: null, error: null, loading: true, notFound: false },
  quotes: { data: null, error: null, loading: true },
  blockHeight: { data: null, error: null, loading: true },
};

export function DashboardDataPlaceholder({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={PLACEHOLDER}>{children}</Ctx.Provider>;
}

export function useDashboardData() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDashboardData must be used inside <DashboardDataProvider>");
  return ctx;
}
