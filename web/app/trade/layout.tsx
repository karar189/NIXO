import type { Metadata } from "next";
import { WalletProvider } from "@/components/wallet/WalletProvider";

export const metadata: Metadata = {
  title: "Trade — NIXO",
  description:
    "AI agents that plan, paper-trade and execute on NEAR sub-accounts you control, with scoped keys you can revoke in one transaction.",
};

// The trading app (imported from NearArc) keeps its own dark theme: its colour
// tokens are scoped to .theme-arc in globals.css so NIXO pages are unaffected.
export default function TradeLayout({ children }: LayoutProps<"/trade">) {
  return (
    <div className="theme-arc flex min-h-full flex-1 flex-col bg-background text-foreground">
      <WalletProvider>{children}</WalletProvider>
    </div>
  );
}
