import { SectionHeading } from "./SectionHeading";

const steps = [
  {
    title: "Connect your NEAR wallet",
    body: "Sign in with the NEAR account you already use. Your funds stay where they are.",
  },
  {
    title: "Create an agent",
    body: "NearArc creates a sub-account such as agent-1.you.near and gives it a function-call key that can only call the contracts you allow.",
  },
  {
    title: "Plan and paper-trade",
    body: "The agent reads market regime, volatility and indicators, then proposes an entry, stop, target and size. Run it as a simulation first.",
  },
  {
    title: "Execute through NEAR Intents",
    body: "Switch an agent to live and it signs the plans you approve. Solvers fill them through NEAR Intents, and every action traces back to that agent's account.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-20 border-t border-line/60 py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="How it works"
          title="From idea to on-chain trade in four steps"
          body="Analysis, simulation and execution live in one flow, so the plan you tested is the plan that runs."
        />
        <ol className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="relative rounded-2xl border border-line bg-surface p-6"
            >
              <span className="font-mono text-sm text-accent">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-4 text-lg font-medium">{s.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
