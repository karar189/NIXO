import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t border-line/60">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-10 text-sm text-muted sm:flex-row sm:items-center sm:px-6">
        <div className="flex items-center gap-4">
          <Logo className="text-foreground" />
          <span>AI trading agents on NEAR</span>
        </div>
        <p>© 2026 NearArc. Testnet preview — not financial advice.</p>
      </div>
    </footer>
  );
}
