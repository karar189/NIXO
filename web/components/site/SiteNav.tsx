import Link from "next/link";
import { Logo } from "./Logo";
import { ConnectButton } from "@/components/wallet/ConnectButton";

const LINKS = [
  { href: "/#product", label: "Product" },
  { href: "/#how", label: "How it works" },
  { href: "/#privacy", label: "Privacy" },
  { href: "/verify", label: "Verify" },
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-background/80 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="NIXO home">
          <Logo />
        </Link>
        <ul className="hidden items-center gap-8 md:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="kicker transition-colors hover:text-foreground">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <ConnectButton />
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Logo />
        <p className="kicker">Private trading · provably clean money · NEAR testnet demo</p>
        <div className="flex gap-6">
          <Link href="/verify" className="kicker hover:text-foreground">
            Exchange view
          </Link>
          <Link href="/dashboard" className="kicker hover:text-foreground">
            Dashboard
          </Link>
        </div>
      </div>
    </footer>
  );
}
