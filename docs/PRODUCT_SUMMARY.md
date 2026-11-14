# NIXO — End-to-End Product Summary (NEAR Hackathon, Nov 2026)

> Context for an AI assistant: this describes **NIXO**, built for the NEAR Hackathon (window through 14 Nov 2026), primary track **Privacy & Private AI**, also aimed at Unstoppable DeFi, AI Security and Defense, and Agent Economy. The agreed product for this version is **`NIXO_PRD.md`** (three layers: fund tracer, deposit vault + AI agent, solver gate). Use this file for pitch copy, critique, or next steps. Status below was re-checked against the repo and live `nixo.testnet` on **14 Nov 2026 (evening, Asia/Calcutta)**.

---

## Current status (checked now)

**Verdict:** Layer 1 (tracer) is demo-ready on testnet with fixture histories; Layer 2 (vault + agent) has a working **off-chain** two-agent experiment and UI; Layer 3 (solver) is not started. The PRD’s critical remaining work is live history inside the enclave, an on-chain vault wired to `is_clean`, one viewing-key decrypt path, and a mock solver Alice/Mallory demo.

| PRD layer | Status | What’s real | What’s not |
|---|---|---|---|
| **1 — Fund tracer** | **Partial / demo-live** | `nixo.testnet` deployed; OutLayer TEE path; Alice Clean / Mallory Rejected certificates **valid now**; Kani proofs; `/verify` + clean-funds UI; mainnet hop preview outside TEE | Certified histories still **fixtures** (`history_source: "fixture"`); no live NearBlocks fetch in enclave; pinned WASM still `0.1.0` / `trace_depth: 1` / Mallory `list_hit` (source claims depth 6 / `taint_path`) |
| **2 — Vault + AI agent** | **Off-chain MVP live** | `/dashboard/agents` two-agent experiment; Python vault with per-deposit provenance, caps, revoke, adversarial tests, audit; multi-provider LLM incl. NEAR AI; paper/live Intents trading desk | Vault is **in-process**, not a NEAR contract; provenance is `stub_verified` (not `is_clean`); no encrypted log / viewing-key decrypt; TEE strategy still labelled “build” on landing |
| **3 — Solver infrastructure** | **Not started** | Landing copy mentions the gate | No mock solver, no solver SDK/middleware, no Alice-fill / Mallory-refuse demo |

**Live contract snapshot (14 Nov 2026):**

- Contract: `nixo.testnet` · OutLayer: `outlayer.testnet` · owner: `nixo.testnet`
- Pinned checker: `e0c79a99…bed6` · list snapshot `data-2026-10-29`
- `nixo-alice.testnet` → `clean`, valid, `history_source: fixture`, `trace_depth: 1`
- `nixo-mallory.testnet` → `rejected` / `list_hit`, valid, `history_source: fixture`, `trace_depth: 1`

**Repo momentum today:** `feat/private-agents` and `feat/uiux` merged to `master` (landing redesign; Agents & vaults page; `agents/app/nixo/*` vault/experiment; multi-provider `llm.py`). Viewing keys still sidebar **Soon**. `NIXO_PRD.md` is uncommitted locally; older “Agents & vaults coming soon” narrative in this summary is obsolete.

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
- **Swarma** — planning docs only, parked.

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
8. **Submission polish** — README placeholders (demo URL, video, org URL); PRD file not yet committed on this machine’s status check.

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
| Live NearBlocks fetch inside enclave | ❌ | Still fixture shell |
| Redeploy pinned WASM matching source | ❌ | Live `0.1.0` / depth 1 |
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
- **Pinned checker hash (live):** `e0c79a99a71cd648fbd2449d9b0518ab4e7e2ec53d6126e49954dc322911bed6`
- **List snapshot (live):** `data-2026-10-29`, hash `dd83cfea…ce10`
- **Demo accounts:** `nixo-alice.testnet` (clean), `nixo-mallory.testnet` (rejected)
- **Mainnet trail (preview):** `farstreet4572.near` → … → Binance-hack wallet `efd2…e5af`
- **Key commands:** `pnpm setup`, `pnpm dev`, `pnpm demo`, `pnpm test`, `pnpm kani`, `pnpm build:checker`
- **License:** MIT
