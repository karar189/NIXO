import Link from "next/link";
import { ArrowUpRight, Bot, Eye, Fingerprint, KeyRound, LineChart, Lock, ScanSearch, ShieldCheck } from "lucide-react";
import { SiteNav, SiteFooter } from "@/components/site/SiteNav";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { NIXO_CONTRACT } from "@/lib/config";

/* ---------- data shown on the page (all real or clearly labelled) ---------- */

const STATS = [
  { k: "Trace depth", v: "6 hops", s: "transfers + pool hops" },
  { k: "Certificate", v: "7 days", s: "then re-check" },
  { k: "Exchange cost", v: "1 view call", s: "is_clean(account)" },
  { k: "Runs in", v: "Intel TDX", s: "OutLayer enclave" },
];

type Status = "live" | "build";
const PRODUCT: { icon: typeof ShieldCheck; title: string; body: string; status: Status }[] = [
  {
    icon: ShieldCheck,
    title: "Clean money at the door",
    body: "Every deposit is checked inside a secure enclave against hack and sanctions lists, several hops back. Only a Clean or Rejected certificate lands on NEAR.",
    status: "live",
  },
  {
    icon: Bot,
    title: "Private AI trading agents",
    body: "Agents analyse the market, plan a strategy and paper-trade with real NEAR Intents quotes. The strategy model is moving into a TEE on NEAR AI Cloud.",
    status: "live",
  },
  {
    icon: Fingerprint,
    title: "Agents that can't be tricked",
    body: "Before paying anyone, the agent asks NIXO about the receiver. A prompt-injected agent asking to pay a hacker wallet gets blocked.",
    status: "build",
  },
  {
    icon: LineChart,
    title: "A track record you can verify",
    body: "Returns and drawdown signed by the TEE. Viewing keys let followers and auditors unlock trades they paid for.",
    status: "build",
  },
];

const STEPS = [
  { n: "01", t: "Connect a NEAR wallet", d: "Meteor, MyNearWallet, HERE, Sender, Intear or Nightly." },
  { n: "02", t: "Prove your funds", d: "The enclave traces your money's history and writes a 7-day certificate." },
  { n: "03", t: "Fund and run an agent", d: "Paper-trade or go live through NEAR Intents, with the strategy in a TEE." },
  { n: "04", t: "Exit clean", d: "Any venue checks is_clean(account) and accepts the funds instead of freezing them." },
];

/** The real Binance-hack laundering trail on NEAR mainnet (every tx verified on chain). */
const TRAIL: { who: string; via?: string; amount?: string; tx?: string[] }[] = [
  { who: "efd2…e5af", via: "listed: Binance hack wallet" },
  { who: "d368…4484", amount: "21,351.91 NEAR", tx: ["Ec39nAANXRucmAxgHe3fMUTyKviEQMgHRHYKJ4Cnn7Do"] },
  { who: "85f0…7129", amount: "10,675 NEAR", tx: ["88VKCF4y6ZzBKCjEgyXBrWrroS1PLxyZBpCTT6RXF6bW"] },
  { who: "normalherb1811.near", amount: "200 NEAR", tx: ["8sgmUqq5UVNZcZnu5XRvVXA3qQJERevw1T5pvPNsS3ZU"] },
  {
    who: "farstreet4572.near",
    via: "MEILI pool 9009 · swap in, swap out ~20 s apart",
    amount: "≈54.65 NEAR",
    tx: ["vAqN1Njpya3ccbtje7kUmRMnYUA7qPV1h4eJcMX7JrH", "2BpPDf9WAj9j4gaND5fyFdgvA9hRdkrpyjTkiAsd8MLQ"],
  },
];

const PRIVACY: { icon: typeof Lock; t: string; s: string; d: string; status: Status }[] = [
  { icon: ScanSearch, t: "Fund history checked without revealing it", s: "Clean-funds certificate", d: "The enclave traces where money came from. Only the verdict leaves it: never balances, trades or counterparties.", status: "live" },
  { icon: Lock, t: "Private strategy", s: "TEE", d: "The agent's strategy is generated inside a secure enclave on NEAR AI Cloud, with its attestation checked on a fresh nonce every run.", status: "build" },
  { icon: KeyRound, t: "Encrypted trade log", s: "Viewing keys", d: "Trades are recorded encrypted. Followers and auditors see only what a viewing key unlocks, for the period it covers.", status: "build" },
];

/* ---------- small pieces ---------- */

function StatusTag({ status }: { status: Status }) {
  return status === "live" ? (
    <span className="inline-flex items-center gap-1.5 border border-accent/40 px-2 py-0.5 font-mono text-[9px] tracking-[0.18em] text-accent-2 uppercase">
      <span className="size-1.5 bg-accent" /> Live on testnet
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 border border-line px-2 py-0.5 font-mono text-[9px] tracking-[0.18em] text-muted uppercase">
      <span className="size-1.5 bg-muted/60" /> In build
    </span>
  );
}

function CertificatePreview() {
  const rows = [
    ["Account", "nixo-alice.testnet"],
    ["Verdict", "Clean"],
    ["Trace depth", "6 hops"],
    ["Lists", "OFAC · EU · UK · UN · SECO · hack list"],
    ["Checker", "e0c79a99…11bed6 (pinned)"],
  ];
  return (
    <div className="relative overflow-hidden border border-line bg-surface/80 backdrop-blur">
      <div className="hatch pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
      <div className="relative p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="kicker">Clean-funds certificate</p>
            <p className="display mt-3 text-lg leading-snug text-foreground">Verdict only.<br />No history.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 border border-clean/50 px-2.5 py-1 font-mono text-[9px] tracking-[0.18em] text-clean uppercase">
            <span className="size-1.5 bg-clean" /> Clean
          </span>
        </div>
        <dl className="mt-6 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 border-t border-line py-2.5">
              <dt className="kicker">{k}</dt>
              <dd className="truncate text-right font-mono text-xs text-foreground/90">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 border border-line bg-background/70 px-3 py-2 font-mono text-[11px] text-accent-2">
          is_clean(&quot;nixo-alice.testnet&quot;) → <span className="text-clean">true</span>
        </div>
        <p className="mt-3 text-xs text-muted">Example from the NEAR testnet demo, issued by {NIXO_CONTRACT}.</p>
      </div>
    </div>
  );
}

/* ---------- page ---------- */

export default function Landing() {
  return (
    <>
      <SiteNav />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-line">
          <div className="grid-bg grid-fade pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />
          <div
            className="pointer-events-none absolute -top-40 right-[-10%] h-[620px] w-[760px] rounded-full opacity-60 blur-3xl"
            style={{ background: "radial-gradient(closest-side, color-mix(in srgb, var(--accent) 38%, transparent), color-mix(in srgb, var(--deep) 30%, transparent) 55%, transparent)" }}
            aria-hidden="true"
          />
          <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:py-28">
            <div>
              <p className="kicker">NEAR · Private AI trading · TEE-verified</p>
              <h1 className="display mt-6 text-[clamp(2.1rem,5.2vw,4.1rem)] leading-[1.06] text-foreground">
                Private trading.
                <br />
                <span className="text-accent-2">Provably clean</span>
                <br />
                <span className="text-accent-2">money.</span>
              </h1>
              <p className="mt-7 max-w-xl text-[15px] leading-relaxed text-muted">
                AI agents plan and trade for you through NEAR Intents. Every deposit is traced through transfers and laundering pools inside a secure enclave,
                so exchanges accept your funds instead of freezing them.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <ConnectButton variant="primary" showError />
                <Link href="/verify" className="btn-secondary">
                  Check any wallet <ArrowUpRight className="size-3.5" />
                </Link>
              </div>
              <p className="mt-7 inline-flex items-center gap-2 border border-line px-3 py-2 font-mono text-[10px] tracking-[0.16em] text-muted uppercase">
                <Lock className="size-3 text-accent" /> Testnet demo · no real funds required
              </p>
            </div>
            <CertificatePreview />
          </div>
        </section>

        {/* Stats strip */}
        <section className="border-b border-line">
          <div className="mx-auto grid max-w-7xl grid-cols-2 lg:grid-cols-4">
            {STATS.map((s, i) => (
              <div key={s.k} className={`px-4 py-7 sm:px-6 ${i % 2 ? "border-l" : ""} ${i >= 2 ? "border-t lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""} border-line`}>
                <p className="kicker">{s.k}</p>
                <p className="display mt-3 text-xl text-foreground">{s.v}</p>
                <p className="mt-1 font-mono text-[11px] text-muted">{s.s}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Product */}
        <section id="product" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-24 sm:px-6">
          <p className="kicker">The product</p>
          <h2 className="display mt-4 max-w-3xl text-[clamp(1.5rem,3vw,2.3rem)] leading-tight">
            One desk for private trading and clean money.
          </h2>
          <div className="mt-12 grid border-t border-l border-line sm:grid-cols-2 lg:grid-cols-4">
            {PRODUCT.map(({ icon: Icon, title, body, status }) => (
              <article key={title} className="flex flex-col gap-5 border-r border-b border-line p-6 transition-colors hover:bg-surface">
                <div className="flex items-center justify-between">
                  <span className="flex size-10 items-center justify-center border border-line bg-surface text-accent">
                    <Icon className="size-[18px]" strokeWidth={1.6} />
                  </span>
                  <StatusTag status={status} />
                </div>
                <h3 className="text-base font-medium text-foreground">{title}</h3>
                <p className="text-sm leading-relaxed text-muted">{body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-20 border-y border-line bg-surface/40">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
            <p className="kicker">How it works</p>
            <h2 className="display mt-4 text-[clamp(1.5rem,3vw,2.3rem)] leading-tight">Clean in. Private trading. Clean out.</h2>
            <ol className="mt-12 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s) => (
                <li key={s.n} className="bg-background p-6">
                  <p className="font-mono text-xs text-accent">{s.n}</p>
                  <p className="mt-4 font-medium text-foreground">{s.t}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{s.d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Real trail */}
        <section className="mx-auto grid max-w-7xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="kicker">Real data · NEAR mainnet</p>
            <h2 className="display mt-4 text-[clamp(1.5rem,3vw,2.3rem)] leading-tight">A laundering trail, caught four hops out.</h2>
            <p className="mt-6 text-sm leading-relaxed text-muted">
              After the Binance hack of 29 Oct 2026, stolen funds moved through fresh wallets and a brand-new memecoin pool on Ref Finance. A list check only
              sees the first wallet. NIXO follows transfers and pool hops (a swap in and an opposite swap out of the same pool within 120 seconds, amounts
              within 15%), so the wallet at the end is rejected too.
            </p>
            <p className="mt-4 text-xs text-muted">
              The listed wallet is attributed publicly by on-chain analysts AMLBot and Shridlock. That is not an official attribution.
            </p>
            <Link href="/verify" className="btn-secondary mt-8">
              Trace it yourself <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
          <ol className="border border-line bg-surface/60">
            {TRAIL.map((step, i) => (
              <li key={step.who} className="relative border-b border-line px-5 py-4 last:border-b-0">
                <div className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-3">
                    <span className={`flex size-6 items-center justify-center font-mono text-[10px] ${i === 0 ? "bg-reject text-background" : i === TRAIL.length - 1 ? "bg-accent text-white" : "border border-line text-muted"}`}>
                      {i}
                    </span>
                    <span className="font-mono text-sm text-foreground">{step.who}</span>
                  </span>
                  {step.amount && <span className="font-mono text-xs text-accent-2">{step.amount}</span>}
                </div>
                {(step.via || step.tx) && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-9 text-xs">
                    {step.via && <span className={i === 0 ? "text-reject" : "text-muted"}>{step.via}</span>}
                    {step.tx?.map((h) => (
                      <a key={h} href={`https://nearblocks.io/txns/${h}`} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">
                        {h.slice(0, 8)}…
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ))}
            <li className="flex items-center justify-between bg-reject-bg/60 px-5 py-3">
              <span className="kicker !text-reject">Verdict for farstreet4572.near</span>
              <span className="font-mono text-xs text-reject">Rejected · taint_path · 4 hops</span>
            </li>
          </ol>
        </section>

        {/* Privacy */}
        <section id="privacy" className="scroll-mt-20 border-y border-line bg-surface/40">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
            <p className="kicker">Privacy, precisely</p>
            <h2 className="display mt-4 max-w-3xl text-[clamp(1.5rem,3vw,2.3rem)] leading-tight">What stays private, and how.</h2>
            <div className="mt-12 grid gap-px border border-line bg-line lg:grid-cols-3">
              {PRIVACY.map(({ icon: Icon, t, s, d, status }) => (
                <div key={t} className="bg-background p-7">
                  <div className="flex items-center justify-between">
                    <Icon className="size-5 text-accent" strokeWidth={1.6} />
                    <StatusTag status={status} />
                  </div>
                  <p className="kicker mt-6">{s}</p>
                  <p className="mt-2 text-lg font-medium text-foreground">{t}</p>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* For exchanges */}
        <section className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-24 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="kicker">For exchanges</p>
            <h2 className="display mt-4 text-[clamp(1.5rem,3vw,2.3rem)] leading-tight">Add NIXO in three lines.</h2>
            <p className="mt-6 text-sm leading-relaxed text-muted">
              One view call tells you whether incoming funds hold a valid, unexpired Clean certificate. You learn the verdict and its expiry. You never see
              balances, trades or counterparties.
            </p>
            <div className="mt-8 flex flex-wrap gap-6 text-sm">
              <span className="flex items-center gap-2 text-foreground">
                <Eye className="size-4 text-accent" /> Learns: verdict, expiry, checker hash
              </span>
            </div>
          </div>
          <pre className="overflow-x-auto border border-line bg-surface p-6 font-mono text-[13px] leading-relaxed">
            <span className="text-muted">{"// before crediting a deposit\n"}</span>
            <span className="text-accent-2">const</span> ok = <span className="text-accent-2">await</span> near.view({"{"}
            {"\n"}  contractId: <span className="text-clean">&quot;{NIXO_CONTRACT}&quot;</span>, method: <span className="text-clean">&quot;is_clean&quot;</span>,
            {"\n"}  args: {"{"} account: depositor {"}"} {"}"});
            {"\n"}
            <span className="text-accent-2">if</span> (!ok) freezeForReview(depositor);
          </pre>
        </section>

        {/* CTA */}
        <section className="border-t border-line">
          <div className="relative mx-auto max-w-7xl overflow-hidden px-4 py-24 text-center sm:px-6">
            <div className="hatch pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
            <p className="kicker relative">Ready when you are</p>
            <h2 className="display relative mx-auto mt-4 max-w-3xl text-[clamp(1.6rem,3.4vw,2.6rem)] leading-tight">Open the desk.</h2>
            <div className="relative mt-9 flex justify-center gap-3">
              <ConnectButton variant="primary" />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
