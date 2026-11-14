# Swarma — Plan

> Track 05 · AI Swarms (`swarms`) · "Many agents, one economy"
> Status: ideation / pre-RULES.md. Nothing gets built until RULES.md and the round diagram are agreed.

---

## 1. The idea in one paragraph

**Swarma is a group-buying market for GPU hours.** Each buyer agent represents one user who wants a small amount of compute, for example 15 H100 hours this week at no more than $2.40/hr. Sellers only sell in large lots (100+ hours) and give volume pricing, so a single buyer can't get a good price, or can't buy at all. Buyer agents with compatible needs find each other, **pool their demand**, and run a **sealed-bid (commit–reveal) round** against seller agents. A coordinator contract clears the market at one **uniform price**. Settlement is **one atomic NEAR Intents batch**: every buyer's USDC goes out and every buyer's GPU-hour vouchers come in, or nothing happens. Each buyer pays only `clearing_price × hours_it_received`.

**The pitch for judges:** "20 strangers' agents buy compute together that none of them could buy alone. Every bid, reveal and payment is traceable to one named sub-account on chain."

---

## 2. Why pooling has to matter (economic design)

If pooling doesn't create value, the demo is just an auction with extra steps. These rules make it matter:

| Lever | Rule | Effect |
|---|---|---|
| **Minimum lot** | Each seller sets `min_lot` (e.g. 100 h). Buyers want 5–40 h each. | Solo buyers can't trade at all. A pool can. |
| **Volume tier** (stretch) | A seller's ask can drop at larger quantities. | Bigger pools get cheaper hours. |
| **Single settlement** | One intents batch per round instead of N separate trades | Lower gas and coordination cost per buyer |

**Headline metric on the live page:** *"Savings vs. going solo"*, computed per buyer and in aggregate. A solo buyer pays the best ask with `min_lot ≤ own qty`, or ∞ if no such ask exists.

---

## 3. Market design (draft rules → become RULES.md)

### 3.1 Actors and accounts

All accounts are sub-accounts of one parent, so every action on chain traces back to a specific agent:

```
swarm.testnet                 parent (funds + creates everything)
├── coordinator.swarm.testnet  round contract (commit / reveal / clear / settle)
├── usdc.swarm.testnet         mock USDC (NEP-141), testnet only
├── gpuh.swarm.testnet         GPU-hour voucher (NEP-245 multi-token, token id per seller+spec)
├── verifier.swarm.testnet     intents verifier (see §5 on testnet)
├── buyer-1 … buyer-20.swarm.testnet
└── seller-1 … seller-5.swarm.testnet
```

- Each agent holds **its own key pair**. Agents get **function-call access keys** scoped to `coordinator` and `verifier` only, so a compromised agent key can't drain the account. This is a good security story to show.
- Account creation is scripted (`scripts/bootstrap.ts`). It creates the sub-accounts, funds them, mints mock USDC to buyers, and mints vouchers to sellers.

### 3.2 Orders

- **Buyer bid:** `{ spec, qty_hours, max_price_per_hour }`. `spec` is GPU type, region and delivery window, e.g. `H100/us-east/2026-W46`.
- **Seller ask:** `{ spec, capacity_hours, min_lot, ask_price_per_hour }`.
- Prices are integers in USDC micro-units, quantities are integer hours, and there are no floats on chain.

### 3.3 Discovery: how buyers "find each other"

- Buyers call `join_pool(spec)` on the coordinator. This is a public signal of interest only: no price, no quantity.
- A **pool** is keyed by `spec`. A round opens for a pool when either:
  - the pool's member count reaches `N_min`, or
  - `T_open` passes since the first join.
- Sellers subscribe to specs and get notified when a round opens. In sim mode this is an event; live, it's an indexer or websocket.
- Stretch: buyers with *near-compatible* specs (A100 vs H100, an adjacent week) can choose to merge pools. This is real coalition formation and makes good demo material.

### 3.4 Round lifecycle (sealed bid via commit–reveal)

| Phase | Duration (sim / testnet) | What happens |
|---|---|---|
| `OPEN` | — | Round created for a pool with a fixed member list |
| `COMMIT` | ~30 s / N blocks | Every participant submits `hash = sha256(borsh(order) ‖ salt ‖ account_id)` and posts a **bond**. Buyers also **escrow `qty × max_price`** (their worst-case spend). |
| `REVEAL` | ~30 s | Participants reveal `(order, salt)`. The contract checks the hash and checks that escrow covers the revealed order. |
| `CLEAR` | 1 tx | Anyone can call `clear(round_id)`. Clearing is deterministic (§3.5) and stores allocations. |
| `SETTLE` | 1 tx batch | The coordinator, acting as the solver, submits the signed intents batch (§5). On failure, everything is refunded. |
| `DONE` | — | Refunds of unused escrow and bonds. Events are emitted for the UI. |

- **Didn't reveal:** the agent forfeits its bond, split among the participants who did reveal, and its order is ignored. This stops "commit, watch, then decide" behaviour.
- **Sealed:** nobody, including the coordinator, sees prices before `REVEAL`. The hashes are public and the live page shows them.
- **Salt** includes the account id, so one agent can't copy another agent's commit.

### 3.5 Clearing rule: uniform-price call auction (pay-as-clear)

The rule is deterministic, O(n log n), and the same code runs in the contract and in the simulator.

1. Sort valid asks **ascending** by price. Break ties by commit time, then by account id.
2. Sort valid bids **descending** by `max_price`, using the same tie-break.
3. Walk both curves to find the largest quantity `Q*` where the marginal bid ≥ the marginal ask. Skip a seller if its allocated quantity would be `< min_lot`.
4. **Clearing price `P*` = the highest accepted ask** (the marginal seller's price). Every buyer pays `P*`, and every seller receives `P*`.
5. If there are more bids than hours at the margin, buyers at the marginal price are filled **pro-rata**, rounded down to whole hours. Leftover hours go to the earliest commit.
6. Buyers with `max_price < P*` get nothing and receive a full refund.

**Decision for RULES.md:** pay-as-clear (above) or **second-price / Vickrey** (winners are paid the first rejected ask). Pay-as-clear is easier to explain on a chart. Vickrey makes truthful asks a dominant strategy for single-unit sellers. Recommendation: **pay-as-clear for v1** and mention Vickrey as a config flag.

**Buyer payment:** `pay_i = P* × filled_i`, plus an optional protocol fee in bps. The refund is `escrow_i − pay_i`. This is the "each buyer pays only its share" property, and it's checked by an invariant test.

### 3.6 Invariants (property tests)

- Σ buyer USDC out = Σ seller USDC in (+ fee)
- Σ vouchers out of sellers = Σ vouchers into buyers = `Q*`
- No buyer pays above its `max_price`, and no seller receives below its ask
- No seller allocation is in `(0, min_lot)`
- Clearing is a pure function of the revealed orders, so re-running it gives an identical result

---

## 4. One round as a sequence diagram (text)

```
Buyer_i (×20)      Seller_j (×5)       Coordinator (contract)        Verifier (intents)       UI/Indexer
    |                   |                        |                            |                      |
    |-- join_pool(spec) ------------------------>|                            |                      |
    |                   |                        |-- [N_min reached] open_round(r, spec) ----------->| event
    |                   |<-- RoundOpened(r) -----|                            |                      |
    |                   |                        |                            |                      |
    |== COMMIT ==========================================================================================
    |-- deposit escrow (USDC qty*max) ---------->|  (ft_transfer_call)        |                      |
    |-- commit(r, H(bid‖salt), bond) ----------->|                            |                      |
    |                   |-- commit(r, H(ask‖salt), bond) ->|                  |                      |
    |                   |-- lock vouchers (capacity) ----->|                  |                      |
    |                   |                        |-- CommitAdded(r, acct, H) --------------------------->|
    |                   |                        |                            |                      |
    |== REVEAL (after commit deadline) ==================================================================
    |-- reveal(r, bid, salt) ------------------->|  check H, check escrow     |                      |
    |                   |-- reveal(r, ask, salt) ->|                          |                      |
    |                   |                        |-- Revealed(r, acct, order) ------------------------->|
    |                   |                        |                            |                      |
    |== CLEAR (after reveal deadline; anyone can call) ==================================================
    |                   |                        |-- clear(r): sort, cross, P*, allocations         |
    |                   |                        |-- Cleared(r, P*, Q*, allocations) ------------------>|
    |                   |                        |                            |                      |
    |== SETTLE ==========================================================================================
    |<-- sign token_diff {-USDC: P*·q_i, +GPUH: q_i} (NEP-413) ---|                  |                  |
    |                   |<-- sign token_diff {-GPUH: x_j, +USDC: P*·x_j} ---|       |                  |
    |-- signed intent ------------------------->|                             |                      |
    |                   |-- signed intent ----->|                             |                      |
    |                   |                        |-- execute_intents([all signed diffs]) -->|        |
    |                   |                        |                            |-- verify sigs, Σdiff=0, atomic apply
    |                   |                        |<-- ok / revert ------------|                      |
    |                   |                        |-- refund leftover escrow + bonds                  |
    |<-- refund ---------------------------------|                            |                      |
    |                   |                        |-- Settled(r, tx_hash) ----------------------------->|
```

Buyer and seller agents each sign their **own** `token_diff`. The coordinator only bundles the diffs and submits them, so it can never move funds that an agent didn't authorise. The verifier only applies the batch if every diff nets to zero across all tokens, which gives atomic all-or-nothing settlement.

---

## 5. NEAR Intents: the main technical risk

**Finding:** the Agent API at `docs.agentsonintents.com` is a **mainnet-only beta**. The production intents verifier (`intents.near`) is also on mainnet. Our sub-account requirement is written for testnet (`*.swarm.testnet`).

**Plan, in three layers:**

1. **Testnet (main demo): self-hosted verifier.** The NEAR Intents verifier contract is open source. **Day-1 spike:** clone it, build it, deploy it to `verifier.swarm.testnet`, and register our mock USDC and voucher tokens. If that works, settlement uses the real `execute_intents` + `token_diff` + NEP-413 signature path. That's the same code path as mainnet, so it's a credible demo.
2. **Fallback if the spike fails by midday 1: mini-verifier.** We write a minimal contract with the same interface (`execute_intents(signed[])`, check signatures, check Σ diffs = 0 per token, apply atomically). It's about 200 lines of Rust. Be upfront with judges that it's a stand-in.
3. **Mainnet "proof round" (stretch, strong for judging).** Run one real round on mainnet:
   - `swarm.near` sub-accounts (`buyer-1.swarm.near` …)
   - a few dollars of real USDC
   - the real `intents.near` verifier
   - optionally, Agent API wallets with **owner-signed policies** (per-agent USD budget, allowed tokens, emergency stop). This maps exactly to "an agent represents one user".

   Link the mainnet tx on the live page.

Example shape of a buyer's signed intent. **Verify the exact schema against the verifier source on Day 1.**

```json
{
  "signer_id": "buyer-7.swarm.testnet",
  "verifying_contract": "verifier.swarm.testnet",
  "deadline": "2026-11-12T18:00:00Z",
  "nonce": "<base64 32 bytes>",
  "intents": [
    { "intent": "token_diff",
      "diff": {
        "nep141:usdc.swarm.testnet": "-28800000",
        "nep245:gpuh.swarm.testnet:seller-3/H100/us-east/2026-W46": "12"
      } }
  ]
}
```

---

## 6. Agents and strategies

### 6.1 Simulation mode: 20 buyers, 5 sellers, no LLM calls

Each strategy is a pure function: `(private_profile, market_history, rng) -> order`. Runs are seeded, so every run can be replayed exactly.

**Buyer strategies:**

| Strategy | Behaviour |
|---|---|
| `truthful` | bids its true value |
| `shader` | bids value × (1 − δ) and risks not being filled |
| `follower` | bids last `P*` + ε, capped at its value |
| `impatient` | bids its full value, and its value rises each round it goes unfilled |
| `pool_hopper` | (stretch) picks the pool with the best expected `P*` |

**Seller strategies:**

| Strategy | Behaviour |
|---|---|
| `cost_plus` | asks cost × (1 + m) |
| `undercutter` | asks last `P*` − ε, floored at cost |
| `greedy` | asks high, and drops its ask after each round it doesn't win |
| `adaptive` | multiplicative-weights learner over a grid of ask prices |
| `random` | uniform draw between cost and 2 × cost |

Each agent's private profile comes from a seeded generator:

- buyers: value in $1.50–3.50, qty in 5–40 h
- sellers: cost in $1.00–2.20, capacity in 80–400 h, min_lot in 50–150 h

**Two run modes from the same strategy code:**

- `sim:offline`: a pure TypeScript engine runs thousands of rounds in seconds. Use it for tuning and for charts ("price converges to ~$X after 30 rounds").
- `sim:chain`: the same agents sign and send real testnet transactions from their own sub-accounts. This is the live demo.

**Parity:** the clearing logic exists in Rust (contract) and TypeScript (sim). Both run against one shared `test-vectors/*.json` suite in CI, so the two implementations can't drift.

### 6.2 Live mode (optional): LLM-fronted agents

- Some agents get a natural-language front end. The user types *"I need ~20 H100 hours before Friday, don't pay more than $2.50"*. An LLM turns that into a structured order plus a spending policy, and the scripted strategy takes over from there.
- The LLM is only used at intake, so rounds stay cheap and deterministic.
- Optional extra: expose agent actions through the **NEAR MCP server**, so an LLM agent could operate its own sub-account directly.

---

## 7. Live page

Next.js reads from a small indexer. The indexer polls contract views and NEP-297 event logs over RPC, then pushes updates to the browser over websocket or SSE.

1. **Round timeline:** OPEN → COMMIT → REVEAL → CLEAR → SETTLE, with countdowns.
2. **Sealed board:** commit hashes appear first. At reveal they flip into prices, which looks good in a demo.
3. **Supply/demand chart:** a stepped bid curve and ask curve, with the crossing point marked as `P*` and `Q*`.
4. **Allocation table:** buyer → seller, hours, price paid, refund, **savings vs. solo**. Each row links to its tx on the explorer.
5. **Agent roster:** all 25 sub-accounts with strategy, balances and win rate.
6. **History:** `P*` across rounds, plus a "market efficiency" metric (realised surplus ÷ max possible surplus).

---

## 8. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Contracts | Rust + `near-sdk` 5.x, `cargo near` | Standard, typed, borsh; best fit for the intents verifier codebase |
| Tokens | NEP-141 mock USDC, NEP-245 vouchers | Same standards the intents verifier uses |
| Agents / sim | TypeScript, `near-api-js` (or `@near-js/*`), seeded RNG | One language for sim, agents and UI |
| Indexer | Node script, RPC polling + event logs → SQLite | Simple; no infrastructure to stand up |
| UI | Next.js + Recharts/visx + SSE | Fast to build; charts are what judges see |
| Tests | `near-workspaces` (contracts), Vitest (sim), shared JSON vectors | Rust/TS clearing parity |

### Repo layout

```
swarma/
├── RULES.md                  ← first deliverable
├── docs/round-sequence.md    ← diagram from §4
├── contracts/
│   ├── coordinator/          rounds, commit/reveal, clear, escrow, settle
│   ├── voucher/              NEP-245 GPU-hour tokens
│   └── mock-usdc/            NEP-141
├── verifier/                 forked intents verifier OR mini-verifier
├── agents/
│   ├── core/                 Agent class: key, sign, commit, reveal, sign intent
│   ├── strategies/           buyer/*.ts, seller/*.ts
│   └── llm-intake/           optional NL → order
├── sim/
│   ├── engine.ts             offline clearing + round loop
│   ├── run-offline.ts
│   └── run-chain.ts
├── test-vectors/             shared clearing cases
├── indexer/
├── web/
└── scripts/bootstrap.ts      create 27 sub-accounts, fund, mint
```

---

## 9. Build order (cut line marked)

| # | Milestone | Done when |
|---|---|---|
| 0 | **RULES.md + sequence diagram** | ✅ the team signs off. Writing contracts starts only after this. |
| 1 | Offline sim engine + clearing + strategies | 1,000 rounds run, invariants pass, the convergence chart looks sensible |
| 2 | Intents verifier spike on testnet | We know which path from §5 we're on |
| 3 | `bootstrap.ts` | 27 sub-accounts exist, funded, tokens minted |
| 4 | Coordinator contract (commit/reveal/clear) | `near-workspaces` tests pass; Rust/TS vectors match |
| 5 | Settlement via intents batch | One full testnet round settles atomically |
| 6 | `sim:chain` | 20 buyers + 5 sellers run 5 rounds on testnet unattended |
| 7 | Live page | Timeline, sealed board, chart, allocations, tx links |
| — | **✂ MVP cut line** | Everything above is a complete submission |
| 8 | Mainnet proof round on `intents.near` | A real tx link on the page |
| 9 | Agent API policies for buyer wallets | Owner-signed budget caps shown in the UI |
| 10 | Pool merging / coalition formation, volume tiers | — |
| 11 | LLM intake + NEAR MCP | — |
| 12 | Confidential Intents balances for private bids/budgets | — |

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Intents is mainnet-only | §5: three layers, decided on Day 1 |
| 25 agents × 2 tx per round is slow on testnet | Each agent signs with its own key (no nonce contention). Send commits in parallel. Phase deadlines go by block height with enough slack. |
| An agent fails to sign at settle time, so the batch can't net to zero | Fall back to escrow-based settlement inside the coordinator (it holds the escrowed funds). The intents batch is the happy path; the escrow path is the guarantee. |
| Rust and TS clearing disagree | Shared test vectors in CI |
| Gas from sorting on chain | n ≤ ~50 orders per round, which is trivial. Cap participants per round. |
| Demo-day flakiness | Pre-recorded `sim:chain` run plus a replay mode on the UI from the indexer DB |

---

## 11. Open questions for you

1. **Hackathon length and team size?** These decide how far past the cut line we plan.
2. **Rust comfort?** If it's low, the coordinator could be written in `near-sdk-js`. Settlement would still go through the Rust verifier.
3. **Real money:** OK to spend about $5–10 of mainnet USDC + NEAR on the proof round?
4. **Clearing rule:** pay-as-clear (recommended) or Vickrey?
5. **Name:** "Swarma" is fine. Alternatives: *GPU Commons*, *Herd*, *Flock Compute*.

---

## 12. Next step

Once you're happy with this plan, I'll write **`RULES.md`** (from §3, every parameter given a concrete value) and **`docs/round-sequence.md`** (from §4) as standalone files. Then I'll stop and wait for your OK before any contract code, as the track prompt requires.
