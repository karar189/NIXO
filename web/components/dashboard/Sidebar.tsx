"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Bot,
  CandlestickChart,
  Eye,
  KeyRound,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/site/Logo";

type NavItem = { href: string; label: string; icon: LucideIcon; hint?: string; soon?: boolean };

const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/trade", label: "Swap", icon: CandlestickChart, hint: "Confidential Intents" },
  { href: "/dashboard/privacy", label: "Privacy", icon: ShieldCheck, hint: "Certificate · AI · solver" },
  { href: "/dashboard/agents", label: "Agents & vaults", icon: Bot, hint: "On-chain vault + experiment" },
  { href: "/dashboard/keys", label: "Viewing keys", icon: KeyRound, hint: "Sell access to trades", soon: true },
];

const ACCOUNT_NAV: NavItem[] = [
  { href: "/verify", label: "Exchange view", icon: Eye, hint: "is_clean lookup" },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
  { href: "/", label: "Back to site", icon: LogOut },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const renderItem = (item: NavItem) => {
    const active = pathname === item.href;
    const Icon = item.icon;
    const body = (
      <>
        <Icon className="size-[18px] shrink-0" aria-hidden="true" />
        {!collapsed && (
          <span className="flex min-w-0 flex-1 flex-col text-left">
            <span className="truncate">{item.label}</span>
            {item.hint && <span className="truncate text-[11px] text-muted/80">{item.hint}</span>}
          </span>
        )}
        {!collapsed && item.soon && (
          <span className="border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted">
            Soon
          </span>
        )}
      </>
    );
    const cls = `relative flex w-full items-center gap-3 px-2.5 py-2 text-sm transition-colors ${
      collapsed ? "justify-center" : ""
    } ${
      active
        ? "bg-accent/10 text-foreground before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:bg-accent"
        : item.soon
          ? "cursor-not-allowed text-muted/60"
          : "text-muted hover:bg-surface-2 hover:text-foreground"
    }`;

    return (
      <li key={item.label}>
        {item.soon ? (
          <span className={cls} aria-disabled="true" title={`${item.label} — coming soon`}>
            {body}
          </span>
        ) : (
          <Link href={item.href} className={cls} onClick={onClose} aria-current={active ? "page" : undefined} title={collapsed ? item.label : undefined}>
            {body}
          </Link>
        )}
      </li>
    );
  };

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={onClose} aria-hidden="true" />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-line bg-[#060c18] transition-[transform,width] duration-200 lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "lg:w-16" : "lg:w-64"}`}
        aria-label="Dashboard navigation"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-3">
          {!collapsed && (
            <Link href="/" aria-label="NIXO home" className="px-1">
              <Logo />
            </Link>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className={`hidden rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground lg:block ${collapsed ? "mx-auto" : ""}`}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-foreground lg:hidden"
            aria-label="Close navigation"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col justify-between overflow-y-auto px-2 py-4">
          <div>
            {!collapsed && (
              <p className="kicker mb-3 px-2.5">
                Desk
              </p>
            )}
            <ul className="space-y-0.5">{MAIN_NAV.map(renderItem)}</ul>
          </div>
          <div>
            {!collapsed && (
              <p className="kicker mb-3 px-2.5">
                Account
              </p>
            )}
            <ul className="space-y-0.5">{ACCOUNT_NAV.map(renderItem)}</ul>
          </div>
        </nav>
      </aside>
    </>
  );
}
