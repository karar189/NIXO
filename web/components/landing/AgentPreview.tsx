const plan = [
  { label: "Market", value: "NEAR / USDC" },
  { label: "Bias", value: "Long", tone: "text-accent" },
  { label: "Entry", value: "3.12 – 3.18" },
  { label: "Stop", value: "2.98", tone: "text-danger" },
  { label: "Target", value: "3.45" },
  { label: "Size", value: "4% of budget" },
];

export function AgentPreview() {
  return (
    <figure className="relative">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-2xl shadow-black/40 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate font-mono text-sm">agent-1.alice.near</p>
            <p className="mt-1 text-xs text-muted">Momentum strategy</p>
          </div>
          <span className="shrink-0 rounded-full border border-accent-2/40 bg-accent-2/10 px-2.5 py-1 font-mono text-[11px] text-accent-2">
            PAPER
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
          {plan.map((p) => (
            <div key={p.label} className="bg-surface-2 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wider text-muted">
                {p.label}
              </p>
              <p className={`mt-1 font-mono text-sm ${p.tone ?? ""}`}>{p.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-line bg-background/60 p-4">
          <p className="text-[11px] uppercase tracking-wider text-muted">Reasoning</p>
          <p className="mt-2 text-sm leading-6 text-foreground/90">
            Trend regime with volatility contracting near support. Risk/reward
            of 1 : 2.1 clears the agent&apos;s 1 : 1.8 minimum.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-xs text-muted">
          <span className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
            Function-call key · revocable
          </span>
          <span className="font-mono">settles via NEAR Intents</span>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted">
        Example plan for illustration — not live market data.
      </figcaption>
    </figure>
  );
}
