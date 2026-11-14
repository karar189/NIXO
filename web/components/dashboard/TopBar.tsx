"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronDown, Copy, ExternalLink, LogOut, Menu } from "lucide-react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { NetworkToggle } from "@/components/wallet/NetworkToggle";
import { accountExplorerUrl } from "@/lib/near/config";

function shortAccount(id: string) {
  // Implicit accounts are 64 hex chars; named accounts are usually readable as-is.
  return id.length > 24 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

export function TopBar({ onOpenNav }: { onOpenNav: () => void }) {
  const { accountId, disconnect, network, walletName } = useWallet();
  const router = useRouter();
  const pathname = usePathname();
  const title =
    {
      "/dashboard/trade": "Swap",
      "/dashboard/agents": "Agents & vaults",
      "/dashboard/settings": "Settings",
      "/dashboard/privacy": "Privacy",
    }[pathname] ?? "Overview";
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  if (!accountId) return null;

  async function copy() {
    await navigator.clipboard.writeText(accountId!);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function onDisconnect() {
    setMenuOpen(false);
    await disconnect();
    router.replace("/");
  }

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-background/80 px-4 backdrop-blur-md sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenNav}
          className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-foreground lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </button>
        <nav aria-label="Breadcrumb">
          <span className="display text-[12px] tracking-[0.14em] text-foreground">{title}</span>
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <NetworkToggle className="hidden sm:block" />

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-3 text-sm transition-colors hover:border-muted"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-accent to-deep font-mono text-[11px] font-semibold uppercase text-accent-ink">
              {accountId[0]}
            </span>
            <span className="max-w-[9rem] truncate font-mono text-xs sm:max-w-none">{shortAccount(accountId)}</span>
            <ChevronDown className="size-3.5 text-muted" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl shadow-black/50"
            >
              <div className="border-b border-line px-4 py-3">
                <p className="kicker">Connected{walletName ? ` with ${walletName}` : ""}</p>
                <p className="mt-1 break-all font-mono text-xs">{accountId}</p>
              </div>
              <button type="button" role="menuitem" onClick={copy} className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground">
                {copied ? <Check className="size-4 text-accent" /> : <Copy className="size-4" />}
                {copied ? "Copied" : "Copy account ID"}
              </button>
              <a
                role="menuitem"
                href={accountExplorerUrl(network, accountId)}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
              >
                <ExternalLink className="size-4" />
                View on NearBlocks
              </a>
              <button
                type="button"
                role="menuitem"
                onClick={onDisconnect}
                className="flex w-full items-center gap-3 border-t border-line px-4 py-2.5 text-sm text-danger hover:bg-danger/10"
              >
                <LogOut className="size-4" />
                Disconnect
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
