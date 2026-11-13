import { SectionHeading } from "./SectionHeading";

const points = [
  {
    title: "Self-custody by default",
    body: "Funds sit on your account and your agents' sub-accounts. NearArc never holds them.",
  },
  {
    title: "Keys that can't drain you",
    body: "Function-call keys can't attach deposits or transfer NEAR. They can only call the contracts on their allow-list.",
  },
  {
    title: "Stop in one transaction",
    body: "Revoking an agent's key takes effect at once. No support ticket, no waiting period.",
  },
];

const tree = [
  { name: "alice.near", note: "you", tone: "text-foreground" },
  { name: "├── agent-1.alice.near", note: "momentum · paper", tone: "text-accent-2" },
  { name: "├── agent-2.alice.near", note: "mean-reversion · live", tone: "text-accent" },
  { name: "└── agent-3.alice.near", note: "paused · key revoked", tone: "text-muted" },
];

export function Control() {
  return (
    <section id="control" className="scroll-mt-20 border-t border-line/60 py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2">
        <div>
          <SectionHeading
            eyebrow="You stay in control"
            title="Every agent is an account you can see and switch off"
          />
          <ul className="mt-10 space-y-6">
            {points.map((p) => (
              <li key={p.title} className="flex gap-4">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                <div>
                  <h3 className="font-medium">{p.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">{p.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface p-6 font-mono text-sm">
          <p className="mb-4 text-xs uppercase tracking-wider text-muted">
            Account tree
          </p>
          <ul className="space-y-3">
            {tree.map((row) => (
              <li
                key={row.name}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1"
              >
                <span className="whitespace-pre">{row.name}</span>
                <span className={`text-xs ${row.tone}`}>{row.note}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
