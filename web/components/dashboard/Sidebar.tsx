"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { Logo } from "@/components/site/Logo";

type NavItem = { href: string; label: string; index: string; soon?: boolean };

const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", index: "01" },
  { href: "/dashboard/trade", label: "Swap", index: "02" },
  { href: "/dashboard/markets", label: "Markets", index: "03" },
  { href: "/dashboard/news", label: "News", index: "04" },
  { href: "/dashboard/privacy", label: "Privacy", index: "05" },
  { href: "/dashboard/agents", label: "Agents & vaults", index: "06" },
  { href: "/dashboard/keys", label: "Viewing keys", index: "07" },
];

const ACCOUNT_NAV: NavItem[] = [
  { href: "/verify", label: "Exchange view", index: "EX" },
  { href: "/docs", label: "Docs", index: "DO" },
  { href: "/dashboard/settings", label: "Settings", index: "ST" },
  { href: "/", label: "Exit desk", index: "←" },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/") return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const renderItem = (item: NavItem) => {
    const active = isActive(pathname, item.href);
    const title = collapsed ? item.label : undefined;

    const inner = (
      <>
        <span
          className={`font-mono text-[10px] tracking-[0.14em] ${
            active ? "text-accent" : "text-muted/70"
          }`}
        >
          {item.index}
        </span>
        {!collapsed && (
          <>
            <span className={`min-w-0 flex-1 truncate tracking-wide ${active ? "text-foreground" : ""}`}>
              {item.label}
            </span>
            {item.soon && (
              <span className="font-mono text-[9px] tracking-[0.16em] text-muted uppercase">Soon</span>
            )}
          </>
        )}
      </>
    );

    const cls = `group flex w-full items-center gap-3 border-l-2 py-2.5 text-[13px] transition-colors ${
      collapsed ? "justify-center border-transparent px-0" : "border-transparent px-3"
    } ${
      active
        ? "border-accent bg-accent/[0.06] text-foreground"
        : item.soon
          ? "cursor-not-allowed text-muted/50"
          : "text-muted hover:border-line hover:bg-white/[0.02] hover:text-foreground"
    }`;

    return (
      <li key={item.href + item.label}>
        {item.soon ? (
          <span className={cls} aria-disabled="true" title={`${item.label} — coming soon`}>
            {inner}
          </span>
        ) : (
          <Link
            href={item.href}
            className={cls}
            onClick={onClose}
            aria-current={active ? "page" : undefined}
            title={title}
          >
            {inner}
          </Link>
        )}
      </li>
    );
  };

  return (
    <>
      {open && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/70 lg:hidden"
          onClick={onClose}
          aria-label="Close navigation"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[15.5rem] shrink-0 flex-col border-r border-line bg-background transition-[transform,width] duration-200 lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "lg:w-[4.25rem]" : "lg:w-[15.5rem]"}`}
        aria-label="Dashboard navigation"
      >
        <div
          className={`flex h-14 shrink-0 items-center border-b border-line ${
            collapsed ? "justify-center px-2" : "justify-between gap-2 px-4"
          }`}
        >
          {!collapsed && (
            <Link href="/" aria-label="NIXO home" className="min-w-0">
              <Logo />
            </Link>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="hidden size-8 items-center justify-center text-muted transition-colors hover:text-accent lg:inline-flex"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="size-4" strokeWidth={1.5} /> : <PanelLeftClose className="size-4" strokeWidth={1.5} />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center text-muted hover:text-foreground lg:hidden"
            aria-label="Close navigation"
          >
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>

        <nav className="flex flex-1 flex-col justify-between overflow-y-auto py-5">
          <div>
            {!collapsed && (
              <p className="mb-2 px-4 font-mono text-[9px] tracking-[0.28em] text-muted uppercase">Desk</p>
            )}
            <ul>{MAIN_NAV.map(renderItem)}</ul>
          </div>

          <div className="border-t border-line pt-4">
            {!collapsed && (
              <p className="mb-2 px-4 font-mono text-[9px] tracking-[0.28em] text-muted uppercase">Account</p>
            )}
            <ul>{ACCOUNT_NAV.map(renderItem)}</ul>
            {!collapsed && (
              <p className="mt-5 px-4 font-mono text-[9px] leading-relaxed tracking-[0.12em] text-muted/60">
                NIXO · clean funds desk
              </p>
            )}
          </div>
        </nav>
      </aside>
    </>
  );
}
