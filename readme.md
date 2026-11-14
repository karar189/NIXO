# NIXO: clean-funds passport and gated trading on NEAR

> Prove your money is clean without proving where it's been.

**One-liner (product):** NIXO is a clean-funds passport and a gated trading layer for NEAR. It checks the source of funds inside a trusted execution environment, lets an AI agent trade only certified deposits under limits the contract enforces, and lets solvers refuse an intent that is not clean.

Three layers feed each other. The **tracer** creates trust. The **vault** puts that trust to work. The **solver** gate spreads the same check across the NEAR Intents network.

**Privacy, stated honestly:** the strategy can be private inside a TEE; the trade log is encrypted and readable with viewing keys; fund history is checked without being revealed. **NIXO does not hide trades on-chain.** Vault deposits, Intents settlements and ordinary transfers remain visible on explorers.

Built for **NEAR HACKATHON** (window through 14 Nov 2026). Primary track **Privacy & Private AI**; also Unstoppable DeFi, AI Security and Defense, and Agent Economy — each only as far as this version honestly goes.

| | |
|---|---|
| **Product requirements** | [`NIXO_PRD.md`](NIXO_PRD.md) (authoritative for scope and privacy language) |
| **Status / narrative** | [`docs/PRODUCT_SUMMARY.md`](docs/PRODUCT_SUMMARY.md) |
| **Agents experiment spec** | [`docs/Nixo_agents.md`](docs/Nixo_agents.md) |
| **Verifier contract** | `nixo.testnet` |
| **Checker** | `/checker`, hash pinned on-chain |
| **Kani proofs** | `/checker/proofs/verdict.rs` (CI) |
| **License** | MIT |
| **Live demo** | hosted URL here |

---

## Judge it in 90 seconds

No real funds required for the certificate demo. Two pre-seeded testnet accounts: one clean, one tainted.

```bash
git clone https://github.com/<your-org>/nixo
cd nixo
pnpm setup
pnpm demo
```

Opens `http://localhost:3000`:

1. **Certify Alice.** **Prove my funds are clean** as `nixo-alice.testnet` → pending → ✅ Clean certificate (verdict, expiry, checker version, history source — **no hop path**).
2. **Reject Mallory.** Switch to `nixo-mallory.testnet` (replay of a real mainnet trail from `farstreet4572.near`) → ❌ Rejected with a reason. Live certificates today use fixture history; see [What is real vs mocked](#what-is-real-vs-mocked-in-this-version).
3. **Exchange view.** Open `/verify`, paste `nixo-alice.testnet` → live `is_clean` → ✅. Expand the Verified panel (WASM hash, OutLayer attestation, list snapshot, Kani link).
4. **Agents & vaults (Layer 2 experiment).** `/dashboard/agents` — two agents, same task; Agent B is constrained by an off-chain vault (caps, revoke, adversarial suite). Provenance is labelled **stub**; enforcement is not yet on-chain.
5. **Optional preview.** On `/verify`, **Check any NEAR wallet** traces mainnet accounts (e.g. `farstreet4572.near`) with hop paths — preview only, not certifiable.

**Not yet in the live demo (PRD cut list):** on-chain vault deposit gate wired to `is_clean`, encrypted trade log + viewing-key decrypt, mock solver Alice-fill / Mallory-refuse. Those are in scope for this version; do not pitch them as live until they are.

---

## The problem

Exchanges, vaults and AI trading agents need to know whether incoming funds are tied to sanctioned or stolen money. Today that usually means handing a full history to a central screener, or trusting an agent with a hot wallet and hoping it behaves.

That creates three failures:

1. **A compliance check leaks the history.** Counterparties, balances and routes become visible to whoever runs the check.
2. **An account-level “looks fine” is treated as a property of the coins.** A wallet can be certified once, then receive dirty money, then deposit. Trust must be checked when funds move, and recorded **per deposit**.
3. **Agents and solvers have no shared gate.** A prompt-injected agent, or a solver filling any intent, can move money a human would have refused.

NIXO addresses this on NEAR. A pinned checker runs in an OutLayer TEE (Intel TDX), looks up history itself, and writes a short certificate to `nixo.testnet`. The vault, and later any solver, reads `is_clean` and acts on that verdict — not the path, balances or counterparties.

NIXO is **bounded on-chain provenance screening**, not a legal or AML proof that particular coins are clean. The product must say so.

---

## Three layers

```text
Depositor / agent / solver
        │
        ▼
┌───────────────────┐     ┌────────────────────┐     ┌─────────────────┐
│ 1. Fund tracer    │────▶│ 2. Vault + agent   │────▶│ 3. Solver gate  │
│ OutLayer TEE      │     │ clean deposits only│     │ is_clean before │
│ → certificate     │     │ contract limits    │     │ fill / route    │
└───────────────────┘     └────────────────────┘     └─────────────────┘
```

### Layer 1 — Fund tracer

A Rust checker (WASM) runs in OutLayer. It screens the account and counterparties against pinned lists (OFAC, EU, UK, UN, SECO + known-hackers), then searches backwards up to six hops (including Ref pool hops under stated rules). Outcomes: Clean, Warn, or Rejected with a fail-closed reason.

- **Certified mode:** account only; history fetched inside the enclave (or a labelled fixture offline). Output under ~900 bytes, **no path**.
- **Preview mode:** caller may supply history; marked `caller_supplied`; contract **refuses** to certify it.
- Contract: `request_nixo` → OutLayer → private `resolve_nixo` → store certificate. `is_clean(account)` is true only for a currently valid **Clean** certificate.

### Layer 2 — Deposit vault and AI trading agent

The vault holds funds; the agent never does. Target behaviour (PRD):

1. Deposit only after a currently valid Clean certificate (`is_clean` cross-contract). Dirty / warn / missing / expired → refund, no provenance row.
2. Each deposit is its own provenance event (`clean_at_deposit` at that moment).
3. Owner assigns the deposit to an agent with per-tx / window / expiry limits and an allowlist.
4. Agent trades only via `execute` (function-call key). Contract re-checks permissions every call.
5. Owner can revoke and withdraw. Prompt-injected “pay a blocked destination” fails at the contract, not only in the UI.
6. Encrypted trade log + at least one viewing-key path (a delayed key is enough for this version). Viewing keys do **not** hide explorer-visible transfers.

**Shipped today:** an off-chain two-agent experiment at `/dashboard/agents` (see [Agents & vaults](#agents--vaults-layer-2-experiment)) that proves constrained vs unconstrained agents with stub provenance. Moving enforcement on-chain and wiring deposits to `is_clean` is the remaining Layer 2 work.

### Layer 3 — Solver infrastructure

Middleware any NEAR Intents solver (or routing agent) can call before fill: allow only when `is_clean` is true; missing / expired / warn / rejected / transport failure → refuse. Hackathon scope: a **mock solver** that fills Alice and refuses Mallory, plus a documented fail-closed SDK shape — not a production solver network.

---

## How the tracer works (detail)

1. User calls `request_nixo` with their account id only. History is not uploaded by the website.
2. Contract asks OutLayer to run the pinned checker (`WasmUrl` + SHA-256).
3. Inside the enclave, the Checker screens lists and traces up to 6 hops. Fail-closed on incomplete history, bad fetches, or caps on non-terminal accounts.
4. OutLayer attestation commits to WASM / input / output hashes (TDX workers registered via DCAP).
5. `resolve_nixo` accepts only the pinned, unrevoked checker hash for the requesting account, stores a short-lived certificate (7-day TTL on testnet), emits events. Anything unexpected stores nothing.
6. Anyone calls `is_clean(account)` / `get_certificate` — verdict, reason, checker version, list snapshot, expiry; never the path.

| # | Component | Role | Tech |
|---|-----------|------|------|
| 1 | Checker | Deterministic rules inside the TEE | Rust → `wasm32-wasip2` on OutLayer (Intel TDX) |
| 2 | Certificate contract | Pin hash, OutLayer callback, certificates, `is_clean` | `nixo.testnet`, `near-sdk` 5 |
| 3 | Lists + history | Sanctions / hacker lists; NearBlocks v3 (target) or labelled fixtures | Compiled lists `data-2026-10-29` |
| 4 | Desk / SDKs | Certify UI, `/verify`, in-app view client; solver SDK later | Next.js, `web/lib/nixo-sdk.ts` |
| 5 | Explainer | Plain-English note from the **public** certificate only | NEAR AI Cloud + fresh-nonce attestation check |

### What is hidden from whom

| Party | Sees | Does not see |
|-------|------|--------------|
| Exchange / vault / solver | Verdict, reason, list version, expiry, checker hash | Balances, counterparties, amounts, hop path |
| OutLayer operator | Job ran, duration, hashes | Input/output contents (when session encryption is in place) |
| Public chain | Compact certificate fields | History behind the verdict |
| NIXO operators | No runtime user history store | History and pre-chain verdict |
| Viewing-key holder | Encrypted **trade log** for that key’s scope | Live chain privacy (explorers still show vault/Intents transfers) |

### More than a TEE badge

A TEE proves the code was not tampered with. NIXO also argues the decision core is correct: minimal pure `verdict()` / `trace::search()`, Kani proofs, reproducible WASM, timelocked hash pinning, fail-closed errors, revocation + expiry, local `wasmtime` re-run.

---

## How NEAR is used

- **OutLayer (Intel TDX)** — runs the Checker. `/checker`, `/contract/src/outlayer.rs`.
- **`nixo.testnet`** — `request_nixo`, `resolve_nixo`, `is_clean`, `get_certificate`, hash governance (`set` / `apply` / `cancel` / `revoke_checker_hash`).
- **NEAR Intents** — trading desk dry-run and live spot swaps; vault allowlist target for agent execution (PRD). History-inside-enclave via NearBlocks v3 is this version’s tracer goal (fixtures labelled until then).
- **NEAR AI Cloud** — certificate explainer (`/web/app/api/explain`); multi-provider LLM path for agents including `nearai`. TEE-hosted strategy with Verified panel is in scope if reliable; otherwise say the model is not yet in the enclave.
- **Chain Signatures / cross-chain registries** — later. Not in this pitch as shipped.

---

## Try it

### Prerequisites

- Node 20+, pnpm 8+ (web); npm (backend)
- Python 3.12+ (agents)
- Rust: checker pins 1.93.0 (`wasm32-wasip2`), contract pins 1.95.0
- Optional: `near-cli-rs`, `cargo-near`, `wasmtime`, NEAR AI / other LLM keys

### Setup

```bash
git clone https://github.com/<your-org>/nixo
cd nixo
cp .env.example .env    # one file for every service
pnpm setup
pnpm dev                # web :3000, agents :8000, backend :4000
```

| Service | Command | URL |
|---|---|---|
| Web (landing, dashboard, verify) | `pnpm dev:web` | http://localhost:3000 |
| Agents (FastAPI + NIXO experiment) | `pnpm dev:agents` | http://localhost:8000/docs |
| Backend (waitlist) | `pnpm dev:backend` | http://localhost:4000 |

Tests: `pnpm test`, `pnpm test:backend`, `pnpm kani`.

### Checker alone / local re-run

```bash
cd checker && cargo test
cargo build --release --locked --target wasm32-wasip2
shasum -a 256 target/wasm32-wasip2/release/nixo_checker.wasm
printf '{"account":"nixo-alice.testnet"}' | wasmtime run target/wasm32-wasip2/release/nixo_checker.wasm
# or: scripts/run-checker.sh nixo-alice.testnet
```

---

## Agents & vaults (Layer 2 experiment)

Specified in [`docs/Nixo_agents.md`](docs/Nixo_agents.md); product target in [`NIXO_PRD.md`](NIXO_PRD.md) §4.2.

Two agents, same task, equivalent capital. **Agent B** trades through a policy vault; **Agent A** is the unrestricted baseline.

- **Task:** target portfolio of up to 4 assets from `USDC@near` (`SYMBOL@chain` via 1Click).
- **Agent B policy:** per-trade and total-spend caps, allowed assets/chains, recipient pinning, assignment / revoke / replay checks, atomic spend reservation.
- **Adversarial suite:** t01–t17 (incl. cross-chain recipient/chain/pin attacks), then owner revoke.
- **UI:** `/dashboard/agents` (wallet). Settings → AI model providers at `/dashboard/settings`.
- **Honest labels:** enforcement **off-chain** (in-process); execution **simulated**; provenance **`stub_verified`** — not yet `nixo.testnet.is_clean`.

LLM providers: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `NVIDIA_API_KEY`, `NEARAI_API_KEY`. `auto` walks `LLM_PROVIDER_ORDER`. Details: [`agents/README.md`](agents/README.md).

---

## Repository layout

```text
nixo/
  NIXO_PRD.md             # product requirements (authoritative)
  docs/
    README.md             # doc index
    PRODUCT_SUMMARY.md    # narrative + current status
    Nixo_agents.md        # Layer 2 experiment spec
  checker/                # Rust → WASM (OutLayer TDX)
  contract/               # nixo.testnet certificate contract
  web/                    # Next.js: landing, /verify, /dashboard/*
  agents/                 # FastAPI: trading + app/nixo experiment
  backend/                # NestJS waitlist
  fixtures/               # Alice / Mallory + mainnet cache
  scripts/                # dev, deploy, run-checker, fetch-history, …
  .github/workflows/      # checker, Kani, contract, web, agents, backend
```

---

## What is real vs mocked in this version

| Piece | Status |
|-------|--------|
| Checker core + multi-hop search (source) | Real; Kani-proven on bounded harnesses |
| OutLayer + `nixo.testnet` certificates | Real on testnet |
| Certified Alice / Mallory histories | **Fixtures** compiled into the WASM (`history_source: fixture`). Live NearBlocks fetch inside the enclave is PRD work |
| Pinned WASM vs current source | Live certs may show older checker metadata (e.g. depth 1 / `list_hit`); rebuild + re-pin after live-history work |
| Sanctions lists | Real snapshot `data-2026-10-29` |
| Hacker list | One entry; unofficial public attribution (AMLBot / Shridlock); say so in demos |
| `/verify` “Check any wallet” | Preview only (`caller_supplied`); different WASI build hash |
| NEAR AI explainer | Real; nonce echo checked; full quote verify later |
| Agents vault / provenance / execution | Off-chain / stub / simulated (labelled in UI) |
| Viewing keys / encrypted trade log | Not shipped (sidebar Soon) |
| Mock solver + solver SDK | Not shipped |
| On-chain vault gated by `is_clean` | Not shipped |
| Chain Signatures cross-chain relayer | Not built (later) |

Every mocked piece should stay tagged in the UI and here. Judges should see what is live, fixture, or later in under a minute.

---

## Formal verification

Kani proves the pure list rule and multi-hop search properties on bounded inputs (see `/checker/proofs`). CI fails on regression. Proofs cover algorithm logic, not list completeness, indexer correctness, or attribution of listed wallets.

```bash
cargo install --locked kani-verifier && cargo kani setup
cd checker && cargo kani
```

---

## Trust assumptions and limits (short)

- Trusts Intel TDX / OutLayer measurements, pinned WASM hash, private `resolve_nixo`, NearBlocks at a pinned block (when live), compiled lists as of snapshot date, documented terminal accounts (faucets/venues).
- Does **not** prove a particular subset of coins is clean; `is_clean` is account-level at check/deposit time. Pool-hop linking is a heuristic. Cross-chain origin is out of scope. Explorers still show vault and Intents activity.

Full wording: [`NIXO_PRD.md`](NIXO_PRD.md) §§6–7.

---

## Related work

| Who | What they do | Where NIXO differs |
|-----|--------------|--------------------|
| Chainalysis, TRM, Elliptic | Score public history | See nothing inside private systems |
| Jurat | TEE proof of balance ≥ X | Proves how much; NIXO proves where funds did **not** come from |
| Gateflow | Sanctions on public checkouts | Public inputs; no TEE certificate |
| Privacy Pools | ZK exclusion from bad deposits | Single-pool focus; NIXO is a passport + gate for agents/solvers |
| Zcash viewing keys | Reveal shielded history | Reveal everything; NIXO emits a verdict (and separately encrypts **trade** logs) |

---

## Hackathon scope vs later

| This version | Later |
|---|---|
| Live enclave NearBlocks fetch (fixtures labelled for offline/CI) | More indexers |
| Certificates on `nixo.testnet`; vault + mock solver use `is_clean` | Mainnet; real solver network |
| Vault with per-deposit provenance, FC-key agent, revoke/withdraw | Destination / amount-level provenance |
| Agent via Intents within limits; dry-run default | Full production swap state machine |
| TEE strategy if reliable; else say so | Default private strategy |
| Encrypted log + ≥1 viewing-key path | Full key marketplace |
| Mock solver Alice/Mallory | Published solver package at scale |
| Honest README (terminals, fixtures, network match, privacy) | — |
| **Not in pitch:** cross-chain coverage, confidential on-chain execution | Those only when built |

**Acceptable cuts if time runs out:** live Intents fills (keep dry-run + vault gate) → TEE model (keep checker TEE) → extra viewing-key types (keep one delayed key) → anything that makes the solver layer look like a live network rather than a mock.

### Roadmap (product)

1. **This hackathon version** — close PRD gaps: live history in enclave, on-chain vault gate, one viewing key, mock solver; keep honesty tables current.
2. **v1** — mainnet, multisig, SDKs, audit, withdrawal pilot.
3. **v2** — Chain Signatures registries, richer disclosure keys, broader venue coverage — still without claiming confidential execution until it exists.

---

## Hackathon disclosure

- **Window:** commits between hackathon announcement 2026-10-19 and deadline 2026-11-14 23:59 UTC. First commit: see `git log`.
- **Pre-hackathon code:** no prior product resubmitted. Libraries used as-is (`near-sdk`, `near-api-js`, `kani-verifier`, sanctions lists, OutLayer templates). AI coding assistants were used. NearArc trading/agents code was imported and is disclosed in-repo.
- **Other submission by this author:** none / name and link if any.

---

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgements

- NEAR Protocol — privacy defaults and Intents.
- FastNEAR — OutLayer.
- Model Checking team — Kani.
- Safe Foundation — dated OFAC/EU/UK/UN/SECO extractions.

## Links

- Demo video / X post: link here after posting
- [OutLayer](https://app.outlayer.ai/docs)
- [NEAR AI Cloud](https://docs.near.ai/cloud/quickstart)
- [NEAR Intents](https://docs.near-intents.org/)
- [Kani](https://model-checking.github.io/kani/)
