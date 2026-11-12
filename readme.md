# NIXO: a clean-funds passport for private money

> Prove your money is clean without proving where it's been.

NIXO is a compliance layer for private money on NEAR. A sealed Intel TDX enclave checks a user's confidential transaction history against sanctions and known-hacker lists, and outputs only a signed verdict. A NEAR contract records that verdict as a short-lived certificate, and any exchange on any chain can verify it with one call, without ever seeing balances or counterparties.

Built for **NEAR HACKATHON** (1–14 Nov 2026). Tracks: **Privacy & Private AI** (primary), Real-World Money, AI Security & Defense.

- **Live demo:** hosted URL here
- **Verifier contract:** `nixo.testnet` (mainnet `nixo.near` at v1)
- **Checker source:** `/checker` in this repo, pinned by hash on-chain
- **Kani proofs:** `/proofs`, CI badge above
- **License:** MIT

## Judge it in 90 seconds

No real funds, no keys, no mainnet. Two pre-seeded testnet wallets, one clean and one tainted.

```bash
git clone https://github.com/<your-org>/nixo
cd nixo
pnpm install
pnpm demo
```

`pnpm demo` opens `http://localhost:3000`:

1. Click **Get NIXO** as `alice.testnet` → ~15s later, ✅ Clean certificate.
2. Switch to `mallory.testnet` (tainted history, received from a seeded demo-flagged address) → ❌ Rejected, reason `list_hit`.
3. Open `/verify`, paste `alice.testnet` → live `is_clean` call to the NIXO contract returns ✅. Expand the Verified panel to see the WASM hash, the OutLayer attestation link, the list snapshots with hashes, and a link to the passing Kani proof.

That's the whole demo. The sections below explain what each piece is and how it is built.

## The problem

NEAR made money private by default. Since late August 2026, balances, swaps and payments on near.com run through Confidential Intents, and since 27 October every 1Click swap settles on the private shard. Confidential activity is already about 42% of NEAR's trading volume.

But private money has a fatal gap: it cannot prove it is clean. Exchanges reject funds they cannot screen, because chain-analysis tools see nothing inside a private system. Regulators sanction privacy tools that cannot separate honest users from launderers, which is why Tornado Cash was sanctioned in 2022 and its developers prosecuted. And North Korea is laundering the $6.3B Binance haul through DeFi, bridges and memecoins right now, so every private system is under scrutiny as a possible route.

Honest users face a false choice: expose their entire financial history, or get rejected. NIXO fixes that.

## How NIXO works

1. The user signs a 1Click session in their wallet and encrypts it to the enclave's derived key.
2. The user calls `request_nixo` on the NIXO contract, which hands the job to OutLayer via NEAR's yield/resume flow.
3. Inside an Intel TDX enclave, the Checker (Rust to WASM, under 300 lines) decrypts the session, reads the user's confidential history from 1Click, fetches pinned sanctions and hacker lists, traces counterparties for 1–2 hops, and emits a verdict.
4. OutLayer returns the result with a TDX attestation chained to Intel's root certificate.
5. The contract verifies the attestation against its pinned `checker_hash`, stores a short-lived certificate, and emits a `NixoRequested` / `NixoResolved` event.
6. Any exchange on any chain calls `is_clean(account)` and gets ✅ or ❌, plus a Verified panel linking the attestation, list snapshots, Kani proofs and WASM hash.

| # | Component | What it does | Tech |
|---|-----------|--------------|------|
| 1 | Checker | Deterministic Rust rule; returns `Clean` or `Rejected(reason)`; the only code inside the TEE | Rust → `wasm32-wasip2` on OutLayer (Intel TDX) |
| 2 | Verifier contract | Pins the checker code hash, calls OutLayer, verifies attestation, stores certificates, exposes `is_clean` | NEAR smart contract, `nixo.near` |
| 3 | Data sources | User's confidential history; OFAC + EU + UN + hacker lists; public chain data for hop tracing | NEAR Intents 1Click, `safe-fndn/sanctions-address-lists`, public RPCs |
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
| Pinned hash on-chain | The contract accepts results only from the current `checker_hash`; changes are timelocked 48h and public | Silent code swaps, including by us |
| Fail closed | Every error path returns `Rejected` with a reason code; `Clean` is reachable only through the proven disjointness check | A bug producing a false clean |
| Local re-run | The checker is deterministic; a user can run the same WASM with wasmtime and compare output hashes | A worker returning a different answer than the code would |
| Revocation + expiry | Certificates expire (7 days default); `revoke_checker_hash` kills every certificate from a version at once | A bug found after certificates were issued |
| Formal verification (Kani) | Mathematical proof that if any traced address is on the banned list, the verdict is never `Clean` | Logic bugs in the core rule |

A TEE proves the code was not tampered with. NIXO shows the code is right.

## How NEAR is used

Five NEAR components do real work here, named in code.

- **OutLayer (Intel TDX)** runs the Checker WASM and returns a signed attestation. Code at `/checker`, WASM published on each release, hash pinned on-chain. OutLayer integration at `/contract/src/outlayer.rs`.
- **NEAR smart contract** (`nixo.testnet`) at `/contract`. Methods: `request_nixo`, `resolve_nixo` (yield/resume callback), `is_clean`, `get_certificate`, `set_checker_hash` (owner, timelocked), `revoke_checker_hash` (owner). Written in Rust with `near-sdk`.
- **NEAR Intents 1Click** supplies the user's confidential balance and history via a signed session, encrypted to the enclave's derived key. Adapter at `/checker/src/sources/intents.rs`. Testnet uses 1Click dry-run quotes; mainnet uses real session reads.
- **NEAR Chain Signatures (v1)** post certificate digests to registry contracts on Ethereum, Base, Solana and Arbitrum, so a verifier on another chain can read the result without a NEAR integration. Relayer at `/relayer`. Not in the MVP; stub included.
- **NEAR AI Cloud** powers the Explainer. OpenAI-compatible call to `https://cloud-api.near.ai/v1`, attestation fetched with a fresh nonce and verified client-side. Code at `/web/lib/explainer.ts`. The model never receives the user's history, only the public certificate.

## Try it

### Prerequisites

- Node 20, pnpm 9
- Rust 1.82 with `wasm32-wasip2` target: `rustup target add wasm32-wasip2`
- `near-cli-rs`: `cargo install near-cli-rs`
- A free NEAR AI Cloud API key from [cloud.near.ai](https://cloud.near.ai) (or $10 via NEAR Builders)

### Setup

```bash
git clone https://github.com/<your-org>/nixo
cd nixo
pnpm install
cp .env.example .env   # fill in NEARAI_API_KEY and OUTLAYER_PROJECT_ID
```

### Run the full demo

```bash
pnpm demo               # starts web app at http://localhost:3000
```

Then:

1. Go to `/`. Pick `alice.testnet` (pre-seeded clean history) → click **Get NIXO** → ✅ Clean certificate in ~15s.
2. Switch to `mallory.testnet` (pre-seeded with a transfer from a demo-flagged address) → ❌ Rejected, reason `list_hit`, no address revealed.
3. Go to `/verify`, paste `alice.testnet` → live `is_clean` view call → ✅. Expand the Verified panel.

### Run the checker alone

```bash
cd checker
cargo build --release --target wasm32-wasip2
# Reproduces the published WASM hash; compare with the on-chain pinned hash:
sha256sum target/wasm32-wasip2/release/nixo_checker.wasm
near view nixo.testnet get_checker_hash
```

### Re-run the TEE verdict locally

```bash
wasmtime run target/wasm32-wasip2/release/nixo_checker.wasm \
  --input fixtures/alice.json
# Output hash must match the one in alice's certificate
```

## Repository layout

```text
nixo/
  checker/            # Rust → WASM, runs in OutLayer TDX enclave (the only TCB)
    src/
      lib.rs          # pure `verdict()` function, proven with Kani
      sources/        # intents, sanctions, chain-data adapters
      shell.rs        # I/O around the pure core
    proofs/           # Kani proof harnesses
  contract/           # NEAR smart contract, Rust
    src/
      lib.rs          # request_nixo, resolve_nixo, is_clean, governance
      outlayer.rs     # yield/resume + attestation verification
  relayer/            # Chain Signatures relayer (v1, stubbed in MVP)
  web/                # Next.js app: / (Get NIXO) and /verify (Exchange)
    components/VerifiedPanel.tsx
    lib/
      explainer.ts    # NEAR AI Cloud call + attestation verification
      nixo-sdk.ts     # view-only client for is_clean
  fixtures/           # alice + mallory seed data for the demo
  .github/workflows/  # build, test, Kani proof, publish WASM hash
```

## What is real vs. mocked in the MVP

| Piece | Status |
|-------|--------|
| Checker core (`verdict()` function) | Real, pure Rust, Kani-proven |
| OutLayer integration (register, call, attestation) | Real, testnet |
| NEAR verifier contract with hash pinning, timelock, revocation | Real, on `nixo.testnet` |
| 1Click session + history adapter | Hybrid: real signed session, real 1Click dry-run; history is fetched where endpoints allow, simulated from fixtures otherwise |
| OFAC sanctions list | Real, pinned snapshot from `safe-fndn/sanctions-address-lists` |
| Hacker list | Real, small curated set (Lazarus, Bybit, Binance, DMM) + one seeded demo address so `mallory.testnet` reliably fails |
| Hop tracing | Real on NEAR, Ethereum, Solana testnets; depth 1 in the MVP |
| NEAR AI Cloud explainer with attestation | Real |
| Chain Signatures cross-chain relayer | Stub, v1 feature |
| Exchange `/verify` page | Real, calls `is_clean` live |

Nothing is hidden: every mocked piece is tagged in the UI and in the README.

## Formal verification

Kani is a bounded model checker for Rust. The core rule of NIXO is tiny and proven, so a bug in the proven function cannot flip a verdict.

```rust
/// The proven core. Pure, no I/O, no allocation beyond its inputs.
pub fn verdict(traced: &[Addr], banned: &[Addr]) -> Verdict {
    for a in traced {
        if banned.contains(a) {
            return Verdict::Rejected(Reason::ListHit);
        }
    }
    Verdict::Clean
}

#[cfg(kani)]
#[kani::proof]
#[kani::unwind(9)]
fn tainted_is_never_clean() {
    let traced: [Addr; 8] = kani::any();
    let banned: [Addr; 8] = kani::any();
    let i: usize = kani::any();
    let j: usize = kani::any();
    kani::assume(i < 8 && j < 8);
    kani::assume(traced[i] == banned[j]);
    assert!(matches!(verdict(&traced, &banned), Verdict::Rejected(_)));
}
```

Run the proofs:

```bash
cargo install --locked kani-verifier
cargo kani setup
cd checker
cargo kani                      # VERIFICATION:- SUCCESSFUL
```

CI runs Kani on every push and fails the build if any proof regresses. The CI badge in the Verified panel links to the latest green run for the current `checker_hash`.

**What this proves:** for all inputs up to the bound (8 traced × 8 banned addresses, raised in CI as time allows), the disjointness rule is implemented correctly.

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

**Who pays:** exchanges and on-ramps pay per verified certificate, the same budget that buys chain-analysis today. Users get the passport free. Wallets (near.com, Meteor, HOT) earn revenue share for integrating a "Get NIXO before withdrawing" step.

**Why it is a business, not a feature:** every private system eventually needs this. NIXO ships first on NEAR because Confidential Intents is the largest private pool in crypto, but the checker is chain-agnostic and the certificate is cross-chain via Chain Signatures.

### Roadmap

1. **MVP, Nov 2026** (this repo): checker on OutLayer testnet, pinned-hash contract, OFAC + demo hacker list at depth 1, clean vs tainted demo, Kani proofs, Verified panel and explainer.
2. **v1, Q1 2027:** mainnet contract, multisig governance, real 1Click history adapter, depth 2 with EU + UN lists, TypeScript and Python SDKs, external audit, near.com withdrawal pilot.
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
- Technical design doc: link to the design doc
- [OutLayer](https://outlayer.fastnear.com/docs)
- [NEAR AI Cloud](https://docs.near.ai/cloud/quickstart)
- [Confidential Intents](https://docs.near-intents.org/integration/market-makers/confidential-intents)
- [Kani](https://model-checking.github.io/kani/)
