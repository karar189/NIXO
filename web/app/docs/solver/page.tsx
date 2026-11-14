import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Bullets,
  C,
  Callout,
  CodeBlock,
  DocSection,
  DocsShell,
  Lead,
  NextLinks,
  PageHeader,
  SectionHeading,
  SpecTable,
  Steps,
} from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Solver gate · NIXO Docs",
  description:
    "Layer 3: fail-closed middleware NEAR Intents solvers and routers call before a fill. Only a currently valid Clean certificate is allowed.",
};

export default function SolverDocsPage() {
  return (
    <DocsShell>
      <DocSection id="overview" first>
        <PageHeader kicker="Layer 3 · Solver infrastructure" title="Refuse the intent" muted="before you fill it." />
        <Lead>
          Solvers and routing agents on NEAR Intents fill whatever reaches them. The NIXO solver gate is one function they
          call first. It reads the same <C>nixo.testnet</C> certificate the vault reads and answers allow or refuse, with a
          reason. If anything is uncertain, it refuses.
        </Lead>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/dashboard/privacy#solver" className="btn-primary">
            Try the mock solver
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </DocSection>

      <DocSection id="rules">
        <SectionHeading
          eyebrow="Fail-closed rules"
          title="Only one state is allowed. Everything else is a refusal."
          copy="The gate never treats “certificate not found” as clean and never swallows a lookup error."
        />
        <SpecTable
          columns={["Certificate state", "Decision", "Code"]}
          rows={[
            ["Valid, verdict clean", "Allow", "—"],
            ["No certificate", "Refuse", "missing"],
            ["Expired or checker revoked", "Refuse", "expired"],
            ["Verdict warn", "Refuse", "warn"],
            ["Verdict rejected", "Refuse", "rejected"],
            ["Unknown verdict", "Refuse", "not_clean"],
            ["RPC / lookup failure", "Refuse", "rpc_error"],
            ["Empty origin or destination", "Refuse", "invalid"],
          ]}
        />
      </DocSection>

      <DocSection id="sdk">
        <SectionHeading
          eyebrow="checkIntent"
          title="One call, one decision."
          copy="web/lib/solver-gate.ts. Origin is required; when a destination is given it must pass the same gate. The certificate lookup is injectable so tests run without the network."
        />
        <CodeBlock label="web/lib/solver-gate.ts">{`type GateDecision =
  | { ok: true }
  | { ok: false; code: GateRefuseCode; reason: string };

checkIntent(
  input: { origin: string; destination?: string },
  lookup?: (account: string) => Promise<CertificateView | null>,
): Promise<GateDecision>

checkAccount(account: string, lookup?): Promise<GateDecision>`}</CodeBlock>
        <CodeBlock label="usage in a solver">{`import { checkIntent } from "@/lib/solver-gate";

const decision = await checkIntent({ origin: intent.signer, destination: intent.receiver });
if (!decision.ok) {
  log.warn("refused", decision.code, decision.reason);
  return; // do not quote, do not fill
}
await fill(intent);`}</CodeBlock>
      </DocSection>

      <DocSection id="mock">
        <SectionHeading
          eyebrow="Mock solver"
          title="A paper fill that shows the gate working."
          copy="web/lib/solver/mock-solver.ts wraps checkIntent. It returns filled or refused with a timestamp and the gate's decision. It never settles anything and never calls 1Click."
        />
        <SpecTable
          columns={["Intent", "Origin", "Result"]}
          rows={[
            ["1 NEAR → USDC", "nixo-alice.testnet", "filled · mock: true"],
            ["1 NEAR → USDC", "nixo-mallory.testnet", "refused · rejected (reason from the certificate)"],
          ]}
        />
      </DocSection>

      <DocSection id="try">
        <SectionHeading eyebrow="Try it" title="In the app, or from the terminal." />
        <Steps
          items={[
            { title: "In the app", body: <>Open <C>/dashboard/privacy#solver</C>, pick Alice, press <strong>Run mock fill as Alice</strong>. See filled. Pick Mallory and run again. See refused with the code and reason.</> },
            { title: "Live demo script", body: <><C>pnpm demo:solver</C> reads live certificates from <C>nixo.testnet</C> and prints both decisions.</> },
            { title: "Unit tests", body: <><C>pnpm test:solver</C> runs the gate against injected lookups: missing, expired, warn, rejected, RPC failure, destination checks.</> },
          ]}
        />
      </DocSection>

      <DocSection id="limits">
        <SectionHeading eyebrow="What it is not" title="A gate, not a solver network." />
        <Callout title="Scope in this version">
          This is a mock solver and a fail-closed SDK. It is not wired into a live Intents solver network, is not a
          published npm package yet, and does not check batches or amount-level provenance.
        </Callout>
        <Bullets
          items={[
            <Fragment key="b1">The verdict is account-level at check time. Provenance per deposit lives in the vault (Layer 2).</Fragment>,
            <Fragment key="b2">Later: a published solver package, batch and destination-level checks, a real solver integration.</Fragment>,
          ]}
        />
        <NextLinks
          links={[
            { href: "/docs/trading", label: "Trading desk" },
            { href: "/docs/developers#sdk", label: "SDK reference" },
          ]}
        />
      </DocSection>
    </DocsShell>
  );
}
