import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CandlestickChart,
  ChevronRight,
  CodeXml,
  Route,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Vault,
} from "lucide-react";
import {
  C,
  DocSection,
  DocsShell,
  Lead,
  PageHeader,
  SectionHeading,
  SpecTable,
  StatusPill,
  Steps,
} from "@/components/docs/docs-shell";
import { REPO_URL } from "@/components/docs/links";

export const metadata: Metadata = {
  title: "Docs · NIXO",
  description:
    "NIXO is a clean-funds passport and a gated trading layer for NEAR: a TEE-checked certificate, a vault that only accepts certified deposits, and a fail-closed gate for solvers.",
};

const layers = [
  {
    icon: ScanSearch,
    layer: "Layer 1 · creates trust",
    title: "Clean-funds passport",
    copy: "A pinned Rust checker runs in an OutLayer TEE (Intel TDX), traces up to six hops of fund history and writes a short Clean / Warn / Rejected certificate to nixo.testnet. Never the path.",
    href: "/docs/tracer",
    cta: "Read the passport",
  },
  {
    icon: Vault,
    layer: "Layer 2 · puts trust to work",
    title: "Vault and AI agents",
    copy: "nixo-vault.testnet accepts a deposit only if is_clean is true at that moment, records provenance per deposit, and lets an AI agent trade it only inside limits the contract enforces.",
    href: "/docs/vault",
    cta: "Read the vault",
  },
  {
    icon: Route,
    layer: "Layer 3 · spreads trust",
    title: "Solver gate",
    copy: "Fail-closed middleware any NEAR Intents solver or router can call before a fill. Only a currently valid Clean certificate passes. Missing, expired, warn, rejected or RPC error all refuse.",
    href: "/docs/solver",
    cta: "Read the solver gate",
  },
] as const;

const surfaces = [
  {
    icon: CandlestickChart,
    title: "Trading desk",
    copy: "Wallet-signed spot swaps through Confidential Intents (1Click, private-shard settlement) plus a paper desk priced with real dry quotes.",
    href: "/docs/trading",
  },
  {
    icon: Sparkles,
    title: "Private AI",
    copy: "NEAR AI Cloud explains a public certificate in plain English. Fresh-nonce attestation checks, nothing retained server-side.",
    href: "/docs/private-ai",
  },
  {
    icon: CodeXml,
    title: "Developer reference",
    copy: "Every contract method, event, HTTP route and SDK function, plus how to run the stack locally.",
    href: "/docs/developers",
  },
  {
    icon: ShieldCheck,
    title: "Status and limits",
    copy: "What is live on testnet, what is a labelled fixture or mock, what NIXO trusts and what it does not claim.",
    href: "/docs/status",
  },
] as const;

export default function DocsIndexPage() {
  return (
    <DocsShell>
      <DocSection id="overview" first>
        <PageHeader kicker="NIXO documentation" title="Prove your money is clean" muted="without proving where it's been." />
        <Lead>
          NIXO is a clean-funds passport and a gated trading layer for NEAR. It checks the source of funds inside a
          trusted execution environment, lets an AI agent trade only certified deposits under limits the contract
          enforces, and lets solvers refuse an intent that is not clean.
        </Lead>
        <Lead>
          An exchange, vault or solver learns one thing: a verdict. Not the hop path, not balances, not counterparties.
          NIXO is bounded on-chain provenance screening, not a legal or AML proof that particular coins are clean.
        </Lead>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/docs/tracer" className="btn-primary">
            Start with the passport
            <ArrowRight className="size-4" />
          </Link>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 border border-line bg-surface px-5 py-3 text-xs font-semibold tracking-[0.1em] text-foreground uppercase transition-colors hover:border-accent/60"
          >
            Source
            <ArrowUpRight className="size-4" />
          </a>
        </div>
      </DocSection>

      <DocSection id="problem">
        <SectionHeading
          eyebrow="The problem"
          title="Compliance checks leak the history they check."
          copy="Exchanges, vaults and AI trading agents need to know whether incoming funds are tied to sanctioned or stolen money. Today that means handing a full history to a central screener, or trusting an agent with a hot wallet and hoping it behaves."
        />
        <SpecTable
          columns={["Failure", "What goes wrong", "NIXO's answer"]}
          rows={[
            [
              "History leaks",
              "Counterparties, balances and routes become visible to whoever runs the check.",
              "The trace runs inside a TEE. Only a short verdict reaches the chain.",
            ],
            [
              "Account ≠ coins",
              "A wallet is certified once, receives dirty money, then deposits.",
              "The vault re-checks is_clean at deposit time and records provenance per deposit.",
            ],
            [
              "No shared gate",
              "A prompt-injected agent or an indiscriminate solver moves money a human would refuse.",
              "The contract enforces agent limits; solvers call one fail-closed gate.",
            ],
          ]}
        />
      </DocSection>

      <DocSection id="layers">
        <SectionHeading
          eyebrow="Three layers"
          title="The tracer creates trust. The vault uses it. The solver spreads it."
          copy="Each layer reads the same public call: is_clean(account) on nixo.testnet. Pick the layer you integrate with."
        />
        <div className="mt-9 grid gap-px overflow-hidden border border-line bg-line md:grid-cols-3">
          {layers.map((l) => {
            const Icon = l.icon;
            return (
              <Link key={l.title} href={l.href} className="group flex flex-col bg-surface p-6 transition-colors hover:bg-surface-2">
                <div className="flex items-start justify-between">
                  <span className="flex size-10 items-center justify-center border border-line bg-black text-accent">
                    <Icon className="size-[18px]" />
                  </span>
                  <ArrowUpRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
                <p className="kicker mt-8">{l.layer}</p>
                <h3 className="display mt-2 text-xl">{l.title}</h3>
                <p className="mt-3 flex-1 text-sm leading-6 text-muted">{l.copy}</p>
                <span className="mt-7 inline-flex items-center gap-1.5 text-xs font-semibold text-accent">
                  {l.cta}
                  <ChevronRight className="size-3.5" />
                </span>
              </Link>
            );
          })}
        </div>
      </DocSection>

      <DocSection id="surfaces">
        <SectionHeading
          eyebrow="Product surfaces"
          title="A desk, not just a checker."
          copy="The web app puts the certificate next to trading, the agent vault and a private AI explainer."
        />
        <div className="mt-9 grid gap-px overflow-hidden border border-line bg-line sm:grid-cols-2">
          {surfaces.map((s) => {
            const Icon = s.icon;
            return (
              <Link key={s.title} href={s.href} className="group flex gap-4 bg-surface p-5 transition-colors hover:bg-surface-2">
                <Icon className="mt-0.5 size-[18px] shrink-0 text-accent" />
                <div>
                  <p className="text-sm font-medium text-foreground">{s.title}</p>
                  <p className="mt-1.5 text-sm leading-6 text-muted">{s.copy}</p>
                </div>
              </Link>
            );
          })}
        </div>
        <SpecTable
          columns={["Route", "What you do there", "Status"]}
          rows={[
            ["/dashboard/privacy#clean-funds", "Request a certificate with your wallet, or run the judge demo as Alice or Mallory without one.", <StatusPill key="a" status="live" />],
            ["/verify", "Exchange view: paste an account, read is_clean and the Verified panel.", <StatusPill key="b" status="live" />],
            ["/dashboard/agents", "On-chain vault panel, viewing keys, two-agent adversarial experiment.", <StatusPill key="c" status="live">live + experiment</StatusPill>],
            ["/dashboard/privacy#solver", "Paper fill through the fail-closed gate: Alice filled, Mallory refused.", <StatusPill key="d" status="mock" />],
            ["/dashboard/trade", "Confidential Intents spot swaps (mainnet) and the paper desk.", <StatusPill key="e" status="live" />],
            ["/dashboard/privacy#private-ai", "NEAR AI Cloud explainer with attestation checks.", <StatusPill key="f" status="live" />],
            ["/dashboard/settings", "Pick the LLM provider and model for agents.", <StatusPill key="g" status="live" />],
          ]}
        />
      </DocSection>

      <DocSection id="audience">
        <SectionHeading eyebrow="Who it is for" title="Four roles, one verdict." />
        <SpecTable
          columns={["Role", "What they get", "What they never see"]}
          rows={[
            ["Depositor", "Certify once, deposit clean funds, assign an agent with limits, revoke, withdraw.", "—"],
            ["Exchange / desk", "is_clean and get_certificate before crediting a deposit.", "Hop path, balances, counterparties"],
            ["Solver / router", "checkIntent before fill: allow only Clean, refuse everything else.", "Why a wallet is dirty beyond a reason code"],
            ["Agent developer", "A function-call key that can call execute and nothing else.", "The owner's full-access key or the funds"],
          ]}
        />
      </DocSection>

      <DocSection id="tour">
        <SectionHeading
          eyebrow="90-second tour"
          title="Do this, see that."
          copy="No real funds needed. Two pre-seeded testnet accounts: nixo-alice.testnet (clean) and nixo-mallory.testnet (a replay of a real mainnet hack trail)."
        />
        <Steps
          items={[
            {
              title: "Run the stack",
              body: (
                <>
                  <C>cp .env.example .env && pnpm run setup && pnpm dev</C>, then open <C>http://localhost:3000</C>.
                </>
              ),
            },
            {
              title: "Certify Alice",
              body: (
                <>
                  On <C>/dashboard/privacy#demo</C> (Judge demo, no wallet), pick Alice and press{" "}
                  <strong>Run demo as Alice</strong>. See pending, then a ✅ Clean certificate with verdict, expiry, checker
                  version and history source. No hop path.
                </>
              ),
            },
            {
              title: "Reject Mallory",
              body: (
                <>
                  Pick Mallory (<C>nixo-mallory.testnet</C>) and run again. See ❌ Rejected with a reason code, never the
                  path.
                </>
              ),
            },
            {
              title: "Act as an exchange",
              body: (
                <>
                  Open <C>/verify</C>, paste <C>nixo-alice.testnet</C>. See live <C>is_clean → true</C> and the Verified
                  panel (WASM hash, attestation, list snapshot, Kani link).
                </>
              ),
            },
            {
              title: "Gate a vault and a solver",
              body: (
                <>
                  <C>/dashboard/agents</C> shows the on-chain vault (deposit gated by <C>is_clean</C>, assign, execute
                  dry-run, revoke, withdraw). <C>/dashboard/privacy#solver</C> fills Alice and refuses Mallory.
                </>
              ),
            },
          ]}
        />
      </DocSection>
    </DocsShell>
  );
}
