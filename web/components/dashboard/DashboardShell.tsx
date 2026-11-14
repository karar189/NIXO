"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/components/wallet/WalletProvider";
import { DashboardDataProvider } from "./DashboardData";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { StatusBar } from "./StatusBar";

export function DashboardShell({ children }: { children: ReactNode }) {
  const { ready, accountId } = useWallet();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);

  // Dashboard is wallet-gated: once the session is restored, send guests home.
  useEffect(() => {
    if (ready && !accountId) router.replace("/");
  }, [ready, accountId, router]);

  if (!accountId) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <p className="flex items-center gap-3 text-sm text-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          {ready ? "Redirecting…" : "Restoring wallet session…"}
        </p>
      </div>
    );
  }

  return (
    <DashboardDataProvider accountId={accountId}>
      <div className="fixed inset-0 flex h-dvh overflow-hidden bg-background">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div
            className="pointer-events-none absolute right-0 top-0 -z-0 h-[55%] w-[65%] opacity-70"
            style={{
              background:
                "radial-gradient(ellipse 80% 70% at 100% 0%, color-mix(in srgb, var(--accent) 9%, transparent) 0%, color-mix(in srgb, var(--accent-2) 6%, transparent) 40%, transparent 70%)",
            }}
            aria-hidden="true"
          />
          <TopBar onOpenNav={() => setNavOpen(true)} />
          <main className="relative min-h-0 flex-1 overflow-y-auto">{children}</main>
          <StatusBar />
        </div>
      </div>
    </DashboardDataProvider>
  );
}
