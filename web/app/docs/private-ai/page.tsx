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
  StatusPill,
  Steps,
} from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Private AI · NEAR AI Cloud · NIXO Docs",
  description:
    "A TEE-hosted model on NEAR AI Cloud explains public certificates and sample documents. Fresh-nonce attestation checks, no server-side retention.",
};

export default function PrivateAiDocsPage() {
  return (
    <DocsShell>
      <DocSection id="overview" first>
        <PageHeader kicker="Private AI · NEAR AI Cloud" title="Explain the verdict." muted="Keep nothing." />
        <Lead>
          A certificate is short on purpose. Private AI turns it into a plain-English note using a model hosted in a TEE on
          NEAR AI Cloud. It only ever sees public certificate fields or fictional sample documents, checks the
          enclave&apos;s attestation with a fresh nonce on every call, and stores nothing.
        </Lead>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/dashboard/privacy#private-ai" className="btn-primary">
            Open Private AI
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </DocSection>

      <DocSection id="explainer">
        <SectionHeading
          eyebrow="Certificate explainer"
          title="Two endpoints, one rule: public inputs only."
          copy="Neither endpoint ever receives raw history, bank feeds or private chain data."
        />
        <SpecTable
          columns={["Route", "Input", "What the model sees"]}
          rows={[
            ["POST /api/explain", "{ account }", "The public on-chain certificate, re-read from nixo.testnet by the server"],
            ["POST /api/private-ai", "{ sample: alice | mallory | expense } or { document }", "A fictional sample from fixtures/samples/ or a caller-supplied public certificate JSON"],
            ["GET /api/private-ai", "—", "Lists samples and the model. Never returns secrets."],
          ]}
        />
        <Bullets
          items={[
            <Fragment key="b1">Default model: <C>deepseek-ai/DeepSeek-V3.1</C> (<C>NEARAI_MODEL</C>) at <C>cloud-api.near.ai/v1</C>.</Fragment>,
            <Fragment key="b2">Output is at most ~120 words: what the verdict means, anything unusual compared with a clean certificate, and expense categories when the sample has line items.</Fragment>,
          ]}
        />
      </DocSection>

      <DocSection id="attestation">
        <SectionHeading
          eyebrow="Attestation checks"
          title="Every call fetches a fresh report and shows its work."
          copy="The server generates a new client nonce, requests the model's attestation report with it, and lists each check in the Verified panel."
        />
        <SpecTable
          columns={["Check", "What it confirms", "Where"]}
          rows={[
            ["report_fetched", "Attestation report fetched with a fresh client nonce", <StatusPill key="1" status="live">web</StatusPill>],
            ["nonce_bound", "The nonce is echoed in the report (client binding, not a replay)", <StatusPill key="2" status="live">web</StatusPill>],
            ["tee_fields", "TDX quote / measurement fields are present", <StatusPill key="3" status="live">web</StatusPill>],
            ["signer", "A signing identity is present on the report", <StatusPill key="4" status="live">web</StatusPill>],
            ["full_dcap", "Full Intel TDX DCAP + GPU (NRAS) quote verification and response-signature check", <StatusPill key="5" status="fixture">smoke script</StatusPill>],
          ]}
        />
        <Callout title="Where full verification happens">
          The web checks are presence and binding checks. Cryptographic DCAP / NRAS verification and the response
          signature check run end-to-end in <C>scripts/nearai_smoke.py</C> with <C>nearai-inference-sdk</C>.
        </Callout>
      </DocSection>

      <DocSection id="retention">
        <SectionHeading eyebrow="No retention" title="Ephemeral by construction." />
        <Bullets
          items={[
            <Fragment key="b3">Prompts, completions and attestation blobs are never written to disk, a database or logs.</Fragment>,
            <Fragment key="b4">Responses carry <C>Cache-Control: no-store, no-cache, must-revalidate, private</C>.</Fragment>,
            <Fragment key="b5">Request-scoped variables are dropped when the handler returns.</Fragment>,
            <Fragment key="b6">Without <C>NEARAI_API_KEY</C> the endpoints return a clear error instead of falling back to another provider.</Fragment>,
          ]}
        />
      </DocSection>

      <DocSection id="try">
        <SectionHeading eyebrow="Try it" title="Do this, see that." />
        <Steps
          items={[
            { title: "Add a key", body: <>Create a key at cloud.near.ai and set <C>NEARAI_API_KEY</C> in the root <C>.env</C>.</> },
            { title: "Run a sample", body: <>Open <C>/dashboard/privacy#private-ai</C>, pick the Mallory sample, run it. See a short note explaining the rejection and the Verified panel with each check.</> },
            { title: "Verify end to end", body: <>Run the smoke test below. See DCAP, event-log and signature verification pass for one completion.</> },
          ]}
        />
        <CodeBlock label="scripts/nearai_smoke.py">{`python3.12 -m venv .venv-nearai
.venv-nearai/bin/pip install nearai-inference-sdk==0.3.0 httpx
NEARAI_API_KEY=… .venv-nearai/bin/python scripts/nearai_smoke.py`}</CodeBlock>
        <NextLinks
          links={[
            { href: "/docs/developers", label: "Developer reference" },
            { href: "/docs/status", label: "Status and limits" },
          ]}
        />
      </DocSection>
    </DocsShell>
  );
}
