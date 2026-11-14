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
  Prose,
  SectionHeading,
  SpecTable,
  StatusPill,
  Steps,
} from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Clean-funds passport · NIXO Docs",
  description:
    "Layer 1: a pinned Rust checker in an OutLayer TEE traces fund history and writes a short certificate to nixo.testnet. is_clean(account) is the public gate.",
};

export default function TracerDocsPage() {
  return (
    <DocsShell>
      <DocSection id="status" first>
        <PageHeader kicker="Layer 1 · Fund tracer" title="A verdict on-chain." muted="The history stays in the enclave." />
        <Lead>
          The passport answers one question for anyone who asks: is this NEAR account currently certified clean? The
          trace that produced the answer runs inside an Intel TDX enclave on OutLayer. Only a short certificate, under
          ~900 bytes and never the path, reaches <C>nixo.testnet</C>.
        </Lead>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/dashboard/privacy#clean-funds" className="btn-primary">
            Get a certificate
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/verify"
            className="inline-flex items-center gap-2 border border-line bg-surface px-5 py-3 text-xs font-semibold tracking-[0.1em] text-foreground uppercase transition-colors hover:border-accent/60"
          >
            Exchange view
          </Link>
        </div>
        <SpecTable
          columns={["Component", "Value on testnet", "Status"]}
          rows={[
            ["Certificate contract", "nixo.testnet · owner nixo.testnet · OutLayer outlayer.testnet", <StatusPill key="1" status="live" />],
            ["Pinned checker", "3ebe1fb8…ed59 (checker 0.3.0, live NearBlocks history), served from test.fastfs.io", <StatusPill key="2" status="live" />],
            ["Certificate TTL", "7 days (604 800 s)", <StatusPill key="3" status="live" />],
            ["Checker timelock", "5 minutes on testnet (48 h default in code)", <StatusPill key="4" status="live" />],
            ["Stored demo certificates", "Alice clean / Mallory rejected · checker 0.1.0, fixture history, valid to 20–21 Nov 2026", <StatusPill key="5" status="fixture" />],
            ["Re-issuing under 0.3.0", "OutLayer returns Execution promise failed → nixo_failed: no_result. Nothing is stored (fail closed).", <StatusPill key="6" status="blocked" />],
          ]}
        />
        <Callout title="Read this before demoing">
          The live pin is the 0.3.0 checker, but the certificates already on chain were issued by 0.1.0 from compiled
          fixtures. <C>get_certificate</C> shows <C>checker_version</C> and <C>history_source</C>, so a reader can always
          tell which checker spoke. Compare it against <C>get_checker_hash</C>.
        </Callout>
      </DocSection>

      <DocSection id="what">
        <SectionHeading
          eyebrow="What this is"
          title="A passport any contract can read in one call."
          copy="An exchange, vault or solver calls is_clean(account). True means a currently valid, unexpired, unrevoked Clean certificate exists. Everything else is false."
        />
        <SpecTable
          columns={["Piece", "Role", "Where"]}
          rows={[
            ["Checker", "Deterministic screening rules inside the TEE. Rust → wasm32-wasip2.", "checker/"],
            ["Certificate contract", "Pins the checker hash, receives the OutLayer callback, stores certificates, answers is_clean.", "contract/ → nixo.testnet"],
            ["Lists", "OFAC, EU, UK, UN, SECO sanctions + known hackers, compiled into the WASM.", "checker/lists/"],
            ["History", "NearBlocks v3 fetched inside the enclave, or labelled fixtures offline.", "checker/src/live.rs"],
            ["Desk + SDK", "Certify UI, /verify, view client, fail-closed gate.", "web/lib/nixo-sdk.ts"],
          ]}
        />
      </DocSection>

      <DocSection id="lifecycle">
        <SectionHeading
          eyebrow="Certificate lifecycle"
          title="Account in. Verdict out. Nothing else."
          copy="The website never uploads history. The user sends only their account id, and pays the TEE run with an attached deposit (unused NEAR is refunded by OutLayer)."
        />
        <Steps
          items={[
            { title: "Request", body: <><C>request_nixo()</C> with NEAR attached. The contract emits <C>nixo_requested</C> and asks OutLayer to run the pinned WASM (URL + SHA-256).</> },
            { title: "Execute in TDX", body: <>Inside the enclave the checker loads lists, fetches history for that account, screens it and traces up to six hops back.</> },
            { title: "Attest", body: <>OutLayer&apos;s attestation commits to the WASM, input and output hashes. Workers are registered via DCAP.</> },
            { title: "Resolve", body: <>The private callback <C>resolve_nixo</C> accepts the result only if it is for the requesting account, from an unrevoked checker, with a certifiable history source and a well-formed verdict. Otherwise it stores nothing and emits <C>nixo_failed</C>.</> },
            { title: "Read", body: <>Anyone calls <C>is_clean(account)</C> or <C>get_certificate(account)</C>. Verdict, reason, checker version, list snapshot, expiry. Never the path.</> },
          ]}
        />
        <CodeBlock label="near-cli-rs · request and read">{`near contract call-function as-transaction nixo.testnet request_nixo \\
  json-args '{}' prepaid-gas '300 Tgas' attached-deposit '0.05 NEAR' \\
  sign-as nixo-alice.testnet network-config testnet sign-with-keychain send

near contract call-function as-read-only nixo.testnet is_clean \\
  json-args '{"account":"nixo-alice.testnet"}' network-config testnet now`}</CodeBlock>
      </DocSection>

      <DocSection id="checker">
        <SectionHeading
          eyebrow="The checker"
          title="A small, pure core inside a thin shell."
          copy="The decision core, verdict() and trace::search(), is pure: no I/O, no allocation in the list rule, deterministic. The shell does parsing, list loading and history fetch, and fails closed on anything unexpected."
        />
        <SpecTable
          columns={["Mode", "Input", "Certifiable"]}
          rows={[
            ["Certified", "{ account, network? } only. History fetched inside the enclave.", "Yes"],
            ["Preview", "{ account, history } supplied by the caller. Marked caller_supplied.", "No. The contract refuses it."],
          ]}
        />
        <Bullets
          items={[
            <Fragment key="b1">Addresses are normalised to SHA-256 of the canonical string before comparison. A reason never carries the offending address.</Fragment>,
            <Fragment key="b2">Input JSON uses <C>deny_unknown_fields</C>; a malformed request is <C>malformed_input</C>, not a guess.</Fragment>,
            <Fragment key="b3">Toolchain is pinned (Rust 1.93.0, <C>wasm32-wasip2</C>) so anyone can rebuild and compare the SHA-256 with the pin.</Fragment>,
          ]}
        />
      </DocSection>

      <DocSection id="verdicts">
        <SectionHeading
          eyebrow="Verdicts and reasons"
          title="Clean, Warn or Rejected. Only Clean passes."
          copy="Warn is stored so the user can see why, but is_clean stays false. The contract also rejects any result where a Clean verdict carries a reason, or a non-Clean verdict has none."
        />
        <SpecTable
          columns={["Reason code", "Meaning", "Verdict"]}
          rows={[
            ["list_hit", "A traced address is on a banned list.", "Rejected"],
            ["taint_path", "A listed address reaches the account through transfers or pool hops within the hop limit.", "Rejected (Warn if the only evidence is a weak pool link)"],
            ["history_incomplete", "Part of the history needed within the hop limit could not be listed (cap, rate limit, failed page).", "Rejected"],
            ["history_unavailable", "No history could be loaded for the account.", "Rejected"],
            ["list_unavailable", "A banned list is empty or failed to load.", "Rejected"],
            ["malformed_input", "The input could not be parsed.", "Rejected"],
          ]}
        />
      </DocSection>

      <DocSection id="trace">
        <SectionHeading
          eyebrow="Multi-hop trace"
          title="Walk backwards in time, six hops at most."
          copy="The search starts at the subject and follows only links that happened strictly before the link it arrived through. Funds only flow forward in time. It stops at the hop limit or the first listed node."
        />
        <SpecTable
          columns={["Rule", "Value"]}
          rows={[
            ["MAX_HOPS", "6"],
            ["Pool hop window", "Swap out must follow swap in within 120 s"],
            ["Pool hop tolerance", "Amounts match within ±15% of the swap in"],
            ["Weak link", "A pool link whose amounts differ by more than 12% (edge of tolerance)"],
            ["Pools followed", "Ref Finance (v2.ref-finance.near / ref-finance.testnet) via wNEAR"],
            ["Dust ignored", "Transfers below 0.001 NEAR"],
            ["Live fetch caps", "50 receipts per page, 6 pages, 48 API calls per run"],
            ["Terminals", "Documented faucets and helper accounts are list-checked but never expanded"],
          ]}
        />
        <Prose>
          <p>Outcome precedence is fail-closed:</p>
        </Prose>
        <Steps
          items={[
            { title: "Strong taint", body: "A path to a listed node using only strong links → Rejected (taint_path)." },
            { title: "Incomplete", body: "Any node that had to be expanded was not fully listed → Rejected (history_incomplete)." },
            { title: "Weak taint", body: "Only paths that use a weak pool link → Warn." },
            { title: "Otherwise", body: "Clean." },
          ]}
        />
      </DocSection>

      <DocSection id="lists">
        <SectionHeading
          eyebrow="Lists"
          title="Dated, hashed, compiled in."
          copy="The lists are part of the WASM, so the pinned hash covers them. Every certificate carries list_snapshot and list_hash."
        />
        <SpecTable
          columns={["List", "Source"]}
          rows={[
            ["us-ofac", "US OFAC SDN crypto addresses"],
            ["eu", "EU consolidated sanctions"],
            ["uk", "UK HM Treasury"],
            ["un", "UN Security Council"],
            ["ch-seco", "Swiss SECO"],
            ["hackers", "One known-hacker wallet. Unofficial public attribution (AMLBot / Shridlock)."],
          ]}
        />
        <Prose>
          <p>
            Snapshot <C>data-2026-10-29</C> from the Safe Foundation sanctions-address-lists extraction, list hash{" "}
            <C>dd83cfea…ce10</C>. An empty or unloadable list fails closed as <C>list_unavailable</C>.
          </p>
        </Prose>
      </DocSection>

      <DocSection id="history">
        <SectionHeading
          eyebrow="History sources"
          title="Where the trail comes from decides whether it can be certified."
          copy="The certificate records history_source. resolve_nixo only accepts sources the enclave produced itself."
        />
        <SpecTable
          columns={["history_source", "Produced by", "Certifiable"]}
          rows={[
            ["nearblocks-v3:<net>@h=<height>", "Live fetch inside the enclave, pinned to a block height. Default in 0.3.0.", "Yes"],
            ["fixture", "Compiled Alice / Mallory histories, only when NIXO_OFFLINE=1 (local, CI, demo).", "Yes, labelled"],
            ["nearblocks-v3:…unavailable", "Live fetch failed.", "No"],
            ["caller_supplied", "Preview mode: the caller passed history in.", "No"],
          ]}
        />
        <Prose>
          <p>
            The NearBlocks API key is an OutLayer author secret bound to the WASM hash and project, so it never appears
            in the repo or the transaction.
          </p>
        </Prose>
      </DocSection>

      <DocSection id="certificate">
        <SectionHeading eyebrow="Certificate fields" title="Everything an integrator needs. Nothing about the path." />
        <SpecTable
          columns={["Field", "Meaning"]}
          rows={[
            ["account", "The certified NEAR account."],
            ["verdict", "clean | warn | rejected."],
            ["reason", "Reason code, null when clean."],
            ["checker_hash / checker_version", "Which pinned WASM produced the verdict."],
            ["list_snapshot / list_hash", "Which list set was used."],
            ["trace_depth", "Hop limit the checker ran with."],
            ["history_source", "Where the history came from (see above)."],
            ["input_hash", "Hash of the enclave input, matches the attestation."],
            ["issued_at_ns / expires_at_ns", "Validity window. TTL is 7 days."],
          ]}
        />
        <CodeBlock label="get_certificate · nixo-alice.testnet (live)">{`{
  "certificate": {
    "account": "nixo-alice.testnet",
    "verdict": "clean",
    "reason": null,
    "checker_hash": "e0c79a99…11bed6",
    "checker_version": "0.1.0",
    "list_snapshot": "data-2026-10-29",
    "list_hash": "dd83cfea…8ce10",
    "trace_depth": 1,
    "history_source": "fixture",
    "input_hash": "6100242e…eee128",
    "issued_at_ns": "1794548869383495950",
    "expires_at_ns": "1795153669383495950"
  },
  "valid": true
}`}</CodeBlock>
      </DocSection>

      <DocSection id="governance">
        <SectionHeading
          eyebrow="Hash pinning and revocation"
          title="Changing the checker is public and slow. Killing it is instant."
          copy="The contract only accepts results from the pinned WASM hash. A new hash goes through a public timelock; a bad one can be revoked immediately, which invalidates every certificate it issued."
        />
        <SpecTable
          columns={["Method", "Who", "Effect"]}
          rows={[
            ["set_checker_hash(checker)", "Owner", "Proposes a new hash + https URL. Emits checker_proposed with activates_at_ns."],
            ["apply_checker_hash()", "Anyone", "Activates the pending checker once the timelock has passed."],
            ["cancel_checker_hash()", "Owner", "Drops the pending proposal."],
            ["revoke_checker_hash(hash)", "Owner", "Revokes a version. is_clean turns false for all its certificates at once."],
          ]}
        />
      </DocSection>

      <DocSection id="kani">
        <SectionHeading
          eyebrow="Formal verification"
          title="More than a TEE badge."
          copy="A TEE proves the code was not tampered with. Kani proves the decision core is correct on bounded inputs. CI fails on regression."
        />
        <SpecTable
          columns={["Harness", "Property"]}
          rows={[
            ["tainted_is_never_clean", "If any traced address is banned, the verdict is never Clean."],
            ["empty_list_is_never_clean", "An empty banned list never yields Clean (fail closed)."],
            ["disjoint_is_clean", "Disjoint inputs with a non-empty list are Clean (no false rejections from the core rule)."],
            ["tainted_is_never_clean_addr", "Soundness on the production 32-byte address type."],
            ["path_respects_hop_limit_and_is_a_real_chain", "Any returned path is ≤ max_hops, connected, starts at a listed node, ends at the subject, strictly time-ordered."],
            ["listed_subject_is_never_clean", "A listed subject is always rejected."],
            ["reachable_seed_within_limit_is_never_clean", "A listed node reaching the subject through a time-ordered chain is never Clean."],
            ["raising_hop_limit_never_cleans", "Raising the limit never turns a non-Clean result into Clean."],
          ]}
        />
        <CodeBlock label="reproduce">{`cargo install --locked kani-verifier && cargo kani setup
cd checker && cargo kani

# rebuild and compare against the on-chain pin
cargo build --release --locked --target wasm32-wasip2
shasum -a 256 target/wasm32-wasip2/release/nixo_checker.wasm
printf '{"account":"nixo-alice.testnet"}' | wasmtime run target/wasm32-wasip2/release/nixo_checker.wasm`}</CodeBlock>
        <Prose>
          <p>Proofs cover algorithm logic. They do not cover list completeness, indexer correctness or attribution of listed wallets.</p>
        </Prose>
      </DocSection>

      <DocSection id="visibility">
        <SectionHeading eyebrow="What is hidden from whom" title="Each party sees the minimum it needs." />
        <SpecTable
          columns={["Party", "Sees", "Does not see"]}
          rows={[
            ["Exchange / vault / solver", "Verdict, reason, list version, expiry, checker hash", "Balances, counterparties, amounts, hop path"],
            ["OutLayer operator", "That a job ran, duration, hashes", "Input / output contents (with session encryption)"],
            ["Public chain", "Compact certificate fields", "The history behind the verdict"],
            ["NIXO operators", "Nothing stored at runtime", "User history or the pre-chain verdict"],
          ]}
        />
      </DocSection>

      <DocSection id="preview">
        <SectionHeading
          eyebrow="Check any wallet"
          title="Trace any mainnet account. Certify none of them."
          copy="On /verify, Check any NEAR wallet fetches a mainnet money trail (cached fixtures first, then NearBlocks live, ~15 calls max) and runs the same checker source as a wasm32-wasip1 build on the server (Node WASI)."
        />
        <Bullets
          items={[
            <Fragment key="b4">Shows hop paths, because this is your own preview, not a certificate.</Fragment>,
            <Fragment key="b5">Result is <C>caller_supplied</C> and uses a different WASI build hash. <C>nixo.testnet</C> refuses to certify it.</Fragment>,
            <Fragment key="b6">Try <C>farstreet4572.near</C>: a real trail to a Binance-hack wallet within six hops. Mallory&apos;s fixture replays this trail on testnet.</Fragment>,
            <Fragment key="b7">Testnet accounts are rejected here on purpose. They are checked through their on-chain certificate instead.</Fragment>,
          ]}
        />
        <NextLinks
          links={[
            { href: "/docs/vault", label: "Vault and agents" },
            { href: "/docs/solver", label: "Solver gate" },
            { href: "/docs/developers#nixo-methods", label: "Contract reference" },
          ]}
        />
      </DocSection>
    </DocsShell>
  );
}
