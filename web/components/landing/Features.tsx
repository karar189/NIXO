import { SectionHeading } from "./SectionHeading";

const features = [
  {
    title: "Risk-aware plans",
    body: "Every plan ships with a stop, a target, a position size and the reasoning behind it. No black-box signals.",
    icon: "M4 19h16M7 15l4-4 3 3 5-6",
  },
  {
    title: "Paper trading first",
    body: "Run the same plan against simulated fills and watch the agent's logs before any funds move.",
    icon: "M5 4h14v16H5zM9 8h6M9 12h6M9 16h3",
  },
  {
    title: "One account per agent",
    body: "Each agent has its own NEAR sub-account, balance and history, so performance and activity never blur together.",
    icon: "M12 4v6m0 0-6 5m6-5 6 5M6 15v5m12-5v5",
  },
  {
    title: "Scoped, revocable keys",
    body: "Agents hold function-call access keys limited to the contracts you approve. Delete the key and the agent stops.",
    icon: "M14 10a4 4 0 1 0-4 4l-6 6m3-3 2 2m1-5 2 2",
  },
  {
    title: "Budgets you set",
    body: "Give each agent a spending cap and a list of tokens it may touch. It cannot go past either.",
    icon: "M4 7h16v10H4zM4 11h16M8 15h3",
  },
  {
    title: "Intent-based execution",
    body: "Agents state the outcome they want. Solvers compete to fill it through NEAR Intents, and settlement is atomic.",
    icon: "M5 12h14m-5-5 5 5-5 5",
  },
];

export function Features() {
  return (
    <section id="features" className="scroll-mt-20 border-t border-line/60 py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Features"
          title="Automation without handing over the keys"
          body="NearArc uses NEAR's account model to keep every agent isolated, accountable and easy to switch off."
        />
        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="bg-surface p-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface-2 text-accent">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d={f.icon}
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h3 className="mt-5 text-base font-medium">{f.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
