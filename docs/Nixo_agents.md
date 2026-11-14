# NIXO AI Agents --- Implementation Plan

## MVP v0.1: Verified Capital & Agent Authorization

**Status:** Implemented as an **off-chain** agents path (`agents/app/nixo/`, UI
`/dashboard/agents`). Provenance is a labelled stub; enforcement is not yet a
NEAR contract.\
**Product home:** this agents path is **Layer 2** of the agreed product in
[`NIXO_PRD.md`](../NIXO_PRD.md). On product language, privacy claims, and
hackathon cut order, the PRD wins.\
**Scope:** Two-agent controlled comparison\
**Primary objective:** Demonstrate that an AI agent can complete a
useful financial task while operating under enforceable capital
permissions.

------------------------------------------------------------------------

## 1. Executive Summary

NIXO's full product is a clean-funds passport plus a gated trading layer
(tracer → vault → solver). This document specifies only the **Layer 2
agents path**: capital assigned to an AI agent with a provenance record and
permissions enforced at the transaction boundary — today in-process, target
on-chain and gated by `nixo.testnet.is_clean` per the PRD.

The core idea is not simply to give an AI agent a wallet. It is to let
an owner allocate capital to an agent with a minimal provenance record
and explicit permissions that are enforced at the transaction boundary.

The first MVP should prove one narrow claim:

> A constrained AI agent can complete the same task as an unrestricted
> agent, using equivalent starting capital and the same execution
> environment, while respecting enforceable financial limits.

The MVP is a controlled comparison, not yet a production financial infrastructure
network. Viewing keys, encrypted trade logs, and the mock solver are PRD
items outside this agents code path unless explicitly added later.

### What we are building

-   Two agents performing the same task.
-   Equivalent, isolated starting capital for each agent.
-   One unrestricted agent as the baseline.
-   One constrained agent whose permissions are checked by the
    vault/authorization boundary (off-chain now; contract later).
-   A minimal per-deposit provenance record (stub verification status today).
-   A spending limit and an owner-controlled revoke path.
-   An audit trail that makes both agents' actions comparable.
-   Adversarial tests that attempt to bypass the constrained agent's
    permissions.

### Explicitly out of scope *for this agents doc*

(These may still be in scope for the overall product — see the PRD.)

-   Building or operating a NEAR Intents solver (PRD Layer 3).
-   Integrating a solver network.
-   Building the full clean-funds certificate system (PRD Layer 1; already
    partly shipped as `nixo.testnet` + checker).
-   Production-grade sanctions screening or live enclave history fetch.
-   On-chain vault + `is_clean` deposit gate (PRD Layer 2 target; not this
    off-chain MVP).
-   Encrypted trade log / viewing-key marketplace.
-   Agent marketplaces or multi-agent orchestration.
-   Leverage, derivatives, or complex portfolio management.
-   Claims that the MVP proves profitability or complete financial
    provenance.

------------------------------------------------------------------------

## 2. Product Thesis

AI agents need more than wallet access. They need access to capital
with:

1.  **Provenance:** a record of where the allocated funds came from.
2.  **Authorization:** explicit rules defining what an agent may do.
3.  **Enforcement:** rules checked outside the agent's prompt, at the
    transaction boundary.
4.  **Revocation:** an owner-controlled way to stop future actions.
5.  **Auditability:** records showing what the agent attempted and what
    actually happened.

NIXO's role is to connect those properties to agent execution, after Layer 1
has produced a clean-funds certificate the vault can trust.

This comparison tests whether constrained agents are useful in practice. The
broader protocol (live enclave history, on-chain vault gate, viewing keys,
mock solver) is specified in the PRD, not here.

------------------------------------------------------------------------

## 3. Comparison Design

### 3.1 The two-agent comparison

  -----------------------------------------------------------------------
  Dimension               Agent A: Baseline       Agent B: Constrained
  ----------------------- ----------------------- -----------------------
  Task                    Same task               Same task

  Starting capital        Equivalent allocation   Equivalent allocation

  Market/execution        Same                    Same
  environment                                     

  Agent objective         Same                    Same

  Permission checks       No NIXO policy          Enforced by NIXO
                          restrictions            authorization boundary

  Spending limit          No NIXO spending cap    Explicit maximum

  Revocation              No NIXO revoke control  Owner can revoke

  Audit                   Record actions and      Record actions, policy
                          outcomes                decisions and outcomes
  -----------------------------------------------------------------------

Use separate but equivalent allocations. Do not let both agents spend
from one shared balance: one agent's actions must not change the other's
available capital.

For a deterministic demo, both agents should receive the same initial
conditions and task. If they run sequentially, use a recorded or
controlled market snapshot where possible. If they run live, record
timestamps and acknowledge that market conditions may differ.

### 3.2 What the comparison should demonstrate

The constrained agent should:

-   Complete the permitted task.
-   Stay within its allocation and spending limit.
-   Use only permitted assets and actions.
-   Be blocked when it attempts a prohibited action.
-   Stop being able to transact after revocation.

The comparison should also deliberately attempt policy violations. A
blocked attempt is evidence that the enforcement boundary works; it is
not a successful violation.

### 3.3 Success criteria

The MVP succeeds if:

1.  Both agents can receive and execute the same permitted task.
2.  The constrained agent can complete the task without violating
    policy.
3.  An over-limit transaction is rejected by the enforcement layer.
4.  An unauthorized asset or action is rejected, if that rule is enabled
    in the demo.
5.  A revoked agent cannot execute another transaction.
6.  The audit trail clearly distinguishes proposed, rejected,
    authorized, submitted and settled actions.

Profitability is not the primary success metric.

------------------------------------------------------------------------

## 4. System Architecture

### 4.1 Minimal component diagram

``` text
                         OWNER
                           |
              +------------+------------+
              |                         |
        Equivalent capital        Equivalent capital
          allocation A              allocation B
              |                         |
        +-----------+             +-----------+
        | Agent A   |             | Agent B   |
        | Baseline  |             | Constrained|
        +-----------+             +-----------+
              |                         |
        Execution adapter        NIXO authorization
              |                    boundary / vault
              |                         |
              |                  Policy checks:
              |                  - active assignment
              |                  - not revoked
              |                  - allowed asset/action
              |                  - per-trade limit
              |                  - remaining allocation
              |                         |
              +------------+------------+
                           |
                  Shared execution adapter
                           |
                 Paper / simulated venue
                           |
                    Execution results

       Provenance records and audit events are stored
       for both agents and the run.
```

The diagram describes the MVP boundary. The execution adapter can be
paper/simulated initially. A production deployment must use an execution
path whose settlement and asset custody are actually controlled by the
enforcement contract or an equally strong mechanism.

### 4.2 Components

#### A. Agent runner

Runs the agent's decision logic and produces transaction proposals.

Responsibilities:

-   Receive the task and market/context data.
-   Produce a proposed action.
-   Submit the proposal to the execution interface.
-   Display the result returned by the execution layer.

The agent runner is not trusted to enforce its own permissions.

#### B. Provenance registry

Stores the minimal provenance information associated with each
deposit/allocation.

For v0.1 this is a demonstrator record, not a complete AML or
clean-funds certification system.

#### C. Vault / authorization contract

The security boundary for the constrained agent.

Responsibilities:

-   Track the agent's allocation.
-   Store the permission policy.
-   Check each requested action.
-   Reject actions that violate policy.
-   Track spending or reserved amounts.
-   Support owner-controlled revocation.
-   Emit auditable events.

#### D. Execution adapter

Receives approved actions and executes them in the chosen
paper/simulated environment.

It must not provide a bypass around the authorization contract for Agent
B.

#### E. Audit service

Collects structured events from the agents, authorization layer and
execution adapter. It should make the comparison reproducible.

------------------------------------------------------------------------

## 5. Minimal Data Model

The following is a suggested v0.1 schema. Field names can be adapted to
the implementation language.

### 5.1 Deposit provenance record

``` json
{
  "deposit_id": "dep_001",
  "owner": "owner_account",
  "asset": "USDC",
  "amount": "1000",
  "source_reference": "source_tx_or_demo_reference",
  "deposited_at": 0,
  "verification_status": "stub_verified",
  "verification_method": "demo_stub",
  "record_version": 1
}
```

Rules:

-   Each deposit receives a unique `deposit_id`.
-   Provenance belongs to that deposit, not permanently to the owner or
    vault.
-   A new deposit gets a new provenance record.
-   A deposit must not inherit another deposit's verification status.
-   `stub_verified` must be visibly labelled as a stub in the UI and
    demo.
-   Do not represent the stub as real-world source-of-funds
    verification.

### 5.2 Agent assignment

``` json
{
  "assignment_id": "asg_001",
  "agent_id": "agent_b",
  "deposit_id": "dep_001",
  "allocated_amount": "1000",
  "asset": "USDC",
  "status": "active",
  "assigned_at": 0,
  "revoked_at": null
}
```

For the run, create separate deposit/allocation records for each
agent, with equivalent amounts and conditions.

### 5.3 Permission policy

``` json
{
  "policy_id": "policy_agent_b_v1",
  "agent_id": "agent_b",
  "allowed_actions": ["swap"],
  "allowed_assets": ["USDC", "NEAR"],
  "max_trade_amount": "200",
  "max_total_spend": "1000",
  "withdrawals_allowed": false,
  "enabled": true
}
```

Only include rules that the contract or execution boundary actually
enforces. A policy displayed in the UI but not checked by the
enforcement layer must not be presented as a security control.

------------------------------------------------------------------------

## 6. Contract Interface

Keep the initial interface small. The core operations are deposit,
assign, trade and revoke.

The exact method signatures depend on the target chain and token
standard. The following is a conceptual interface, not compiled contract
code.

### 6.1 `deposit`

Records or receives a deposit and creates a deposit-specific provenance
record.

Inputs:

-   Asset and amount.
-   Source reference.
-   Verification status or verification result from the selected v0.1
    stub.

Checks:

-   Amount is valid and greater than zero.
-   Deposit ID is unique.
-   Provenance status is explicit.
-   A failed or unknown verification state cannot silently become
    verified.

Emits:

-   `DepositRecorded`

### 6.2 `assign`

Allocates a deposit's capital to an agent and attaches a policy.

Inputs:

-   Deposit ID.
-   Agent ID.
-   Allocation amount.
-   Permission policy.

Checks:

-   Caller is the owner or authorized controller.
-   Deposit exists and is eligible under the MVP's stated rules.
-   Allocation does not exceed the deposit's unallocated balance.
-   Assignment starts active and has its own identity.
-   No trust or permission state is inherited from a different
    assignment.

Emits:

-   `AgentAssigned`

### 6.3 `trade`

Requests an action through the authorized execution path.

Inputs:

-   Assignment ID.
-   Action type.
-   Input asset and amount.
-   Output asset or requested outcome.
-   Execution parameters required by the adapter.

Hard checks for Agent B:

1.  Assignment exists.
2.  Assignment is active.
3.  Assignment has not been revoked.
4.  Agent identity matches the assignment.
5.  Action is allowed by policy.
6.  Assets are allowed by policy.
7.  Trade amount does not exceed the per-trade limit.
8.  Cumulative spend plus the proposed spend does not exceed the
    allocation or total-spend limit.
9.  The action cannot withdraw funds if withdrawals are disabled.
10. The same request cannot be replayed to spend twice.

The contract or trusted enforcement boundary must perform these checks.
The agent's prompt, UI and backend must not be the only enforcement
points.

Emits:

-   `TradeAuthorized` or `TradeRejected`
-   `TradeSubmitted`
-   `TradeSettled` or `TradeFailed`, where the adapter can establish the
    outcome

### 6.4 `revoke`

Revokes an assignment.

Inputs:

-   Assignment ID.

Checks:

-   Caller is the owner or authorized controller.
-   Assignment exists.

Effects:

-   Assignment status becomes revoked.
-   Future trade requests for that assignment are rejected.
-   Revocation is irreversible for that assignment in v0.1. A new
    assignment is created if access is granted again.
-   Any already-submitted transaction must be tracked separately;
    revocation cannot necessarily undo a transaction already broadcast
    or settled.

Emits:

-   `AgentRevoked`

### 6.5 Critical accounting distinction

Do not count a proposed trade as completed spending.

Track at least:

-   `proposed_amount`
-   `reserved_amount`
-   `settled_spend`
-   `released_amount` for failed/cancelled reservations

Reserve funds or spending capacity before an asynchronous execution
step, then reconcile based on the actual settlement result. Otherwise,
concurrent requests could each pass a limit check against the same
remaining balance.

------------------------------------------------------------------------

## 7. Hard Rules and Threat Tests

The contract should enforce the following rules for the constrained
agent.

  Rule                        Required behavior
  --------------------------- -----------------------------------------------
  Assignment must exist       Reject unknown assignment
  Assignment must be active   Reject inactive assignment
  Revocation                  Reject all new actions after revoke
  Agent identity              Reject a different agent using the assignment
  Allowed action              Reject actions not in policy
  Allowed assets              Reject disallowed assets
  Per-trade cap               Reject trades above the maximum
  Total-spend cap             Reject actions exceeding remaining budget
  No withdrawals              Reject withdrawal requests
  Replay protection           Reject reused request IDs/nonces
  Concurrent spending         Reserve capacity atomically before execution
  Provenance isolation        Do not inherit another deposit's status

### Adversarial test cases

1.  Agent B requests a trade exactly at the maximum: it should pass if
    all other checks pass.
2.  Agent B requests a trade one smallest unit above the maximum: it
    should fail.
3.  Agent B requests a trade that would exceed the cumulative spend cap:
    it should fail.
4.  Agent B requests an unapproved asset: it should fail.
5.  Agent B requests a withdrawal: it should fail.
6.  Agent B submits a request after revocation: it should fail.
7.  Agent B replays a previously accepted request: it should not execute
    twice.
8.  Two requests arrive concurrently and together exceed the limit: only
    the amount within the limit may be reserved.
9.  A new deposit is created: it must receive a new provenance record.
10. A new assignment is created: it must not inherit the prior
    assignment's active status or permissions.
11. Execution fails after reservation: the reservation must be
    reconciled safely.
12. The authorization service or execution adapter returns an unexpected
    result: fail closed for new authorization.

For every test, record the request, expected result, actual result and
relevant contract/event reference.

------------------------------------------------------------------------

## 8. Execution Flow

### 8.1 Setup

1.  Owner creates or records two equivalent deposits.
2.  Each deposit gets its own provenance record.
3.  Agent A receives its baseline allocation.
4.  Agent B receives an equivalent allocation and a constrained policy.
5.  Both agents receive the same task and input data.

### 8.2 Permitted action

1.  Agent proposes a trade.
2.  Agent B submits its proposal to the authorization contract.
3.  Contract checks assignment, revocation state, policy and remaining
    capacity.
4.  If permitted, the request is authorized and capacity is reserved.
5.  Execution adapter submits the action to the paper/simulated venue.
6.  Adapter reports the result.
7.  Accounting reconciles the reservation.
8.  Audit events are recorded.

### 8.3 Prohibited action

1.  Agent B proposes an action outside its policy.
2.  The request reaches the authorization boundary.
3.  The contract rejects it.
4.  No execution request is sent to the venue.
5.  The rejection and reason code are recorded.

### 8.4 Revocation

1.  Owner calls `revoke(assignment_id)`.
2.  Contract marks the assignment revoked.
3.  Agent B attempts another trade.
4.  Contract rejects the request.
5.  The audit trail records the revocation and rejected post-revocation
    attempt.

------------------------------------------------------------------------

## 9. Same-Task Comparison Protocol

To make the demo credible, keep the comparison fair.

### Control the variables

-   Same task definition.
-   Same strategy objective.
-   Same model and model settings, where practical.
-   Same market data snapshot or recorded input stream.
-   Same asset pair and execution adapter.
-   Equivalent starting capital.
-   Same transaction fee assumptions.
-   Same run duration and stopping conditions.

The agents should have separate balances or isolated allocations. Do not
share a spendable balance.

### Record the outcomes

  -----------------------------------------------------------------------
  Metric                                Agent A                   Agent B
  ------------------- ------------------------- -------------------------
  Task completed                         Record                    Record

  Starting allocation                    Record                    Record

  Ending balance                         Record                    Record

  Permitted trades                       Record                    Record
  completed                                     

  Policy violations   Not policy-gated / record                    Record
  attempted                             actions 

  Policy violations       Record actual actions              Must be zero
  executed                                      

  Rejected requests     N/A or baseline control                    Record

  Revocation response         Baseline behavior    No new execution after
                                                                   revoke

  Execution failures                     Record                    Record
  -----------------------------------------------------------------------

Do not claim the constrained agent is safer based only on a successful
happy-path run. Show the adversarial attempts and the contract-level
rejection evidence.

------------------------------------------------------------------------

## 10. Audit Event Format

Use a common event schema so both agents can be compared.

``` json
{
  "event_id": "evt_001",
  "run_id": "run_001",
  "agent_id": "agent_b",
  "assignment_id": "asg_001",
  "deposit_id": "dep_001",
  "event_type": "trade_rejected",
  "request_id": "req_001",
  "action": "swap",
  "asset_in": "USDC",
  "amount_in": "250",
  "asset_out": "NEAR",
  "decision": "rejected",
  "reason_code": "MAX_TRADE_EXCEEDED",
  "timestamp": 0,
  "execution_reference": null
}
```

Suggested event types:

-   `deposit_recorded`
-   `agent_assigned`
-   `trade_proposed`
-   `trade_authorized`
-   `trade_rejected`
-   `trade_submitted`
-   `trade_settled`
-   `trade_failed`
-   `agent_revoked`
-   `post_revoke_attempt_rejected`

Use contract event IDs or transaction references wherever available. Do
not present backend-generated logs as on-chain proof.

------------------------------------------------------------------------

## 11. Implementation Order

### Milestone 1 --- Minimal provenance and capital records

-   Define deposit and assignment data structures.
-   Create a unique provenance record per deposit.
-   Label the verification mechanism as a stub.
-   Add tests proving that deposits do not inherit one another's status.

**Exit condition:** Two equivalent deposits can be recorded and
independently assigned.

### Milestone 2 --- Vault and permission enforcement

-   Implement `deposit`.
-   Implement `assign`.
-   Implement `trade` authorization checks.
-   Implement spending reservations/accounting.
-   Implement `revoke`.
-   Add contract-level unit tests for every hard rule.

**Exit condition:** Agent B cannot bypass the policy through the normal
execution interface.

### Milestone 3 --- Agent integration

-   Connect Agent A to the baseline execution path.
-   Connect Agent B to the authorization-gated execution path.
-   Ensure both use the same task and execution adapter.
-   Record structured proposals and outcomes.

**Exit condition:** Both agents can perform the same permitted task.

### Milestone 4 --- Adversarial comparison

-   Run over-limit attempts.
-   Run unauthorized-asset attempts.
-   Run withdrawal attempts.
-   Revoke Agent B and attempt another trade.
-   Test replay and concurrent-spend behavior.
-   Export the audit trail.

**Exit condition:** The constrained agent completes the task, prohibited
actions are rejected at the enforcement boundary, and the evidence is
reproducible.

### Milestone 5 --- Demo and documentation

-   Show both agents side by side.
-   Show starting capital and policies.
-   Show a successful permitted action.
-   Show rejected adversarial actions.
-   Revoke Agent B and demonstrate rejection of a later request.
-   Explain what is real, simulated and stubbed.

**Exit condition:** A reviewer can understand the comparison and verify
its important claims without relying on narration.

------------------------------------------------------------------------

## 12. Demo Script

1.  Show the two equivalent deposit/provenance records.
2.  Show Agent A's baseline access and Agent B's constrained policy.
3.  Give both agents the same task.
4.  Run the permitted task and show that Agent B completes it.
5.  Ask Agent B to exceed its per-trade limit.
6.  Show the contract rejecting the request before execution.
7.  Ask Agent B to use an unauthorized asset or withdraw funds.
8.  Show the rejection.
9.  Revoke Agent B.
10. Attempt another trade and show that it cannot execute.
11. Compare both audit trails.

### Suggested demo narration

"NIXO gives AI agents access to capital without giving them unrestricted
authority over it. Both agents receive equivalent capital and the same
task. One operates as the baseline. The other operates through an
authorization boundary that enforces its owner's rules. The constrained
agent still completes the task, but attempts to exceed its permissions
are rejected before execution. The owner can revoke access, and the
audit trail records what happened."

------------------------------------------------------------------------

## 13. Security and Honesty Requirements

-   Never rely on an AI prompt as a security boundary.
-   Never rely only on frontend or backend checks for Agent B.
-   The execution adapter must not expose an alternate path around
    authorization.
-   Prevent replay and concurrent-spend races.
-   Reconcile reservations after success, failure or cancellation.
-   Make revocation block new actions; clearly disclose that it cannot
    undo already-settled transactions.
-   Label simulated execution as simulated.
-   Label provenance verification as stubbed until real source data and
    verification are implemented.
-   Do not claim that a deposit is fully clean based on a demo flag.
-   Do not claim production readiness, audited custody or regulatory
    compliance.
-   Do not claim that Kani or unit tests prove the entire system secure.
    They prove only the properties and code paths actually covered.

------------------------------------------------------------------------

## 14. What Comes After v0.1

Only after the two-agent comparison works should NIXO expand.

Potential next steps:

1.  Replace the provenance stub with a real, clearly scoped verification
    pipeline.
2.  Connect real deposits and actual custody.
3.  Add production-grade policy and accounting controls.
4.  Integrate NEAR Intents as an execution venue.
5.  Compare execution quotes and outcomes across supported venues.
6.  Evaluate operating a NIXO solver only if there is a concrete
    liquidity or execution advantage.
7.  Release an SDK for external AI agents.
8.  Expand to additional chains and agent frameworks.

These are roadmap possibilities, not v0.1 deliverables.

------------------------------------------------------------------------

## 15. Final Scope Lock

**Build now:**

-   [ ] Two agents.
-   [ ] Same task and equivalent isolated starting capital.
-   [ ] Minimal deposit-specific provenance record.
-   [ ] Agent assignment.
-   [ ] Contract-enforced spending limit.
-   [ ] Contract-enforced action/asset restrictions, if included in the
    demo.
-   [ ] Owner-controlled revocation.
-   [ ] Shared execution adapter with no bypass for the constrained
    agent.
-   [ ] Structured audit trail.
-   [ ] Adversarial tests.
-   [ ] Side-by-side demo.

**Do not build yet:**

-   [ ] Solver network.
-   [ ] Own solver.
-   [ ] Full clean-funds certificate machinery.
-   [ ] Full AML screening.
-   [ ] Cross-chain infrastructure.
-   [ ] Agent marketplace.
-   [ ] Complex trading strategies.
-   [ ] Multi-agent orchestration.

## The v0.1 Definition of Done

NIXO v0.1 is done when two agents can perform the same permitted task
with equivalent isolated capital, while the constrained agent's
financial permissions are enforced at the execution boundary,
adversarial violations are rejected, and the owner can revoke future
access.

**The proof is not that the constrained agent makes more money. The
proof is that it remains useful without being given unrestricted control
of the user's capital.**
