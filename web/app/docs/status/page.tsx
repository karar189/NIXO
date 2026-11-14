import { Fragment } from "react";
import type { Metadata } from "next";
import {
  Bullets,
  C,
  Callout,
  DocSection,
  DocsShell,
  Lead,
  NextLinks,
  PageHeader,
  SectionHeading,
  SpecTable,
  StatusPill,
} from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Status and limits · NIXO Docs",
  description:
    "What is live on NEAR testnet, what is a labelled fixture or mock, what NIXO trusts, what it does not claim, and what comes next.",
};

export default function StatusDocsPage() {
  return (
    <DocsShell>
      <DocSection id="real" first>
        <PageHeader kicker="Status and limits" title="What is real," muted="what is labelled, what is later." />
        <Lead>
          Every mocked piece is tagged in the app and listed here. If something below says fixture, mock or later, the
          product does not claim it.
        </Lead>
        <SpecTable
          columns={["Piece", "Detail", "Status"]}
          rows={[
            ["Checker core + multi-hop search", "Rust source, Kani-proven on bounded harnesses", <StatusPill key="1" status="live" />],
            ["OutLayer + nixo.testnet certificates", "Real TEE runs and certificates on testnet", <StatusPill key="2" status="live" />],
            ["Live NearBlocks history in the enclave", "Checker 0.3.0, pinned on chain", <StatusPill key="3" status="live">pinned</StatusPill>],
            ["Re-issuing certificates under 0.3.0", "OutLayer currently fails the run; nothing is stored", <StatusPill key="4" status="blocked" />],
            ["Stored Alice / Mallory certificates", "Checker 0.1.0, fixture history, valid to 20–21 Nov 2026", <StatusPill key="5" status="fixture" />],
            ["Sanctions lists", "Real snapshot data-2026-10-29", <StatusPill key="6" status="live" />],
            ["Hacker list", "One entry, unofficial public attribution", <StatusPill key="7" status="fixture">limited</StatusPill>],
            ["Check any wallet", "Preview only, caller_supplied, different build hash", <StatusPill key="8" status="mock">preview</StatusPill>],
            ["On-chain vault gated by is_clean", "nixo-vault.testnet deployed", <StatusPill key="9" status="live" />],
            ["Delayed viewing key + encrypted trade log", "Agents service, off-chain", <StatusPill key="10" status="live" />],
            ["Live / time-limited / auditor keys", "Typed, refuse to redeem", <StatusPill key="11" status="later" />],
            ["Two-agent experiment", "Off-chain enforcement, simulated execution, stub provenance", <StatusPill key="12" status="mock">simulated</StatusPill>],
            ["Solver gate + mock solver", "Fail-closed SDK, paper fill only", <StatusPill key="13" status="mock" />],
            ["Private AI", "NEAR AI Cloud, fresh-nonce checks, no retention", <StatusPill key="14" status="live" />],
            ["Confidential Intents swaps", "Mainnet, wallet-signed", <StatusPill key="15" status="live" />],
            ["Chain Signatures / cross-chain relayer", "Not built", <StatusPill key="16" status="later" />],
          ]}
        />
      </DocSection>

      <DocSection id="trust">
        <SectionHeading eyebrow="Trust assumptions" title="What you have to believe for a Clean to mean something." />
        <Bullets
          items={[
            <Fragment key="b1">Intel TDX and OutLayer measurements are sound, and the pinned WASM hash is the code that ran.</Fragment>,
            <Fragment key="b2"><C>resolve_nixo</C> is private, so only the OutLayer callback can write a certificate.</Fragment>,
            <Fragment key="b3">NearBlocks returns correct history at the pinned block height (live mode).</Fragment>,
            <Fragment key="b4">The compiled lists are correct as of their snapshot date.</Fragment>,
            <Fragment key="b5">Documented terminal accounts (faucets, venues) are list-checked but not expanded.</Fragment>,
          ]}
        />
      </DocSection>

      <DocSection id="not">
        <SectionHeading eyebrow="What NIXO does not claim" title="Bounded screening, stated plainly." />
        <Callout title="Privacy">
          The strategy can be private inside a TEE, the trade log is encrypted and readable with viewing keys, and fund
          history is checked without being revealed. NIXO does not hide trades on-chain. Vault deposits, Intents
          settlements and ordinary transfers remain visible on explorers.
        </Callout>
        <Bullets
          items={[
            <Fragment key="b6">Not a legal or AML proof that particular coins are clean.</Fragment>,
            <Fragment key="b7"><C>is_clean</C> is account-level at check or deposit time, not a property of specific coins.</Fragment>,
            <Fragment key="b8">Pool-hop linking is a heuristic (time window and amount tolerance).</Fragment>,
            <Fragment key="b9">Cross-chain origin is out of scope. Bridges, other DEXes and <C>intents.near</C> are not fully followed.</Fragment>,
            <Fragment key="b10">Kani proofs cover algorithm logic, not list completeness or indexer correctness.</Fragment>,
          ]}
        />
      </DocSection>

      <DocSection id="related">
        <SectionHeading eyebrow="Related work" title="Where NIXO sits." />
        <SpecTable
          columns={["Who", "What they do", "Where NIXO differs"]}
          rows={[
            ["Chainalysis, TRM, Elliptic", "Score public history", "See nothing inside private systems; NIXO screens inside a TEE and publishes a verdict only"],
            ["Jurat", "TEE proof of balance ≥ X", "Proves how much; NIXO proves where funds did not come from"],
            ["Gateflow", "Sanctions checks on public checkouts", "Public inputs, no TEE certificate"],
            ["Privacy Pools", "ZK exclusion from bad deposits", "Single-pool focus; NIXO is a passport + gate for agents and solvers"],
            ["Zcash viewing keys", "Reveal shielded history", "Reveal everything; NIXO emits a verdict and separately encrypts trade logs"],
          ]}
        />
      </DocSection>

      <DocSection id="roadmap">
        <SectionHeading eyebrow="Roadmap" title="Hackathon version, then v1, then v2." />
        <SpecTable
          columns={["Stage", "Scope"]}
          rows={[
            ["This version", "Live enclave history, vault gate on is_clean, agent within contract limits, one delayed viewing key, mock solver, honest README"],
            ["v1", "Mainnet, multisig governance, published SDKs, audit, withdrawal pilot, real solver integration"],
            ["v2", "Chain Signatures registries, richer disclosure keys (live, time-limited, auditor), destination and amount-level provenance, broader venue coverage"],
          ]}
        />
        <NextLinks
          links={[
            { href: "/docs", label: "Back to overview" },
            { href: "/docs/tracer", label: "Clean-funds passport" },
          ]}
        />
      </DocSection>
    </DocsShell>
  );
}
