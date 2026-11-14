# NIXO — End-to-End Product Summary (NEAR Hackathon, Nov 2026)

> Context for an AI assistant: this is a complete description of a hackathon project called **NIXO**, built for the NEAR Hackathon (1–14 Nov 2026), primary track **Privacy & Private AI**, secondary tracks Real-World Money and AI Security & Defense. Use it to answer questions, write pitch copy, critique the product, or plan next steps. Everything below was verified against the actual repository and the live NEAR testnet contract on 14 Nov 2026 (submission day).

---

## 1. What the product is

**One-line pitch:** *"Prove your money is clean without proving where it's been."*

NIXO is a **clean-funds passport for private money on NEAR**. NEAR's Confidential Intents made balances, swaps and payments private by default, which creates a compliance gap: exchanges and on-ramps cannot screen funds they cannot see, so they reject them. NIXO closes that gap without undoing the privacy.

**How it works, end to end:**

1. A user calls `request_nixo` on the NIXO smart contract. The only public input is their account id.
2. The contract asks **OutLayer** (NEAR's Intel TDX enclave compute service, run by FastNEAR) to execute a pinned **Checker** WASM, identified on-chain by URL + SHA-256 hash.
3. Inside the enclave, the Checker loads the account's transaction history, screens the account and every counterparty against sanctions lists (OFAC, EU, UK, UN, SECO) plus a known-hacker list, and traces backwards up to 6 hops through NEAR transfers and Ref Finance pool hops looking for a path to a listed address.
4. The Checker outputs **only a one-bit verdict** (`clean` / `warn` / `rejected`) plus a reason code and hop count. Never an address, never an amount, never a path.
5. The contract's callback `resolve_nixo` accepts the result only if it came from the pinned, unrevoked checker hash and matches the requesting account, then stores a **short-lived certificate** (7-day TTL). Anything unexpected stores nothing (fail-closed).
6. Any exchange, on any chain, calls `is_clean(account)` and gets a boolean. A "Verified" panel links the WASM hash, the OutLayer attestation, the sanctions-list snapshot hash, and the passing Kani formal-verification proof.

**The core differentiator vs. a plain "TEE badge":** NIXO argues the code is *correct*, not just untampered. The verdict logic is a pure Rust function under 300 lines, formally verified with **Kani** (bounded model checker), with a reproducible build, hash pinned on-chain behind a timelock, fail-closed error handling, revocation + expiry, and local re-runnability with `wasmtime`.

**Tagline vs. the nearest competitor (Jurat, another NEAR hackathon entry):** "Jurat proves how much you have. NIXO proves where it didn't come from."

### What else is in the repo (secondary surface)

The web app is positioned as a **"desk"**: a dashboard where the clean-funds certificate sits next to a trading surface. This trading code was imported from an earlier project the same author started for this hackathon called **NearArc**, and merged under `/dashboard/trade`:

- **AI trading agents** (Python FastAPI): market-regime analysis (ATR, ADX, volatility, MA slope), strategy shortlisting, LLM planner (Claude via Anthropic SDK, with a rule-based fallback), paper-trading engine with TP/SL, liquidation, risk gate.
- **Paper orders priced by real NEAR Intents 1Click dry-run quotes**, so fees and slippage are real while leverage is simulated.
- **Live mainnet spot swaps** NEAR/USDC via 1Click, signed in a NEAR wallet, tracked to SUCCESS/REFUNDED/FAILED.
- **NestJS waitlist backend** for the landing page form.
- **Swarma** (a group-buying market for GPU hours, AI Swarms track): planning documents only, parked, no code.

The product narrative that ties them together: clean deposits fund agents and vaults; the sidebar shows "Agents & vaults — funded by clean deposits" and "Viewing keys — sell access to trades" as *coming soon*.

---

## 2. Technologies used

| Layer | Technology | Notes |
|---|---|---|
| **Checker (the trusted core)** | Rust 1.93.0 → `wasm32-wasip2` | Pure `verdict()` function + pure `trace::search()`; runs inside OutLayer Intel TDX enclave. ~1,100 lines total including proofs. |
| **Formal verification** | Kani (`kani-verifier`) | 4 list-rule harnesses + 4 multi-hop search harnesses; runs in CI via `model-checking/kani-github-action`. |
| **Smart contract** | Rust, `near-sdk` 5, `cargo-near` | Deployed at `nixo.testnet`. ~485 lines. Methods: `request_nixo`, `resolve_nixo`, `is_clean`, `get_certificate`, `get_config`, `get_checker_hash`, `is_revoked`, `set_checker_hash`, `apply_checker_hash`, `cancel_checker_hash`, `revoke_checker_hash`. |
| **Confidential compute** | OutLayer (FastNEAR), Intel TDX, DCAP attestation | Contract calls `outlayer.testnet::request_execution` with `WasmUrl` source pinned by SHA-256; WASM hosted on `test.fastfs.io`. |
| **Sanctions data** | `safe-fndn/sanctions-address-lists` release `data-2026-10-29` | OFAC, EU, UK, UN, SECO EVM address lists compiled into the WASM; list hash recorded in each certificate. |
| **Hacker list** | One real entry | Binance-hack (29 Oct 2026) stolen-funds wallet, attributed by AMLBot / Shridlock, consistent with Elliptic. Explicitly flagged as unofficial attribution. |
| **History data** | NearBlocks API v3 | `scripts/fetch-history.ts` pulls receipts and Ref Finance swaps for mainnet accounts, cached in `fixtures/mainnet/`. |
| **Web app** | Next.js 16.4 (App Router), React 19.3, TypeScript, Tailwind 4.3, GSAP, lucide-react | One app: landing, `/dashboard` (overview, swap, clean-funds, settings), `/verify` (exchange view). |
| **Wallets** | `@near-wallet-selector` 10.x | Meteor, HERE, Intear, MyNearWallet, Nightly, Sender. `near-api-js` 7.5. |
| **In-browser checker preview** | Same Rust checker built for `wasm32-wasip1`, run via Node WASI | Powers "Check any NEAR wallet" on `/verify`. Different hash from the enclave build. |
| **AI explainer** | NEAR AI Cloud (OpenAI-compatible API), model `deepseek-ai/DeepSeek-V3.1` | Turns the public certificate into a plain-English compliance note. Fetches attestation report with fresh nonce. Model never sees history. |
| **Trading agents** | Python 3.12, FastAPI, uvicorn, pytest, ruff; Anthropic SDK (`claude-opus-5-5`) | Imported from NearArc. Rule-based fallback when no API key. |
| **Backend** | NestJS 12 (ESM), Vitest, oxlint | Waitlist only. Isolated with npm. |
| **Monorepo / tooling** | pnpm workspace (web), npm (backend), Python venv (agents); single root `.env`; `scripts/dev.sh` | `pnpm dev` starts web :3000, agents :8000, backend :4000. |
| **CI** | GitHub Actions, 6 jobs | checker (test + build + publish WASM hash), kani, contract tests, web lint+build, agents ruff+pytest, backend lint+test+build. |
| **Planned, not built** | NEAR Chain Signatures relayer (Ethereum, Base, Solana, Arbitrum registries); NEAR Intents 1Click history adapter inside the enclave | Stubbed/described in README only. |

---

## 3. Who it is for

**Primary users (pay nothing):**
- Holders of private NEAR funds (Confidential Intents users) who need to withdraw to an exchange, on-ramp, or regulated venue and want to prove cleanliness without disclosing their history.

**Primary customers (who pay):**
- **Exchanges and on-ramps.** They pay per verified certificate, out of the same budget that currently buys Chainalysis / TRM / Elliptic screening. For them NIXO is one view call, `is_clean(account)`, and a Verified panel for the compliance officer.
- **Wallets** (near.com, Meteor, HOT) earn revenue share by integrating a "Prove funds before withdrawing" step.

**Secondary audiences:**
- **Compliance officers** who get a plain-English note (the explainer) and a cryptographic audit trail (attestation, list hash, WASM hash, Kani proof link).
- **Regulators**, indirectly: NIXO is the argument that a privacy system can separate honest users from launderers, which is what Tornado Cash lacked.
- **Developers** who can run the checker locally with `wasmtime`, rebuild the WASM to match the on-chain hash, and run the Kani proofs.
- **Hackathon judges**, who get a 90-second no-wallet demo with two pre-seeded testnet accounts (one clean, one tainted).

**Why NEAR first:** Confidential Intents is described as the largest private pool in crypto (~42% of NEAR trading volume). But the checker is chain-agnostic and the certificate is designed to go cross-chain via Chain Signatures.

---

## 4. Pros and cons today

### Pros

1. **Real, genuinely novel positioning.** Proof-of-non-origin for private funds is a clear gap; the competitive table (Chainalysis, Jurat, Gateflow, Privacy Pools, Zcash viewing keys) is well argued.
2. **Deployed and working on testnet.** Verified live on 14 Nov 2026: `nixo.testnet` has code, config shows owner `nixo.testnet`, OutLayer `outlayer.testnet`, pinned checker hash `e0c79a99…bed6`, a 5-minute timelock and 7-day certificate TTL. Both demo accounts hold valid certificates: `nixo-alice.testnet` is `clean`, `nixo-mallory.testnet` is `rejected`.
3. **Minimal trusted computing base, formally verified.** Pure verdict and trace functions, 8 Kani proof harnesses, run in CI. This is the most defensible technical claim in the project and a real step beyond "it runs in a TEE."
4. **Strong fail-closed design.** Every error path returns `Rejected` with a reason code; the contract refuses caller-supplied histories, mismatched accounts, revoked hashes and malformed verdicts.
5. **Governance already modeled.** Timelocked hash changes, cancel, revoke-by-version (kills all certificates from a buggy checker at once), expiry.
6. **Real data where it matters.** Real sanctions lists with a dated snapshot and hash; a real mainnet laundering trail (`farstreet4572.near`) traced 4 hops back to the Binance-hack wallet; the "Check any wallet" preview works on arbitrary mainnet accounts with per-hop amounts and explorer links.
7. **Honest disclosure.** The README has an explicit "real vs. mocked" table and the UI tags mocked pieces. Judges reward this.
8. **Privacy model clearly stated.** The "what is hidden from whom" table covers exchange, OutLayer operator, public chain, NIXO itself, and user.
9. **Clean developer experience.** One `.env`, `pnpm setup`, `pnpm dev`, `pnpm demo`, `pnpm test`, `pnpm kani`, reproducible WASM hash, 6-job CI.
10. **Reasonable business model.** Exchanges pay, users don't, wallets get rev-share. Roadmap to mainnet, audit, SDKs, cross-chain.

### Cons

1. **The hardest part is still mocked.** Certified histories are compiled into the WASM as fixtures. The enclave does *not* fetch the user's real confidential history from 1Click yet. Until it does, NIXO is a verifiable screening *pipeline*, not yet a product that can certify an arbitrary user.
2. **Only two certifiable accounts.** `nixo-alice.testnet` (synthetic clean) and `nixo-mallory.testnet` (replay of a real trail). Any other account fails closed with `history_unavailable`.
3. **The deployed checker is behind the source.** The on-chain certificates were issued by checker `0.1.0` with `trace_depth: 1`, and mallory's reason is `list_hit`. The README and landing page describe `taint_path`, 4 hops, depth 6. The current source supports this, but the WASM pinned on `nixo.testnet` has not been redeployed with it. A judge comparing the README to the live certificate will notice.
4. **The "Check any wallet" preview is not certifiable, and its hash differs.** It runs outside the TEE with a `wasm32-wasip1` build, so it is a different artifact from the one pinned on-chain. The README explains this, but it weakens the "re-run and compare hashes" story for the most impressive demo feature.
5. **Hop tracing has gaps.** Only NEAR native transfers and Ref Finance pool hops are traced. Not traced: other token transfers, other DEXes, bridges, `intents.near` balances (these inflows fail closed). Real launderers use exactly these routes.
6. **Hacker list is one entry with unofficial attribution.** Sanctions lists are real, but the "known hacker" list that makes the demo dramatic is a single wallet attributed by X-based analysts, not a curated or sourced list.
7. **Kani proofs are bounded and narrow.** Up to 8×8 addresses and 4-node graphs. They prove the algorithm's logic, not that the fetcher found every inflow, that lists are complete, or that the shell passed the right data. The README says this, but marketing copy ("the code is right") overstates it.
8. **TEE attestation is only partially verified.** The NEAR AI explainer checks that the attestation echoes the nonce; full quote verification is v1. The OutLayer attestation link is shown but not independently verified by the contract.
9. **Session encryption to the enclave is not implemented.** Justified for the MVP because no history enters through public input, but it is a hard requirement before real 1Click histories flow.
10. **Chain Signatures cross-chain relayer does not exist.** It is a headline feature of the pitch ("any exchange on any chain") and is stub/README only.
11. **Scope dilution.** The repo carries a full AI trading desk, a NestJS waitlist, and Swarma planning docs alongside NIXO. The trading pieces are competent but unrelated to the clean-funds thesis, still call Anthropic rather than NEAR AI (the `.env` says the switch is pending), and increase surface area a judge must understand. The narrative glue ("clean deposits fund agents") is a sidebar item marked *coming soon*.
12. **Submission-day loose ends.** 28 modified files and 3 new component folders are uncommitted; README placeholders remain (`https://github.com/<your-org>/nixo`, "Live demo: hosted URL here", "Demo video / X post: link here"); the `pre-hackathon` and `hackathon-submission` tags referenced in the README are not visible in the log; the demo-step numbering in the README is out of order (1, 2, 4, 3).
13. **No external audit, no mainnet, single-owner governance.** Expected for a hackathon, but every "the code is right" claim rests on the author's own tests and proofs.

---

## 5. Completeness today

### Overall assessment

**Roughly 70% of the stated MVP is real and working; the remaining 30% is the piece that would make it a product (real history inside the enclave).** The architecture, contract, proofs, governance, data pipeline, and UI are all in place and verifiable. The gap is that the enclave screens pre-baked histories rather than fetching the user's own.

### Component-by-component

| Component | Status | Evidence |
|---|---|---|
| Checker core `verdict()` | ✅ Done, Kani-proven | `checker/src/lib.rs`, 4 harnesses |
| Multi-hop `trace::search()` up to 6 hops | ✅ Done in source, Kani-proven on small graphs | `checker/src/trace.rs`, 4 harnesses |
| Checker shell: parse, normalize, hash lists, history adapter | ✅ Done | `checker/src/shell.rs`, 617 lines, unit tests |
| Sanctions lists compiled in with snapshot + hash | ✅ Done, real data | `checker/lists/`, snapshot `data-2026-10-29` |
| Hacker list | ⚠️ Real but one entry, unofficial | `checker/lists/hackers.txt` |
| NEAR verifier contract | ✅ Done, deployed `nixo.testnet` | Hash pinning, timelock, cancel, revoke, expiry, fail-closed, events, unit tests |
| OutLayer integration (`request_execution` + callback) | ✅ Done, real on testnet | `contract/src/outlayer.rs`; live certificates exist |
| **Pinned WASM up to date with source** | ❌ Behind | Live certs show `trace_depth: 1`, `list_hit`; source does depth 6 / `taint_path` |
| Demo flow: two accounts, Prove → certificate | ✅ Done | Both certificates live and valid |
| Wallet-connect flow (sign `request_nixo` yourself) | ✅ Done (uncommitted) | `dashboard/clean-funds/page.tsx` supports wallet or demo signer |
| `/verify` exchange view, live `is_clean` | ✅ Done | `web/lib/nixo-sdk.ts` dependency-free view client |
| Verified panel (WASM hash, attestation link, list hashes, Kani link) | ✅ Done | `components/VerifiedPanel.tsx` |
| "Check any NEAR wallet" mainnet preview with hop path | ✅ Done, preview only (not certifiable) | `api/check`, `lib/history/fetcher.ts`, `lib/checker/run.ts` |
| Real mainnet history fetch + cache | ✅ Done, outside the TEE | `scripts/fetch-history.ts`, `fixtures/mainnet/` (~26 cached accounts) |
| NEAR AI Cloud explainer | ✅ Done, partial attestation check | `api/explain/route.ts` |
| Landing page + dashboard shell | ✅ Done (uncommitted, 736 lines added today) | `components/landing/`, `components/dashboard/` |
| Trading desk `/dashboard/trade` (paper + live 1Click swaps) | ✅ Done, imported from NearArc | FastAPI agents + web proxy |
| AI planner on NEAR AI instead of Anthropic | ❌ Not switched | `agents/app/trading/planner.py` still uses Anthropic SDK |
| "Agents & vaults", "Viewing keys" | ❌ Coming soon (sidebar stubs) | `Sidebar.tsx` `soon: true` |
| 1Click history adapter inside the enclave | ❌ v1 | README |
| Session encryption to enclave key | ❌ v1 | README |
| Full TEE quote verification | ❌ v1 | README |
| Chain Signatures cross-chain relayer | ❌ v2, no code | README says "Relayer at `/relayer`" but no such folder exists |
| TypeScript / Python SDK packages | ❌ v1 | Only the in-app `nixo-sdk.ts` exists |
| Swarma GPU marketplace | ❌ Planning docs only, parked | `marketplace/` |
| CI (6 jobs) | ✅ Defined | `.github/workflows/ci.yml`; green status not verifiable from local repo |
| Tests | ✅ Present | checker unit tests, contract unit tests (fail-closed, expiry, revocation, timelock), agents pytest, backend vitest |
| Hosted demo URL, demo video, repo URL, git tags | ❌ Placeholders | README |
| Mainnet, multisig, audit | ❌ Roadmap Q1 2027 | README |

### Timeline

- First commit: 12 Nov 2026 (README). 7 more commits on 13 Nov. Substantial uncommitted work on 14 Nov (landing, dashboard, wallet flow, mainnet history check).
- Hackathon window: 19 Oct – 14 Nov 2026, 23:59 UTC.

### Roadmap as stated

1. **MVP (Nov 2026, this repo):** checker on OutLayer testnet, pinned-hash contract, real lists, clean vs. tainted demo, Kani proofs, Verified panel, explainer.
2. **v1 (Q1 2027):** mainnet contract, multisig governance, real 1Click history adapter inside the enclave, curated hacker list, TS + Python SDKs, external audit, near.com withdrawal pilot.
3. **v2 (H2 2027):** Chain Signatures relayer on Base/Solana/Arbitrum, Zcash viewing-key adapter, auditor view keys and income proofs, ZK path for the core check, council governance.

---

## 6. Quick reference

- **Contract:** `nixo.testnet` (owner `nixo.testnet`, OutLayer `outlayer.testnet`)
- **Pinned checker hash (live):** `e0c79a99a71cd648fbd2449d9b0518ab4e7e2ec53d6126e49954dc322911bed6`
- **List snapshot (live):** `data-2026-10-29`, hash `dd83cfea…ce10`
- **Demo accounts:** `nixo-alice.testnet` (clean), `nixo-mallory.testnet` (rejected)
- **Mainnet trail used for the tainted demo:** `farstreet4572.near` → 4 hops → Binance-hack wallet `efd2…e5af`
- **Key commands:** `pnpm setup`, `pnpm dev`, `pnpm demo`, `pnpm test`, `pnpm kani`, `pnpm build:checker`, `scripts/run-checker.sh <account>`
- **License:** MIT
