import Link from "next/link";

export default function NixoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-border">
        <nav className="mx-auto flex max-w-3xl items-center gap-6 px-4 py-4">
          <Link href="/" className="font-semibold tracking-tight">
            NIXO
          </Link>
          <Link href="/" className="text-sm text-muted hover:text-foreground">
            Prove funds
          </Link>
          <Link href="/verify" className="text-sm text-muted hover:text-foreground">
            Verify (exchange)
          </Link>
          <Link href="/trade" className="text-sm text-muted hover:text-foreground">
            Trade
          </Link>
          <span className="ml-auto rounded-full bg-mock-bg px-2 py-0.5 text-xs text-mock">testnet</span>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">{children}</main>
    </>
  );
}
