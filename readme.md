# NIXO: a clean-funds passport for private money

> Prove your money is clean without proving where it's been.

NIXO is a compliance layer for private money on NEAR. A sealed Intel TDX enclave checks a user's confidential transaction history against sanctions and known-hacker lists, and outputs only a signed verdict. A NEAR contract records that verdict as a short-lived certificate, and any exchange on any chain can verify it with one call, without ever seeing balances or counterparties.

Built for **NEAR HACKATHON** (1–14 Nov 2026). Tracks: **Privacy & Private AI** (primary), Real-World Money, AI Security & Defense.

- **Live demo:** hosted URL here
- **Verifier contract:** `nixo.testnet` (mainnet `nixo.near` at v1)
- **Checker source:** `/checker` in this repo, pinned by hash on-chain
- **Kani proofs:** `/checker/proofs/verdict.rs`, run in CI (`.github/workflows/ci.yml`)
- **License:** MIT

## Judge it in 90 seconds

No real funds, no wallet, no mainnet. Two pre-seeded testnet accounts, one clean and one tainted. The hosted demo needs nothing; running locally needs the two demo testnet keys in `web/.env` (see Setup).

```bash
git clone https://github.com/<your-org>/nixo
cd nixo
pnpm install
pnpm demo
```

`pnpm demo` opens `http://localhost:3000`:

1. Click **Prove my funds are clean** as `nixo-alice.testnet` → about 1–2 minutes later, ✅ Clean certificate.
2. Switch to `nixo-mallory.testnet` (tainted history, received from a seeded demo-flagged address) → ❌ Rejected, reason `list_hit`.
3. Open `/verify`, paste `nixo-alice.testnet` → live `is_clean` call to the NIXO contract returns ✅. Expand the Verified panel to see the WASM hash, the OutLayer attestation link, the list snapshots with hashes, and a link to the passing Kani proof.

That's the whole demo. The sections below explain what each piece is and how it is built.

## The problem

NEAR made money private by default. Since late August 2026, balances, swaps and payments on near.com run through Confidential Intents, and since 27 October every 1Click swap settles on the private shard. Confidential activity is already about 42% of NEAR's trading volume.

But private money has a fatal gap: it cannot prove it is clean. Exchanges reject funds they cannot screen, because chain-analysis tools see nothing inside a private system. Regulators sanction privacy tools that cannot separate honest users from launderers, which is why Tornado Cash was sanctioned in 2022 and its developers prosecuted. And North Korea is laundering the $6.3B Binance haul through DeFi, bridges and memecoins right now, so every private system is under scrutiny as a possible route.

Honest users face a false choice: expose their entire financial history, or get rejected. NIXO fixes that.

## How NIXO works

1. The user calls `request_nixo` on the NIXO contract. The only public input is their account id; the history never goes on-chain.
2. The contract calls OutLayer's `request_execution` with the checker pinned by URL + SHA-256 (`WasmUrl` source). OutLayer yields until a registered Intel TDX worker resolves the run.
3. Inside the enclave, the Checker (Rust to WASM) loads the user's confidential history, screens the account and every direct counterparty against lists compiled into the WASM, and emits a verdict. MVP: history comes from simulated fixtures; v1 reads it from a 1Click session inside the enclave.
4. OutLayer's TDX workers are registered on-chain via DCAP quote verification, and each run's attestation commits to the WASM hash, input hash and output hash.
5. The callback `resolve_nixo` accepts the result only for the pinned, unrevoked `checker_hash` and the requesting account, stores a short-lived certificate, and emits `nixo_requested` / `nixo_resolved` / `nixo_failed` events. Anything unexpected stores nothing (fail closed).
6. Any exchange on any chain calls `is_clean(account)` and gets ✅ or ❌, plus a Verified panel linking the attestation, list snapshots, Kani proofs and WASM hash.

| # | Component | What it does | Tech |
|---|-----------|--------------|------|
| 1 | Checker | Deterministic Rust rule; returns `Clean` or `Rejected(reason)`; the only code inside the TEE | Rust → `wasm32-wasip2` on OutLayer (Intel TDX) |
| 2 | Verifier contract | Pins the checker code hash, calls OutLayer, verifies attestation, stores certificates, exposes `is_clean` | NEAR smart contract, `nixo.near` |
| 3 | Data sources | User's confidential history; OFAC + EU + UK + UN + SECO EVM address lists + hacker list | Fixtures in MVP (1Click in v1), `safe-fndn/sanctions-address-lists` release `data-2026-10-29` |
| 4 | Verification SDK | One view call for exchanges; a cross-chain relayer posts certificate digests to registries on other chains | TypeScript / Python SDK, NEAR Chain Signatures for cross-chain |
| 5 | Explainer | Turns the certificate into a plain-English compliance note for users and officers; model never sees the user's history | NEAR AI Cloud, attested with a fresh nonce |

## What is hidden from whom

Only a one-bit verdict ever leaves the enclave. Everything else follows from that.

| Party | Sees | Does not see |
|-------|------|--------------|
| Exchange or app (verifier) | Verdict, list version, check date, expiry, code hash, NEAR account | Balances, counterparties, amounts, transaction history |
| OutLayer operator | That a job ran, its duration, hashes of input and output | Input contents (encrypted to the enclave), output contents |
| NEAR public chain | Certificate: account, verdict, code hash, list version, expiry | Anything about the history behind it |
| NIXO (us) | Nothing at runtime; no server holds user data | The user's history, the verdict, the certificate before it is on-chain |
| User | Everything about their own history and verdict | The checker's internal state beyond its published source |

## More than a TEE badge

NEAR AI's own docs admit a TEE protects data from the server operator but does not protect you if the code inside the TEE has a bug. NIXO's claim is stronger: the code is right, and when it is wrong the damage is bounded and recoverable.

| Measure | What it does | What it defends against |
|---------|--------------|-------------------------|
| Minimal trusted base | The proven core is a pure function under 300 lines; fetching, parsing and encoding sit outside it | Bugs in glue code cannot flip a verdict |
| Reproducible build | Pinned toolchain, `Cargo.lock`, build container; CI publishes the WASM hash and anyone can rebuild and match it | A WASM that does not match its published source |
| Pinned hash on-chain | The contract asks OutLayer to run only the current `checker_hash` and binds the result to it; changes are timelocked (48h on mainnet, 5 min on testnet for the demo) and public | Silent code swaps, including by us |
| Fail closed | Every error path returns `Rejected` with a reason code; `Clean` is reachable only through the proven disjointness check | A bug producing a false clean |
| Local re-run | The checker is deterministic; a user can run the same WASM with wasmtime and compare output hashes | A worker returning a different answer than the code would |
| Revocation + expiry | Certificates expire (7 days default); `revoke_checker_hash` kills every certificate from a version at once | A bug found after certificates were issued |
| Formal verification (Kani) | Proofs that a tainted input is never `Clean`, an empty list is never `Clean`, and disjoint inputs are always `Clean` | Logic bugs in the core rule |

A TEE proves the code was not tampered with. NIXO shows the code is right.

## How NEAR is used

Four NEAR components do real work in the MVP, named in code; Chain Signatures is planned for v1.

- **OutLayer (Intel TDX)** runs the Checker WASM. Code at `/checker`, hash pinned on-chain. OutLayer integration at `/contract/src/outlayer.rs`.
- **NEAR smart contract** (`nixo.testnet`) at `/contract`. Methods: `request_nixo`, `resolve_nixo` (OutLayer callback), `is_clean`, `get_certificate`, `get_config`, `set_checker_hash` (owner, proposes, timelocked), `apply_checker_hash` (anyone, after timelock), `cancel_checker_hash` and `revoke_checker_hash` (owner). Written in Rust with `near-sdk` 5.
- **NEAR Intents 1Click** (v1) will supply the user's confidential history via a session read inside the enclave. In the MVP the history adapter (`load_history` in `/checker/src/shell.rs`) reads simulated fixtures compiled into the WASM.
- **NEAR Chain Signatures (v1)** post certificate digests to registry contracts on Ethereum, Base, Solana and Arbitrum, so a verifier on another chain can read the result without a NEAR integration. Relayer at `/relayer`. Not in the MVP; stub included.
- **NEAR AI Cloud** powers the Explainer. OpenAI-compatible call to `https://cloud-api.near.ai/v1`, attestation fetched with a fresh nonce and verified client-side. Code at `/web/app/api/explain/route.ts`. The model never receives the user's history, only the public certificate, which the server re-reads from chain. The MVP checks that the attestation report echoes the fresh nonce; full quote verification is v1.

## Try it

### Prerequisites

- Node 20+, pnpm 8+ (web); npm (backend)
- Python 3.12+ (agents)
- Rust: the checker pins 1.93.0 (`wasm32-wasip2`), the contract pins 1.95.0; `rust-toolchain.toml` in each crate installs them
- `near-cli-rs` and `cargo-near`: `cargo install --locked near-cli-rs cargo-near`
- `wasmtime` for local re-runs: `brew install wasmtime`
- A free NEAR AI Cloud API key from [cloud.near.ai](https://cloud.near.ai) (or $10 via NEAR Builders)

### Setup

```bash
git clone https://github.com/<your-org>/nixo
cd nixo
cp .env.example .env    # one file for every service; demo keys, NEARAI_API_KEY optional
pnpm setup              # pnpm install (web), npm ci (backend), Python venv + deps (agents)
```

### Running locally

One command starts everything, with the root `.env` exported into each service:

```bash
pnpm dev                # web :3000, agents :8000 (AGENTS_PORT), backend :4000 (BACKEND_PORT)
```

Or one service at a time:

| Service | Command | URL |
|---|---|---|
| web (NIXO pages + `/trade`) | `pnpm dev:web` | http://localhost:3000 |
| agents (FastAPI) | `pnpm dev:agents` | http://localhost:8000/docs |
| backend (NestJS waitlist) | `pnpm dev:backend` | http://localhost:4000 |

Tests: `pnpm test` (checker, contract, agents), `pnpm test:backend`, `pnpm kani`.

### Run the full demo

```bash
pnpm demo               # starts web app at http://localhost:3000
```

Then:

1. Go to `/`. Pick `nixo-alice.testnet` (pre-seeded clean history) → click **Prove my funds are clean** → ✅ Clean certificate in about 1–2 minutes.
2. Switch to `nixo-mallory.testnet` (pre-seeded with a transfer from a demo-flagged address) → ❌ Rejected, reason `list_hit`, no address revealed.
3. Go to `/verify`, paste `nixo-alice.testnet` → live `is_clean` view call → ✅. Expand the Verified panel.

### Run the checker alone

```bash
cd checker
cargo test
cargo build --release --locked --target wasm32-wasip2
# Reproduces the published WASM hash; compare with the on-chain pinned hash:
shasum -a 256 target/wasm32-wasip2/release/nixo_checker.wasm
near contract call-function as-read-only nixo.testnet get_checker_hash json-args '{}' network-config testnet now
```

### Re-run the TEE verdict locally

```bash
printf '{"account":"nixo-alice.testnet"}' | wasmtime run target/wasm32-wasip2/release/nixo_checker.wasm
# or: scripts/run-checker.sh nixo-alice.testnet
# input_hash and verdict must match nixo-alice.testnet's on-chain certificate
```

## Repository layout

```text
nixo/
  checker/                # Rust → WASM, runs in OutLayer TDX enclave (the only TCB)
    src/
      lib.rs              # pure `verdict()` function, proven with Kani
      shell.rs            # I/O around the core: parse, normalize, hash, lists, history adapter
      main.rs             # WASI entry: JSON on stdin, verdict on stdout
    proofs/verdict.rs     # Kani proof harnesses
    lists/                # pinned OFAC/EU/UK/UN/SECO snapshot + hacker list (compiled in)
  contract/               # NEAR smart contract, Rust
    src/
      lib.rs              # request_nixo, resolve_nixo, is_clean, governance
      outlayer.rs         # OutLayer request_execution + result parsing
      tests.rs            # unit tests: fail-closed, expiry, revocation, timelock
  web/                    # one Next.js app
    app/(nixo)/           # / (Prove funds) and /verify (Exchange)
    app/trade/            # trading app from NearArc: /trade, /trade/agent, /trade/settings, /trade/about
    components/VerifiedPanel.tsx
    app/api/request/      # demo signer for the two testnet accounts
    app/api/explain/      # NEAR AI Cloud explainer (certificate only)
    lib/nixo-sdk.ts       # dependency-free view client for is_clean
  agents/                 # FastAPI trading agents (from NearArc): analysis, planner, paper trading, 1Click
  backend/                # NestJS waitlist (from NearArc), isolated, npm
  marketplace/            # Swarma plan docs, parked (no code yet)
  docs/neararc/           # NearArc's original README and notes
  fixtures/               # simulated histories for the two demo accounts
  scripts/                # dev.sh, deploy-testnet.sh, run-checker.sh, update-lists.sh, nearai_smoke.py
  .github/workflows/      # checker, Kani, contract, web, agents, backend
```

## What is real vs. mocked in the MVP

| Piece | Status |
|-------|--------|
| Checker core (`verdict()` function) | Real, pure Rust, Kani-proven |
| OutLayer integration (`request_execution`, callback) | Real, testnet |
| NEAR verifier contract with hash pinning, timelock, revocation, expiry | Real, on `nixo.testnet` |
| Confidential history | **Simulated**: fixtures compiled into the checker for the two demo accounts; unknown accounts fail closed with `history_unavailable`. 1Click session reads are v1 |
| Sanctions lists | Real: OFAC, EU, UK, UN and SECO EVM addresses from `safe-fndn/sanctions-address-lists` release `data-2026-10-29` |
| Hacker list | **Demo only**: one synthetic address so `nixo-mallory.testnet` reliably fails; curated, sourced entries are v1 |
| Hop tracing | Depth 1 (the account and its direct counterparties) over the fixture history |
| NEAR AI Cloud explainer | Real call; attestation fetched with a fresh nonce, full quote verification is v1 |
| Encrypting the session to the enclave key | Not in MVP (no history leaves the enclave because none enters through public input) |
| Chain Signatures cross-chain relayer | Not built, v2 |
| Exchange `/verify` page | Real, calls `is_clean` live |

Nothing is hidden: every mocked piece is tagged in the UI and in the README.

## Formal verification

Kani is a bounded model checker for Rust. The core rule of NIXO is tiny and proven, so a bug in the proven function cannot flip a verdict.

```rust
/// The proven core. Pure, no I/O, no allocation beyond its inputs.
pub fn verdict<A: PartialEq>(traced: &[A], banned: &[A]) -> Verdict {
    if banned.is_empty() {
        return Verdict::Rejected(Reason::ListUnavailable);
    }
    for a in traced {
        if banned.contains(a) {
            return Verdict::Rejected(Reason::ListHit);
        }
    }
    Verdict::Clean
}

// checker/proofs/verdict.rs (lengths are symbolic too, 0..=8)
#[kani::proof]
#[kani::unwind(10)]
fn tainted_is_never_clean() {
    let tb: [u32; N] = kani::any();
    let bb: [u32; N] = kani::any();
    let traced = any_slice(&tb);
    let banned = any_slice(&bb);
    let i: usize = kani::any();
    let j: usize = kani::any();
    kani::assume(i < traced.len() && j < banned.len());
    kani::assume(traced[i] == banned[j]);
    assert!(verdict(traced, banned) != Verdict::Clean);
}
// + empty_list_is_never_clean, disjoint_is_clean, tainted_is_never_clean_addr ([u8; 32])
```

Run the proofs:

```bash
cargo install --locked kani-verifier
cargo kani setup
cd checker
cargo kani                      # VERIFICATION:- SUCCESSFUL
```

CI runs Kani on every push and fails the build if any proof regresses. The Verified panel links to the CI run.

**What this proves:** for all inputs up to the bound (up to 8 traced × 8 banned addresses, and 3 × 3 on the production 32-byte address type), the rule is exactly "Clean iff the list is non-empty and disjoint from the traced set".

**What it does not prove:** that the lists are complete, that hop tracing found every counterparty, or that the shell passed the right data. Those are covered by other measures in the table above.

## Related work

| Who | What they do | Where NIXO differs |
|-----|--------------|--------------------|
| Chainalysis, TRM, Elliptic | Score public on-chain history for venues | See nothing inside a private system; return "unknown." NIXO screens inside |
| Jurat (NEAR hackathon) | TDX enclave proves a confidential balance ≥ X | Proves how much. NIXO proves where the funds did not come from |
| Gateflow (NEAR hackathon) | Sanctions screening on public checkouts | Public inputs only; no verifiable certificate |
| Starknet STRK20 | Token standard with selective disclosure hooks | Disclosure reveals data to the auditor. NIXO reveals only a verdict |
| Privacy Pools (Ethereum) | ZK proof of exclusion from a bad-deposits set | Elegant but single-pool, single-chain. NIXO layers over any private system |
| Zcash viewing keys | Reveal shielded history to a chosen auditor | Reveals everything. NIXO is the layer that would consume one inside a TEE and emit a verdict |

Jurat proves how much you have. NIXO proves where it didn't come from.

## Business model and roadmap

**Who pays:** exchanges and on-ramps pay per verified certificate, the same budget that buys chain-analysis today. Users get the passport free. Wallets (near.com, Meteor, HOT) earn revenue share for integrating a "Prove funds before withdrawing" step.

**Why it is a business, not a feature:** every private system eventually needs this. NIXO ships first on NEAR because Confidential Intents is the largest private pool in crypto, but the checker is chain-agnostic and the certificate is cross-chain via Chain Signatures.

### Roadmap

1. **MVP, Nov 2026** (this repo): checker on OutLayer testnet, pinned-hash contract, OFAC/EU/UK/UN/SECO lists + demo hacker list at depth 1, clean vs tainted demo, Kani proofs, Verified panel and explainer.
2. **v1, Q1 2027:** mainnet contract, multisig governance, real 1Click history adapter inside the enclave, curated hacker list with sources, depth 2, TypeScript and Python SDKs, external audit, near.com withdrawal pilot.
3. **v2, H2 2027:** Chain Signatures relayer live on Base, Solana and Arbitrum; Zcash viewing-key adapter; auditor view keys and income proofs; a ZK path for the core check; council governance.

## Hackathon disclosure

- **Window:** all commits in this repo are between the hackathon announcement on 2026-10-19 and the submission deadline on 2026-11-14 23:59 UTC (Q-001, Q-003). First commit: see `git log`. A `pre-hackathon` tag is set at the initial scaffold; the `hackathon-submission` tag marks the submission commit. Compare the diff on GitHub for what was built in the window.
- **Pre-hackathon code (Q-002, Q-005):** no prior product is being resubmitted. External libraries used as-is: `near-sdk`, `near-api-js`, `kani-verifier`, `safe-fndn/sanctions-address-lists` (data), OutLayer example templates. AI coding assistants were used. Nothing proprietary from earlier work ships in this repo.
- **Other submission by this author:** none / name and link if any (Q-015).

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgements

- NEAR Protocol, for making privacy the default and creating the exact problem NIXO solves.
- FastNEAR for OutLayer.
- The Model Checking team for Kani.
- Safe Foundation for maintaining a clean, dated extraction of OFAC crypto addresses.

## Links

- Demo video / X post: link here after posting
- [OutLayer](https://app.outlayer.ai/docs)
- [NEAR AI Cloud](https://docs.near.ai/cloud/quickstart)
- [Confidential Intents](https://docs.near-intents.org/integration/market-makers/confidential-intents)
- [Kani](https://model-checking.github.io/kani/)
