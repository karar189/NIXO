import { SectionHeading } from "./SectionHeading";

const faqs = [
  {
    q: "Does NearArc take custody of my funds?",
    a: "No. Funds stay on your NEAR account and your agents' sub-accounts. Agent keys are function-call access keys, so they can't transfer NEAR or call contracts outside their allow-list.",
  },
  {
    q: "Will an agent trade without my approval?",
    a: "Only if you switch it to live mode. By default an agent proposes plans and paper-trades them, and nothing touches your funds.",
  },
  {
    q: "How do I stop an agent?",
    a: "Revoke its key from the dashboard. It's a single on-chain transaction, and the agent can't act after it lands.",
  },
  {
    q: "Why NEAR Intents?",
    a: "An agent describes the result it wants, and solvers compete to deliver it. Settlement is atomic, so a trade either completes in full or doesn't happen.",
  },
  {
    q: "Is it live on mainnet?",
    a: "Not yet. NearArc is in a testnet preview. Join the waitlist to hear when mainnet access opens.",
  },
];

export function FAQ() {
  return (
    <section id="faq" className="scroll-mt-20 border-t border-line/60 py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionHeading eyebrow="FAQ" title="Questions, answered" />
        <div className="mt-10 divide-y divide-line rounded-2xl border border-line bg-surface">
          {faqs.map((f) => (
            <details key={f.q} className="group px-6 py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                {f.q}
                <span
                  className="text-muted transition-transform group-open:rotate-45"
                  aria-hidden="true"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-6 text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
