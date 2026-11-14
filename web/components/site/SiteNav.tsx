import Link from "next/link";
import { Logo } from "./Logo";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { NetworkToggle } from "@/components/wallet/NetworkToggle";

const LINKS = [
  { href: "/#product", label: "Product" },
  { href: "/#how", label: "How it works" },
  { href: "/#privacy", label: "Privacy" },
  { href: "/dashboard/privacy", label: "Privacy" },
  { href: "/verify", label: "Verify" },
  { href: "/docs", label: "Docs" },
];

export function SiteNav() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-3 sm:px-6 sm:pt-4">
      <nav className="pointer-events-auto flex h-12 w-full max-w-7xl items-center justify-between gap-4 border border-line/80 bg-black/55 px-4 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:h-14 sm:gap-6 sm:px-5 rounded-[14px]">
        <Link href="/" aria-label="NIXO home" className="shrink-0 text-foreground">
          <Logo />
        </Link>
        <ul className="hidden items-center gap-6 md:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="kicker transition-colors hover:text-accent">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <NetworkToggle />
          <ConnectButton />
        </div>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-line">
      <div className="mx-auto max-w-7xl px-4 pt-14 pb-8 sm:px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="text-foreground">
            <Logo />
            <p className="mt-4 max-w-xs text-sm text-muted">
              Private strategy (TEE). Encrypted trade log (viewing keys). Fund history checked without revealing it.
            </p>
          </div>
          <div className="flex gap-10">
            <div className="flex flex-col gap-3">
              <p className="kicker">Site</p>
              <Link href="/#product" className="text-sm text-muted hover:text-accent">Product</Link>
              <Link href="/#how" className="text-sm text-muted hover:text-accent">How it works</Link>
              <Link href="/#privacy" className="text-sm text-muted hover:text-accent">Privacy</Link>
              <Link href="/docs" className="text-sm text-muted hover:text-accent">Docs</Link>
            </div>
            <div className="flex flex-col gap-3">
              <p className="kicker">App</p>
              <Link href="/dashboard" className="text-sm text-muted hover:text-accent">Dashboard</Link>
              <Link href="/dashboard/privacy" className="text-sm text-muted hover:text-accent">Privacy</Link>
              <Link href="/verify" className="text-sm text-muted hover:text-accent">Exchange view</Link>
            </div>
          </div>
        </div>
        <p className="display mt-16 text-[clamp(4rem,18vw,17rem)] leading-[0.8] text-surface-2 select-none" aria-hidden="true">
          NIXO
        </p>
        <div className="mt-6 flex flex-col gap-2 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="kicker">Private trading · provably clean money</p>
          <p className="kicker">NEAR testnet demo · 2026</p>
        </div>
      </div>
    </footer>
  );
}
