# NIXO — End-to-End Product Summary (NEAR Hackathon, Nov 2026)

> Context for an AI assistant: this describes **NIXO**, built for the NEAR Hackathon (window through 14 Nov 2026), primary track **Privacy & Private AI**, also aimed at Unstoppable DeFi, AI Security and Defense, and Agent Economy. The agreed product for this version is **`NIXO_PRD.md`** (three layers: fund tracer, deposit vault + AI agent, solver gate). Use this file for pitch copy, critique, or next steps. Status below was re-checked against the repo and live `nixo.testnet` on **14 Nov 2026 (evening, Asia/Calcutta)**.

---

## Current status (checked now)

**Verdict:** Layer 1 tracer logic is now **depth-6 / `taint_path`-real** in source and the newly built WASM (`0.2.0`); on-chain pin was **proposed** and is activating after the 5‑minute timelock. Certified histories are still **labelled fixtures** (Mallory = real mainnet trail replay); live NearBlocks fetch **inside** the enclave is not shipped yet. Layer 2 off-chain experiment works; Layer 3 not started.

### Why Layer 1 was “partial” (and what changed)

| Gap | Why it was true | Status now |
|---|---|---|
| Certified histories are fixtures | Enclave `load_history()` only reads WASM-compiled Alice/Mallory JSON — no `wasi:http` NearBlocks client yet | Still fixtures for certify; Mallory fixture **rewritten** from documented mainnet txs (not an empty placeholder) |
| No live NearBlocks in enclave | Checker `Cargo.toml` has no HTTP client; OutLayer P2 + secrets not wired for indexer key | **Still open** (PRD §4.1); OutLayer project `nixo.testnet/nixo-checker` created for that next |
| Pinned WASM `0.1.0` / `trace_depth: 1` / Mallory `list_hit` | Live pin was an older build; repo `mallory.json` was a placeholder so a rebuild would not match the pitch | **Local WASM `0.2.0`:** Alice `clean`, Mallory `rejected` / **`taint_path`**, **`hops: 4`**, **`trace_depth: 6`**. Hash `574b8182…2211` uploaded to FastFS; `set_checker_hash` proposed; apply after timelock then re-certify |

| PRD layer | Status | What’s real | What’s not |
|---|---|---|---|
| **1 — Fund tracer** | **Live fetch coded (0.3.0); pin/certs lag deploy** | Checker `0.3.0` fetches NearBlocks v3 inside the enclave (`live.rs` + wasi:http); fixtures only if `NIXO_OFFLINE=1`; terminals; network match; fail-closed on fetch errors. Offline wasmtime: Alice clean / Mallory `taint_path` depth 6 | On-chain pin still older build until rebuild+upload+apply+re-certify. OutLayer TEE runs were failing earlier; inject `NEARBLOCKS_API_KEY` as OutLayer secret before relying on live certify |
| **2 — Vault + AI agent** | **Off-chain MVP live** | `/dashboard/agents` experiment; caps, revoke, adversarial suite | On-chain vault + `is_clean` gate; viewing keys |
| **3 — Solver infrastructure** | **Not started** | Copy only | Mock solver / SDK |

**Live contract snapshot (14 Nov 2026, evening):**

- Contract: `nixo.testnet` · OutLayer: `outlayer.testnet` · owner: `nixo.testnet`
- **Active pin (applied):** `574b818291b253645db7d7d2f280494406391e4907e0d2180e05653ee6052211` (checker `0.2.0`, FastFS URL matching)
- Contract redeployed with higher OutLayer limits (50B instructions / 256MB / 60s)
- **Stored certificates still old** (`0.1.0` / depth 1 / Mallory `list_hit`): re-`request_nixo` for Alice failed twice tonight with OutLayer `Execution promise failed` / `nixo_failed: no_result`. Same failure on OutLayer CLI for **both** the new and the previous WASM — looks like a worker/timeout issue on testnet, not a local verdict bug.
- **Local proof (wasmtime on the pinned bytes):** Alice `clean`, Mallory `rejected` / `taint_path` / `hops: 4` / `trace_depth: 6` / `checker_version: 0.2.0` / `history_source: fixture`
- Next: when OutLayer accepts runs again, re-certify Alice + Mallory; then implement live NearBlocks via `wasi:http` + author secret

**Repo momentum:** Layer 1 fixture + WASM + on-chain pin updated; TEE re-issue blocked by OutLayer. Viewing keys still **Soon**.

**Honest cut order if time runs out (from PRD §8):** keep dry-run Intents + vault gate → say model is not in enclave if needed → one delayed viewing key → mock solver only (not a live network).

---

## 1. What the product is

**PRD one-liner:** NIXO is a clean-funds passport and a gated trading layer for NEAR. It checks the source of funds inside a TEE, lets an AI agent trade only certified deposits under limits the contract enforces, and lets solvers refuse an intent that is not clean.

**Short pitch still used in UI:** *"Prove your money is clean without proving where it's been."*

Three layers that feed each other:

1. **Tracer** — pinned Checker WASM in OutLayer (Intel TDX) screens history (lists + up to 6 hops). Chain stores a short certificate; `is_clean(account)` is the public gate. Path/balances/counterparties never leave the enclave.
2. **Vault + agent** — deposit only if currently Clean; per-deposit provenance; agent holds a function-call key for `execute` only; contract (target) enforces caps, allowlist, revoke, withdraw.
3. **Solver gate** — before fill/route, middleware calls `is_clean` (fail-closed). Hackathon scope: mock solver fills Alice, refuses Mallory.

**Privacy wording (must stay honest):** strategy can be private in a TEE; trade log encrypted with viewing keys; fund history checked without being revealed. **Do not** claim trades are hidden on-chain.

### What else is in the repo

The web app is a **desk**: certificate next to trading and the agent experiment.

- **Clean funds / verify** — wallet or demo `request_nixo`, certificate poll, Verified panel, “Check any wallet” mainnet preview (not certifiable).
- **NIXO agents experiment** (`/dashboard/agents`, `agents/app/nixo/`) — two agents, same task, equivalent capital; Agent B through an off-chain vault; 14+ adversarial tests; audit trail. Spec: `docs/Nixo_agents.md`.
- **Trading desk** (`/dashboard/trade`) — paper trades with real 1Click dry quotes; live NEAR/USDC spot via Intents; FastAPI agents with multi-provider LLM (Anthropic, OpenAI, DeepSeek, NVIDIA NIM, NEAR AI).
- **NestJS waitlist** — landing form only.

---

## 2. Technologies used

| Layer | Technology | Notes |
|---|---|---|
| **Checker** | Rust → `wasm32-wasip2` | Pure `verdict()` + `trace::search()`; OutLayer TDX. Fixture histories compiled in today. |
| **Formal verification** | Kani | 8 harnesses (list rules + multi-hop); CI action defined. |
| **Certificate contract** | Rust, `near-sdk` 5 | `nixo.testnet`: `request_nixo`, `resolve_nixo`, `is_clean`, `get_certificate`, hash governance. |
| **Confidential compute** | OutLayer / Intel TDX | WASM on `test.fastfs.io`, hash pinned on-chain. |
| **Lists** | `safe-fndn/sanctions-address-lists` `data-2026-10-29` + one hacker wallet | Hash in certificate. |
| **History** | NearBlocks v3 (host-side) + fixtures (enclave) | Live enclave fetch is PRD work, not shipped. |
| **Web** | Next.js App Router, React, Tailwind, GSAP | Landing, dashboard, verify, agents UI. |
| **Wallets** | `@near-wallet-selector` | Meteor, HERE, Intear, MyNearWallet, Nightly, Sender. |
| **Agents / vault (v0.1)** | Python 3.12, FastAPI | Off-chain vault + experiment; port-ready reason codes. |
| **LLM** | `agents/app/llm.py` | Anthropic + OpenAI-compatible (incl. NEAR AI Cloud). |
| **Backend** | NestJS | Waitlist only. |
| **Monorepo** | pnpm (web), npm (backend), Python venv (agents) | `pnpm dev` → web :3000, agents :8000, backend :4000. |

---

## 3. Who it is for

- **Depositor** — certify, deposit clean funds, assign agent with limits, revoke, withdraw.
- **Exchange / desk** — `is_clean` / `get_certificate` before credit; no hop path.
- **Solver** — refuse missing/expired/warn/rejected; fill only Clean (mock in this version).
- **Agent developer** — function-call key to `execute` only; contract is authority.

Exchanges are the paying customer long-term; users get the passport. Hackathon judges get Alice/Mallory + (when built) deposit gate, blocked injection, viewing key, mock solver.

---

## 4. Pros and cons today

### Pros

1. Clear three-layer product story in `NIXO_PRD.md`, with honest privacy limits.
2. Tracer path is real on testnet: OutLayer, pinned hash, live Alice/Mallory certificates.
3. Minimal TCB + Kani on verdict/trace; fail-closed contract and checker design.
4. Real sanctions snapshot + documented mainnet hack trail for preview/demo.
5. Agents experiment ships: vault rules, revoke, adversarial suite, UI with stub labels.
6. LLM stack includes NEAR AI Cloud (not Anthropic-only).
7. Landing/UI polish landed; desk narrative now includes Agents & vaults as a real page.

### Cons / gaps vs PRD

1. **Live history in enclave missing** — certificates still use fixtures; arbitrary users get `history_unavailable`.
2. **Pinned WASM behind source** — live certs show depth 1 / `list_hit`; README/landing describe depth 6 / `taint_path`.
3. **Vault not on-chain and not gated by `is_clean`** — Python stub provenance; no near-workspaces vault tests.
4. **No viewing-key decrypt path** — sidebar Soon; landing marks encrypted log as “build”.
5. **No mock solver / solver SDK.**
6. **TEE strategy not proven live** — landing “build”; attestation story strongest on the checker/explainer path.
7. **Hop coverage limited** — native + Ref pool hops; bridges/other DEX/`intents.near` not fully followed.
8. **Submission polish** — README placeholders remain (demo URL, video, org URL / clone path).

---

## 5. Completeness vs PRD

### Overall

Against the **hackathon PRD**, roughly: **Layer 1 ~65–70%** (pipeline real, live fetch not), **Layer 2 ~40%** (off-chain experiment + trading desk; on-chain vault/viewing keys missing), **Layer 3 ~0–5%** (copy only). Combined product narrative is stronger than a tracer-only build, but judges must see stubs labelled.

### Component checklist

| Component | Status | Evidence |
|---|---|---|
| Checker `verdict()` + Kani | ✅ | `checker/src/lib.rs`, proofs |
| Multi-hop `trace::search()` (source) | ✅ | `checker/src/trace.rs` |
| Fixture certify Alice/Mallory on testnet | ✅ | Live certificates |
| Live NearBlocks fetch inside enclave | ✅ in source (`0.3.0`) | `checker/src/live.rs`; needs OutLayer secret + redeploy |
| Redeploy pinned WASM matching source | ⚠️ pin live; certs stale | Hash `574b8182…` active; re-certify blocked by OutLayer failures tonight |
| Local Alice clean / Mallory `taint_path` depth 6 | ✅ | wasmtime on built `0.2.0` WASM |
| `nixo.testnet` + OutLayer callback | ✅ | Live config |
| `/verify`, clean-funds, Verified panel | ✅ | Web app |
| Mainnet “Check any wallet” preview | ✅ preview only | Not certifiable |
| On-chain vault + `is_clean` deposit gate | ❌ | Not in `contract/` |
| Off-chain vault + two-agent experiment | ✅ labelled stub provenance | `agents/app/nixo/`, `/dashboard/agents` |
| Contract-enforced agent `execute` / FC key | ❌ | Off-chain only |
| Encrypted trade log + ≥1 viewing key | ❌ | Soon / build |
| TEE-hosted strategy + Verified nonce panel | ⚠️ partial | Explainer/attestation path exists; agent strategy not default-enclave |
| Mock solver Alice allow / Mallory refuse | ❌ | No solver package |
| Solver SDK fail-closed API | ❌ | Only `nixo-sdk.ts` for views |
| Trading desk paper + live 1Click | ✅ | `/dashboard/trade` |
| Multi-provider LLM incl. NEAR AI | ✅ | `agents/app/llm.py` |
| CI + unit tests (checker, contract, agents) | ✅ defined | Agents nixo tests present |
| Hosted demo / video / final README links | ❌ placeholders | README |
| Cross-chain / confidential on-chain execution | ❌ later | Out of pitch |

### Roadmap alignment

1. **This version (PRD / hackathon):** live enclave history, vault gate on `is_clean`, agent within contract limits, one viewing-key path, mock solver, honest README.
2. **Later:** mainnet, real solver network, richer keys, destination/amount provenance, cross-chain follow, confidential execution (only when built).

---

## 6. Quick reference

- **PRD:** `NIXO_PRD.md` (authoritative for scope and privacy language)
- **Agents MVP spec:** `docs/Nixo_agents.md`
- **Contract:** `nixo.testnet`
- **Pinned checker hash (live on chain):** still older until `0.3.0` WASM is uploaded + applied (local build hash for current source: see `pnpm build:checker`)
- **Checker version in source:** `0.3.0` (live NearBlocks + offline fixtures)
- **List snapshot (live):** `data-2026-10-29`, hash `dd83cfea…ce10`
- **Demo accounts:** `nixo-alice.testnet` (clean), `nixo-mallory.testnet` (rejected)
- **Mainnet trail (preview):** `farstreet4572.near` → … → Binance-hack wallet `efd2…e5af`
- **Key commands:** `pnpm setup`, `pnpm dev`, `pnpm demo`, `pnpm test`, `pnpm kani`, `pnpm build:checker`
- **License:** MIT
