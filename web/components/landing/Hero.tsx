import { AgentPreview } from "./AgentPreview";
import { ConnectButton } from "@/components/wallet/ConnectButton";

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden="true" />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]"
        aria-hidden="true"
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-24 pt-20 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-28">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 font-mono text-xs text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Built on NEAR · testnet preview
          </p>
          <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            AI trading agents that work on{" "}
            <span className="bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">
              accounts you control.
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-muted">
            NearArc turns market analysis into risk-aware trade plans, lets you
            paper-trade them, and executes the ones you approve through NEAR
            Intents. Every agent runs on its own NEAR sub-account with a scoped
            key you can revoke in one transaction.
          </p>
          <div className="mt-9 flex flex-wrap items-start gap-3">
            <ConnectButton variant="primary" showError />
            <a
              href="#waitlist"
              className="rounded-full border border-line bg-surface px-6 py-3 text-sm font-medium transition hover:border-muted"
            >
              Join the waitlist
            </a>
          </div>
        </div>
        <AgentPreview />
      </div>
    </section>
  );
}
