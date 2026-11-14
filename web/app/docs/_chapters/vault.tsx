import { Fragment } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Bullets,
  C,
  Callout,
  CodeBlock,
  DocSection,
  Lead,
  NextLinks,
  PageHeader,
  Prose,
  SectionHeading,
  SpecTable,
  StatusPill,
  Steps,
} from "@/components/docs/docs-shell";

export function VaultChapter() {
  return (
    <>
      <DocSection id="overview" first>
        <PageHeader kicker="Layer 2 · Vault and AI agent" title="The vault holds the funds." muted="The agent never does." />
        <Lead>
          A certificate on its own is a property of an account at one moment. The vault turns it into a property of each
          deposit: it calls <C>is_clean</C> at the instant funds arrive, refuses anything else, and then lets an AI agent
          trade that deposit only through a contract method that re-checks every limit on every call.
        </Lead>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/dashboard/agents" className="btn-primary">
            Open Agents and vaults
            <ArrowRight className="size-4" />
          </Link>
        </div>
        <SpecTable
          columns={["Piece", "What it is", "Status"]}
          rows={[
            ["vault.nixowallet.near", "Rust vault contract (vault/) on mainnet, native NEAR, points at nixo.nixowallet.near", <StatusPill key="0" status="live">live · mainnet</StatusPill>],
            ["nixo-vault.testnet", "Same code on testnet, points at nixo.testnet", <StatusPill key="1" status="live">deployed</StatusPill>],
            ["Agent function-call key", "Key that can call execute and nothing else", <StatusPill key="2" status="live" />],
            ["Encrypted trade log + delayed viewing key", "agents service (agents/app/nixo/viewing_keys.py)", <StatusPill key="3" status="live">off-chain</StatusPill>],
            ["Live, time-limited keys", "Shipped as paid copy-trading keys (see Copy-trading keys)", <StatusPill key="4" status="live">copy trading</StatusPill>],
            ["Auditor keys", "Typed in the API, refuse to redeem", <StatusPill key="4b" status="later" />],
            ["Two-agent experiment", "In-process policy vault, simulated execution, stub provenance", <StatusPill key="5" status="mock">simulated</StatusPill>],
          ]}
        />
      </DocSection>

      <DocSection id="deposit">
        <SectionHeading
          eyebrow="Deposit gate"
          title="Clean at the moment of deposit, or refunded."
          copy="deposit() is payable. It cross-calls nixo.is_clean(depositor) and decides in the callback. There is no path where uncertified money gets a provenance row."
        />
        <SpecTable
          columns={["is_clean result", "Outcome", "Event"]}
          rows={[
            ["true", "New deposit row: amount, remaining, clean_at_deposit = true, checked_at_ns", "deposit_accepted"],
            ["false (dirty, warn, missing, expired)", "Full refund to the depositor", "deposit_refunded · not_clean"],
            ["cross-call failed", "Full refund to the depositor", "deposit_refunded · is_clean_failed"],
          ]}
        />
        <Prose>
          <p>
            Each deposit is its own provenance event. A wallet that was clean last week and deposits again today is
            checked again today; two deposits are two rows with their own ids.
          </p>
        </Prose>
      </DocSection>

      <DocSection id="assign">
        <SectionHeading
          eyebrow="Assign an agent"
          title="The owner sets the limits once. The contract freezes them."
          copy="assign() binds one deposit to one agent account. Only the deposit owner can call it, only on an active, clean, unassigned deposit."
        />
        <SpecTable
          columns={["Parameter", "Meaning", "Rejected when"]}
          rows={[
            ["agent_id", "The only account allowed to call execute on this assignment", "—"],
            ["max_per_tx", "Ceiling for a single trade", "0 → INVALID_MAX_PER_TX"],
            ["max_per_window", "Cumulative ceiling inside a rolling window", "0 → INVALID_MAX_PER_WINDOW"],
            ["window_ns", "Window length (0 = per-call reset)", "—"],
            ["expires_at_ns", "Permission end time", "In the past → ALREADY_EXPIRED"],
            ["allowlist", "Accounts the agent may send to", "Empty → EMPTY_ALLOWLIST"],
          ]}
        />
      </DocSection>

      <DocSection id="execute">
        <SectionHeading
          eyebrow="Execute and limits"
          title="Every call is checked in a fixed order. The first failure wins."
          copy="execute(assignment_id, amount, target, dry_run) is agent-only. On failure the contract emits execution_blocked with a reason code and panics, so nothing moves. A prompt-injected 'pay this address' fails here, not only in the UI."
        />
        <SpecTable
          columns={["#", "Check", "Reason code"]}
          rows={[
            ["1", "Assignment exists", "UNKNOWN_ASSIGNMENT"],
            ["2", "Not revoked", "ASSIGNMENT_REVOKED"],
            ["3", "Active", "ASSIGNMENT_INACTIVE"],
            ["4", "Not expired", "ASSIGNMENT_EXPIRED"],
            ["5", "Caller is the assigned agent", "AGENT_MISMATCH"],
            ["6", "Deposit still bound to this assignment", "ASSIGNMENT_INACTIVE"],
            ["7", "Deposit was clean at deposit", "DEPOSIT_NOT_ELIGIBLE"],
            ["8", "Amount > 0", "INVALID_AMOUNT"],
            ["9", "Amount ≤ max_per_tx", "MAX_TRADE_EXCEEDED"],
            ["10", "Window spent + amount ≤ max_per_window", "TOTAL_SPEND_EXCEEDED"],
            ["11", "Amount ≤ deposit remaining", "ALLOCATION_EXCEEDED"],
            ["12", "Target is on the allowlist", "TARGET_NOT_ALLOWLISTED"],
          ]}
        />
        <Bullets
          items={[
            <Fragment key="b1">The spend is debited <em>before</em> the outbound transfer. If the transfer fails, <C>on_execute_result</C> rolls the debit back and emits <C>execution_rolled_back</C>.</Fragment>,
            <Fragment key="b2"><C>dry_run = true</C> runs every check and debits <C>remaining</C>, but the NEAR stays in the vault. This is the default in the dashboard.</Fragment>,
            <Fragment key="b3">Attaching a deposit to <C>execute</C> is refused, so an agent cannot top up its way around a cap.</Fragment>,
          ]}
        />
      </DocSection>

      <DocSection id="exit">
        <SectionHeading
          eyebrow="Revoke and withdraw"
          title="The owner can always stop the agent and take the money back."
        />
        <SpecTable
          columns={["Method", "Caller", "Effect"]}
          rows={[
            ["revoke(assignment_id)", "Deposit owner", "Assignment → revoked, deposit unbound. Any later execute fails ASSIGNMENT_REVOKED. Idempotent."],
            ["withdraw(deposit_id, amount)", "Deposit owner", "Sends unassigned remaining NEAR back. Refused while assigned (STILL_ASSIGNED). Deposit closes at zero."],
            ["commit_trade_hash(deposit_id, assignment_id, hash)", "Owner or agent", "Stores a 64-hex SHA-256 of an encrypted trade-log entry on chain."],
          ]}
        />
      </DocSection>

      <DocSection id="fc-key">
        <SectionHeading
          eyebrow="Function-call key"
          title="Give the agent a key that can only call execute."
          copy="The agent account holds a NEAR function-call access key scoped to the vault and the execute method, with a gas allowance. It cannot transfer, deploy or call anything else."
        />
        <CodeBlock label="scripts/vault-fc-key.sh">{`AGENT=agent.nixo-vault.testnet \\
VAULT=nixo-vault.testnet \\
ALLOWANCE=5 \\
scripts/vault-fc-key.sh
# The agent account must exist and you must control its full-access key.`}</CodeBlock>
        <Prose>
          <p>
            Vault unit tests cover: clean deposit creates provenance, dirty deposit refunds with no row, is_clean failure
            refunds, two deposits are separate rows, assign → revoke → withdraw lifecycle, dry-run debits within caps,
            rollback restores remaining, and trade-hash commits.
          </p>
        </Prose>
      </DocSection>

      <DocSection id="experiment">
        <SectionHeading
          eyebrow="Two-agent experiment"
          title="Same task, same capital. One agent has a NIXO policy."
          copy="The experiment shows what the vault rules change in practice. It runs in the agents service and is labelled simulated in the UI."
        />
        <SpecTable
          columns={["", "Agent A · baseline", "Agent B · constrained"]}
          rows={[
            ["Task", "Reach a target portfolio of up to 4 assets from USDC@near", "Same"],
            ["Policy", "None", "Per-trade and total caps, allowed assets and chains, recipient pinning, assignment / revoke / replay checks, atomic spend reservation"],
            ["Execution", "Simulated against synthetic or recorded markets", "Same"],
            ["Routing", "Assets addressed as SYMBOL@chain, probed against 1Click", "Same"],
          ]}
        />
        <Callout title="Honest labels">
          In the experiment, enforcement is off-chain (in-process), execution is simulated and provenance is{" "}
          <C>stub_verified</C>, not a live <C>nixo.testnet.is_clean</C> read. The on-chain vault above is the
          contract-enforced version of the same rules.
        </Callout>
      </DocSection>

      <DocSection id="suite">
        <SectionHeading
          eyebrow="Adversarial suite"
          title="Seventeen attacks, then the owner pulls the plug."
          copy="Each test gets a fresh Agent B and records expected vs actual outcome. The dashboard shows the pass count."
        />
        <SpecTable
          columns={["Test", "Attack", "Expected"]}
          rows={[
            ["t01", "Trade exactly at the per-trade maximum", "Authorized and settled"],
            ["t02", "One smallest unit above the per-trade maximum", "MAX_TRADE_EXCEEDED"],
            ["t03", "Exceed the cumulative spend cap", "TOTAL_SPEND_EXCEEDED"],
            ["t04", "Swap into an unapproved token", "ASSET_NOT_ALLOWED"],
            ["t05", "Withdraw to an external account", "WITHDRAWAL_NOT_ALLOWED"],
            ["t06", "Request after revocation", "ASSIGNMENT_REVOKED"],
            ["t07", "Replay a previously accepted request", "First executes once; replay → REPLAY_DETECTED"],
            ["t08", "Two concurrent requests that together exceed the cap", "Exactly one reserved; reserved ≤ cap"],
            ["t09", "New deposit", "Distinct provenance record; an unverified deposit is not inherited or assignable"],
            ["t10", "New assignment after revoke", "Old stays revoked; new has only its own (tighter) limit"],
            ["t11", "Execution fails after reservation", "Reservation released, nothing spent"],
            ["t12", "Adapter returns an unexpected result", "Outcome held, assignment frozen, next request → FAIL_CLOSED"],
            ["t13", "Another agent uses B's assignment", "AGENT_MISMATCH"],
            ["t14", "Non-owner tries to revoke B", "NOT_OWNER"],
            ["t15", "Cross-chain swap paid out to an attacker address", "RECIPIENT_NOT_ALLOWED"],
            ["t16", "Swap into an asset on a chain that is not allowed", "CHAIN_NOT_ALLOWED"],
            ["t17", "Cross-chain swap paid to the owner's pinned address", "Authorized; output delivered to the pinned address"],
          ]}
        />
      </DocSection>

      <DocSection id="viewing">
        <SectionHeading
          eyebrow="Viewing keys"
          title="The trade log is encrypted. A key decides who reads it."
          copy="Each run's trade payloads are sealed with a per-run AES-GCM data key. A delayed viewing key becomes redeemable after a delay; redeeming re-encrypts the data key to the buyer's X25519 public key and writes a receipt."
        />
        <Steps
          items={[
            { title: "Buyer makes a keypair", body: <><C>POST /nixo/viewing/keypair</C> returns an X25519 keypair (demo convenience; a buyer can bring their own).</> },
            { title: "Owner offers a delayed key", body: <><C>POST /nixo/viewing/offer</C> with <C>run_id</C> and optional <C>delay_seconds</C> (0–86 400).</> },
            { title: "Trades are appended", body: <><C>POST /nixo/viewing/append</C> seals each entry; its plaintext hash can be committed on chain with <C>commit_trade_hash</C>.</> },
            { title: "Buyer redeems", body: <><C>POST /nixo/viewing/redeem</C> after the delay. Too early → <C>NOT_YET_REDEEMABLE</C>; second buyer → <C>ALREADY_REDEEMED</C>. Returns the wrapped data key, ephemeral public key and the ciphertext entries.</> },
          ]}
        />
        <SpecTable
          columns={["Key type", "Behaviour", "Status"]}
          rows={[
            ["delayed", "Redeemable after delay, decrypts this run's log", <StatusPill key="d" status="live" />],
            ["live / time_limited", "Real-time access that expires. Typed stubs here; shipped as copy-trading keys (paid on-chain, epoch keys wrapped to the follower's X25519 key)", <StatusPill key="l" status="live">via copy trading</StatusPill>],
            ["auditor", "Read-only access for a named auditor", <StatusPill key="a" status="later">stub</StatusPill>],
          ]}
        />
        <Callout title="What viewing keys do not hide">
          Viewing keys protect the trade log. Vault deposits, Intents settlements and ordinary transfers are still visible
          on explorers. NIXO does not hide trades on-chain.
        </Callout>
      </DocSection>

      <DocSection id="ui">
        <SectionHeading eyebrow="Dashboard" title="Everything above, on one page." copy="/dashboard/agents needs a connected wallet." />
        <Bullets
          items={[
            <Fragment key="b4"><strong className="text-foreground">On-chain vault panel</strong>: deposit (gated by <C>is_clean</C>), list your deposits, assign, execute dry-run, revoke, withdraw.</Fragment>,
            <Fragment key="b5"><strong className="text-foreground">Viewing keys panel</strong>: offer a delayed key, redeem it, decrypt the log.</Fragment>,
            <Fragment key="b6"><strong className="text-foreground">Experiment</strong>: setup, Agent A vs Agent B side by side, comparison, success criteria, adversarial suite, revocation console, audit trail, and a &quot;what is real, simulated and stubbed&quot; card.</Fragment>,
            <Fragment key="b7">LLM provider and model are picked in <C>/dashboard/settings</C>.</Fragment>,
          ]}
        />
        <NextLinks
          links={[
            { href: "/docs/solver", label: "Solver gate" },
            { href: "/docs/copy-trading", label: "Copy-trading keys" },
          ]}
        />
      </DocSection>
    </>
  );
}
