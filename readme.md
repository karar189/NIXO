# NIXO

> Prove your money is clean without proving where it's been.

**NIXO** is a clean-funds passport and a gated trading layer for NEAR. A pinned checker runs inside an OutLayer TEE (Intel TDX), screens fund history against sanctions and known-hacker lists, and writes a short certificate on-chain. A vault accepts only currently Clean deposits and lets an AI agent trade under limits the contract enforces. Solvers (and any routing agent) can refuse an intent that is not Clean — without ever seeing balances, counterparties, or the hop path.

**Privacy, stated honestly:** strategy can be private inside a TEE; the trade log can be encrypted and opened with viewing keys; fund history is checked without being revealed. **NIXO does not hide trades on-chain.** Vault deposits, Intents settlements, and ordinary transfers remain visible on explorers.

Built for the **NEAR Hackathon** (window through 14 Nov 2026). Primary track **Privacy & Private AI**; also Unstoppable DeFi, AI Security & Defense, and Agent Economy — each only as far as this version honestly goes.

| | |
|---|---|
| **Product requirements** | [`NIXO_PRD.md`](NIXO_PRD.md) (authoritative for scope and privacy language) |
| **Status / narrative** | [`docs/PRODUCT_SUMMARY.md`](docs/PRODUCT_SUMMARY.md) |
| **Agents spec** | [`docs/Nixo_agents.md`](docs/Nixo_agents.md) |
| **In-app docs** | [`/docs`](web/app/docs) at http://localhost:3000/docs |
| **Verifier (testnet)** | `nixo.testnet` |
| **Vault (testnet)** | `nixo-vault.testnet` |
| **Verifier (mainnet)** | `nixo.nixowallet.near` |
| **Vault (mainnet)** | `vault.nixowallet.near` |
| **Owner (mainnet)** | `nixowallet.near` · OutLayer `outlayer.near` |
| **Checker** | `/checker` · version `0.3.0` · hash pinned on-chain |
| **Kani proofs** | `/checker/proofs` (CI) |
| **License** | MIT |

---

## Table of contents

1. [The problem](#the-problem)
2. [Three layers](#three-layers)
3. [What we built (product surfaces)](#what-we-built-product-surfaces)
4. [Judge it in 90 seconds](#judge-it-in-90-seconds)
5. [How the tracer works](#how-the-tracer-works)
6. [Vault, agents & viewing keys](#vault-agents--viewing-keys)
7. [Solver gate](#solver-gate)
8. [Trading desk & markets](#trading-desk--markets)
9. [Private AI](#private-ai)
10. [Repository layout](#repository-layout)
11. [Setup & run](#setup--run)
12. [Contracts](#contracts)
13. [What is real vs mocked](#what-is-real-vs-mocked-in-this-version)
14. [Formal verification](#formal-verification)
15. [Trust assumptions and limits](#trust-assumptions-and-limits)
16. [Related work](#related-work)
17. [Roadmap](#roadmap)
18. [Hackathon disclosure](#hackathon-disclosure)

---

## The problem

Exchanges, vaults, and AI trading agents need to know whether incoming funds are tied to sanctioned or stolen money. Today that usually means handing a full history to a central screener, or trusting an agent with a hot wallet and hoping it behaves.

That creates three failures:

1. **A compliance check leaks the history.** Counterparties, balances, and routes become visible to whoever runs the check.
2. **An account-level “looks fine” is treated as a property of the coins.** A wallet can be certified once, then receive dirty money, then deposit. Trust must be checked when funds move, and recorded **per deposit**.
3. **Agents and solvers have no shared gate.** A prompt-injected agent, or a solver filling any intent, can move money a human would have refused.

NIXO addresses this on NEAR. A pinned checker runs in an OutLayer TEE, looks up history itself, and writes a short certificate. The vault — and any solver that opts in — reads `is_clean` and acts on that verdict, not the path.

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

### Layer 1 — Fund tracer (creates trust)

A Rust checker (WASM) runs in OutLayer. It screens the account and counterparties against pinned lists (OFAC, EU, UK, UN, SECO + known-hackers), then searches backwards up to six hops (including Ref pool hops under stated rules). Outcomes: **Clean**, **Warn**, or **Rejected** with a fail-closed reason.

- **Certified mode:** account only; history fetched inside the enclave (NearBlocks v3 by default, or labelled fixtures when `NIXO_OFFLINE=1`). Output under ~900 bytes — **no path**.
- **Preview mode:** caller may supply history; marked `caller_supplied`; the contract **refuses** to certify it.
- Contract: `request_nixo` → OutLayer → private `resolve_nixo` → store certificate. `is_clean(account)` is true only for a currently valid **Clean** certificate.

### Layer 2 — Vault + AI agent (puts trust to work)

The vault holds funds; the agent never does.

1. Deposit only after a currently valid Clean certificate (`is_clean` cross-contract). Dirty / warn / missing / expired → refund, no provenance row.
2. Each deposit is its own provenance event (`clean_at_deposit` at that moment).
3. Owner assigns the deposit to an agent with per-tx / window / expiry limits and an allowlist.
4. Agent trades only via `execute` (function-call key). Contract re-checks permissions every call.
5. Owner can revoke and withdraw. Prompt-injected “pay a blocked destination” fails at the contract.
6. Encrypted trade log + at least one viewing-key path (delayed key shipped). Viewing keys do **not** hide explorer-visible transfers.

### Layer 3 — Solver gate (spreads trust)

Middleware any NEAR Intents solver (or routing agent) can call before fill: allow only when `is_clean` is true; missing / expired / warn / rejected / transport failure → refuse.

**Shipped today:** fail-closed `checkIntent` + mock solver (Alice allowed, Mallory refused). Paper fill only — not a live Intents solver network.

---

## What we built (product surfaces)

The web app is a full **desk**: certificate next to trading, markets, agents, privacy tooling, and docs.

| Route | What it is |
|---|---|
| `/` | Marketing landing — product story, GSAP motion, waitlist, CTAs into the desk |
| `/docs` | In-app documentation (tracer, vault, trading, solver, private AI, developers, status) |
| `/verify` | **Exchange view** — live `is_clean` / certificate, Verified panel, “Check any wallet” preview |
| `/private-ai` | Privacy-track surface: ephemeral NEAR AI Cloud TEE note, sample docs, Verified panel |
| `/dashboard` | Desk overview — KPIs, account, markets snapshot, clean-funds card, agents & trades |
| `/dashboard/clean-funds` | Request / poll a NIXO certificate for the connected (or demo) account |
| `/dashboard/trade` | Trading desk — paper orders + live 1Click / Intents spot path, agent panel |
| `/dashboard/markets` | Markets browser + per-symbol pages, asset swap panel |
| `/dashboard/news` | Desk news feed (API-backed) with Earth visual |
| `/dashboard/privacy` | Privacy posture / viewing-key oriented desk surface |
| `/dashboard/agents` | On-chain vault panel + off-chain two-agent adversarial suite + delayed viewing keys |
| `/dashboard/keys` | **07 Viewing keys — copy trading.** Paste a trader ID → public agent PnL → subscribe on-chain → decrypt their agent trades live + auto-mirror |
| `/dashboard/solver` | Mock solver demo — Alice fill / Mallory refuse via `checkIntent` |
| `/dashboard/settings` | Network toggle, AI model providers (multi-LLM) |

**Brand:** shared `Logo` component (mark + wordmark) used in nav, footer, sidebar, docs shell, preloader, and loading states; favicon / app icons under `web/app/`.

**Wallets:** `@near-wallet-selector` — Meteor, HERE, Intear, MyNearWallet, Nightly, Sender. Network toggle for testnet ↔ mainnet (selects the matching certificate + vault contracts).

---

## Judge it in 90 seconds

No real funds required for the certificate demo. Two pre-seeded testnet accounts: one clean, one tainted.

```bash
git clone https://github.com/<your-org>/nixo
cd nixo
cp .env.example .env   # fill demo keys + optional LLM / NearBlocks / NEAR AI keys
pnpm setup
pnpm demo              # or: pnpm dev
```

Opens `http://localhost:3000`:

1. **Certify Alice.** **Prove my funds are clean** as `nixo-alice.testnet` → pending → ✅ Clean certificate (verdict, expiry, checker version, history source — **no hop path**).
2. **Reject Mallory.** Switch to `nixo-mallory.testnet` (replay of a real mainnet trail from `farstreet4572.near`) → ❌ Rejected with a reason.
3. **Exchange view.** Open `/verify`, paste `nixo-alice.testnet` → live `is_clean` → ✅. Expand the Verified panel (WASM hash, OutLayer attestation, list snapshot, Kani link).
4. **Agents & vaults.** `/dashboard/agents` — on-chain vault panel (`nixo-vault.testnet`), delayed viewing-key path, plus the off-chain two-agent adversarial suite.
5. **Mock solver.** `/dashboard/solver` — paper fill: Alice allowed, Mallory refused. Or `pnpm demo:solver` / `pnpm test:solver`.
6. **Optional preview.** On `/verify`, **Check any NEAR wallet** traces mainnet accounts (e.g. `farstreet4572.near`) with hop paths — preview only, not certifiable.
7. **Private AI.** `/private-ai` — fictional samples only; nothing retained server-side after the response.

**Deploy note:** run `scripts/deploy-vault-testnet.sh` before pitching on-chain deposits as live on testnet.

---

## How the tracer works

1. User calls `request_nixo` with their account id only. History is not uploaded by the website.
2. Contract asks OutLayer to run the pinned checker (`WasmUrl` + SHA-256).
3. Inside the enclave, the Checker screens lists and traces up to 6 hops. Fail-closed on incomplete history, bad fetches, or caps on non-terminal accounts.
4. OutLayer attestation commits to WASM / input / output hashes (TDX workers registered via DCAP).
5. `resolve_nixo` accepts only the pinned, unrevoked checker hash for the requesting account, stores a short-lived certificate (7-day TTL on testnet), emits events. Anything unexpected stores nothing.
6. Anyone calls `is_clean(account)` / `get_certificate` — verdict, reason, checker version, list snapshot, expiry; never the path.

| # | Component | Role | Tech |
|---|-----------|------|------|
| 1 | Checker | Deterministic rules inside the TEE | Rust → `wasm32-wasip2` on OutLayer (Intel TDX) |
| 2 | Certificate contract | Pin hash, OutLayer callback, certificates, `is_clean` | `nixo.testnet` / `nixo.nixowallet.near`, `near-sdk` 5 |
| 3 | Lists + history | Sanctions / hacker lists; NearBlocks v3 (live default) or labelled fixtures | Snapshot `data-2026-10-29` |
| 4 | Desk / SDKs | Certify UI, `/verify`, view client + fail-closed solver gate | Next.js, `nixo-sdk.ts`, `solver-gate.ts` |
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

## Vault, agents & viewing keys

Specified in [`docs/Nixo_agents.md`](docs/Nixo_agents.md); product target in [`NIXO_PRD.md`](NIXO_PRD.md) §4.2. On-chain vault: [`vault/README.md`](vault/README.md).

### On-chain vault (shipped)

Crate [`vault/`](vault/) → `nixo-vault.testnet` (testnet) and `vault.nixowallet.near` (mainnet):

- `deposit` → `is_clean` gate, provenance row or full NEAR refund
- `assign` / `execute` / `revoke` / `withdraw`
- Trade-hash commits for encrypted log linkage
- Unit tests: clean accept, dirty refund, caps, injection, revoke, rollback
- FC-key helper: [`scripts/vault-fc-key.sh`](scripts/vault-fc-key.sh)
- UI panel on `/dashboard/agents`

### Off-chain two-agent suite (shipped, labelled)

Two agents, same task, equivalent capital. **Agent B** trades through a policy vault; **Agent A** is the unrestricted baseline.

- **Task:** target portfolio of up to 4 assets from `USDC@near` (`SYMBOL@chain` via 1Click).
- **Agent B policy:** per-trade and total-spend caps, allowed assets/chains, recipient pinning, assignment / revoke / replay checks, atomic spend reservation.
- **Adversarial suite:** t01–t17 (incl. cross-chain recipient/chain/pin attacks), then owner revoke.
- **Honest labels:** enforcement **off-chain** (in-process); execution **simulated**; provenance **`stub_verified`** until wired to live `is_clean`.

API surface (FastAPI, `X-Near-Account` header): `POST/GET /nixo/runs`, audit, revoke, attempt, assets, defaults, on-chain helpers, viewing-key offer/redeem. OpenAPI: http://localhost:8000/docs

### Viewing keys

Delayed encrypt / offer / redeem path in the agents service (`agents/app/nixo/viewing_keys.py`), reachable from the agents desk. Auditor keys are typed but not shipped. Live, time-limited keys ship as **copy-trading keys** (below).

### Copy-trading keys (07 Viewing keys)

Traders sell access to their **agent sessions**; followers pay on-chain, read the trades live and can auto-mirror them. Only aggregate PnL is public.

1. **Trader:** on `/dashboard/trade`, hover **Deploy copy agent**, set a price per period, sign `list_key` on the copy-keys contract ([`copykeys/`](copykeys/)).
2. **Follower:** on `/dashboard/keys`, paste the trader's NEAR ID → public card (PnL, ROE, win rate, drawdown, trade count, PnL curve; no symbols or sides).
3. **Subscribe:** the browser makes an X25519 keypair (WebCrypto; the private key never leaves the device) and calls `subscribe(trader, periods, x25519_pub)` with NEAR attached. The deposit goes straight to the trader.
4. **Live feed:** every agent open/close is AES-GCM encrypted with the trader's current epoch key and hash-chained. `/copy/keys` wraps the epoch keys inside the paid window to the **public key stored on-chain**, so naming someone else's account gets you nothing. The browser decrypts and verifies the chain (“chain verified”).
5. **Auto-mirror:** the follower sets size × trader, max margin, max leverage and a loss cap. Each new agent position opens a matching paper position for them and closes when the trader's does. Mirroring pauses at the loss cap.

What it does not do: manual positions and vault executes are never published; mirrored trades are paper fills (1Click dry-run quotes), so no funds move; a subscriber can re-share what they decrypt; public PnL is computed by the NIXO service from those fills and backed by a hash chain, which is not a ZK proof. Access is rounded to whole epochs (`NIXO_COPY_EPOCH_SECS`), and keys already handed out can't be revoked. Three labelled demo traders (`*.nixo-demo`, simulated history, not purchasable) keep the leaderboard populated.

Agents API: `GET /copy/leaderboard`, `/copy/traders/{id}`, `/copy/traders/{id}/entries`, `/copy/keys/{id}?follower=`, `/copy/me`, `/copy/following`, `GET/POST /copy/mirror`. Code: [`agents/app/copytrade/`](agents/app/copytrade/), [`web/app/dashboard/keys/`](web/app/dashboard/keys/), [`web/lib/copykeys/`](web/lib/copykeys/).

### LLM providers

`agents/app/llm.py` — Anthropic, OpenAI, DeepSeek, NVIDIA NIM, NEAR AI Cloud. `auto` walks `LLM_PROVIDER_ORDER`. Configure and test under **Settings → AI model providers**.

---

## Solver gate

| Piece | Path |
|---|---|
| Fail-closed SDK | [`web/lib/solver-gate.ts`](web/lib/solver-gate.ts) (`checkIntent`) |
| Mock solver | [`web/lib/solver/mock-solver.ts`](web/lib/solver/mock-solver.ts) |
| UI | `/dashboard/solver` |
| CLI demo | `pnpm demo:solver` (live Alice/Mallory views) |
| Unit-style test | `pnpm test:solver` (mocked) |

Missing / expired / warn / rejected / RPC failure → refuse. Only a currently valid Clean certificate passes. Paper fill only.

---

## Trading desk & markets

| Surface | Behaviour |
|---|---|
| `/dashboard/trade` | Paper order form + live NEAR/USDC spot via Intents / 1Click; agent setup modal and session |
| `/dashboard/markets` | Market list, per-symbol detail, asset swap panel, token icons |
| `/dashboard/news` | Aggregated desk news via `GET /api/news` |
| Agents trading engine | FastAPI `routers/trading.py` + planner/engine — dry-run quotes by default; optional **live** execution |

Confidential Intents live swaps may require `ONECLICK_JWT` (see `.env.example`).

### Live AI agent on NEAR Intents (mainnet, real funds)

Configure AI agent → Execution → **Live**. The agent's decisions become real spot swaps through 1Click from one dedicated agent account ([`agents/app/live/`](agents/app/live/)):

1. Long signal → real 1Click quote (USDC → NEAR / nBTC / bridged ETH, `ORIGIN_CHAIN`). Exit → sell the exact amount it bought. Shorts are skipped and leverage is fixed at 1x, because Intents settles spot swaps. SOL has no NEAR-chain token, so it stays paper-only.
2. The quote's recipient and refund address must be the agent account. A quote more than `NIXO_LIVE_MAX_DEVIATION_BPS` worse than the Binance mark is refused.
3. The service signs one transaction from the agent account (register the deposit address if needed, then `ft_transfer` the exact amount), submits the hash to 1Click and polls until `SUCCESS` / `REFUNDED` / `FAILED`. Fills use the amounts actually settled.
4. Guardrails: kill switch (`NIXO_LIVE_ENABLED`), per-trade cap, rolling 24h budget, market allowlist, gas reserve, one live session at a time, and `Stop` waits for an in-flight swap rather than abandoning it. Every order goes to `agents/.nixo_live/orders.jsonl` and shows on the desk with nearblocks and Intents explorer links.
5. Only `NIXO_AGENT_OWNER` can start it. The wallet signs a NEP-413 message naming the market and size, bound to a single-use nonce, and the server checks it's a full-access key of that account on mainnet.

Setup: create a fresh mainnet account, fund it with a little NEAR (gas) and the USDC you want the agent to trade, put its full-access key in `NIXO_AGENT_PRIVATE_KEY`, set `NIXO_AGENT_ACCOUNT`, `NIXO_AGENT_OWNER`, `NIXO_LIVE_ENABLED=1`, restart agents. Limits: the server holds a hot key (keep the balance small); sessions live in memory, so after a restart any bought asset stays in the agent account (the balance shows on the desk).

---

## Private AI

Privacy-track surface for the hackathon:

1. Create an API key at [cloud.near.ai](https://cloud.near.ai) → set `NEARAI_API_KEY` in root `.env`.
2. Optional attested smoke (Python ≥ 3.12):

```bash
python3.12 -m venv .venv-nearai && .venv-nearai/bin/pip install nearai-inference-sdk==0.3.0 httpx
NEARAI_API_KEY=… .venv-nearai/bin/python scripts/nearai_smoke.py
```

3. UI: http://localhost:3000/private-ai — fictional samples in `fixtures/samples/`.
4. `POST /api/private-ai` keeps **nothing** server-side after the response (`Cache-Control: no-store`, no DB/disk write).
5. Certificate explainer: `POST /api/explain` — uses the **public** certificate only.

---

## Repository layout

```text
nixo/
  NIXO_PRD.md             # product requirements (authoritative)
  readme.md               # this file — judge / builder entry
  docs/
    README.md             # doc index
    PRODUCT_SUMMARY.md    # narrative + current status
    Nixo_agents.md        # Layer 2 agents spec
  checker/                # Rust → WASM (OutLayer TDX), live NearBlocks + fixtures
  contract/               # certificate contract (nixo.testnet / mainnet)
  vault/                  # Layer 2 deposit vault
  copykeys/               # copy-trading keys: paid subscriptions to agent-trade feeds
  web/                    # Next.js desk: landing, docs, verify, dashboard/*
  agents/                 # FastAPI: trading + nixo agents + viewing keys + LLM
  backend/                # NestJS waitlist
  fixtures/               # Alice / Mallory + mainnet cache + Private AI samples
  scripts/                # dev, deploy, checker, solver, nearai smoke, vault FC key
  .github/workflows/      # checker, Kani, contract, vault, web, agents, backend
```

---

## Setup & run

### Prerequisites

- Node 20+, pnpm 8+ (web); npm (backend)
- Python 3.12+ (agents)
- Rust: checker pins a recent stable for `wasm32-wasip2`; contract / vault via `cargo-near`
- Optional: `near-cli-rs`, `cargo-near`, `wasmtime`, NEAR AI / other LLM keys, NearBlocks API key

### One-command local stack

```bash
git clone https://github.com/<your-org>/nixo
cd nixo
cp .env.example .env    # one file for every service — never commit real keys
pnpm setup              # pnpm install + backend npm ci + agents venv
pnpm dev                # web :3000, agents :8000, backend :4000
```

| Service | Command | URL |
|---|---|---|
| Web (landing, docs, dashboard, verify) | `pnpm dev:web` | http://localhost:3000 |
| Agents (FastAPI + NIXO) | `pnpm dev:agents` | http://localhost:8000/docs |
| Backend (waitlist) | `pnpm dev:backend` | http://localhost:4000 |

Useful scripts:

| Command | Purpose |
|---|---|
| `pnpm demo` | Web only (demo UI) |
| `pnpm demo:solver` / `pnpm test:solver` | Mock solver demo / gate tests |
| `pnpm test` | Checker + contract + vault + agents + solver gate |
| `pnpm test:backend` | NestJS tests |
| `pnpm kani` | Formal proofs on the checker |
| `pnpm build:checker` | Release WASM + SHA-256 |
| `pnpm build:contract` / `pnpm build:vault` | NEAR contract builds |
| `pnpm checker:run` | Local wasmtime / scripted checker run |
| `pnpm fetch-history` / `pnpm make-replay` | History tooling for fixtures / preview |

### Checker alone / local re-run

```bash
cd checker && cargo test
cargo build --release --locked --target wasm32-wasip2
shasum -a 256 target/wasm32-wasip2/release/nixo_checker.wasm
printf '{"account":"nixo-alice.testnet"}' | wasmtime run target/wasm32-wasip2/release/nixo_checker.wasm
# or: scripts/run-checker.sh nixo-alice.testnet
```

Set `NIXO_OFFLINE=1` for compiled Alice/Mallory fixtures. Leave unset (default) for live NearBlocks fetch — set `NEARBLOCKS_API_KEY` to avoid free-tier rate limits.

### Environment

All services share the **repo-root** `.env` (exported by `scripts/dev.sh`). See [`.env.example`](.env.example) for every variable: contracts, demo keys, NearBlocks, NEAR AI, LLM providers, 1Click JWT, ports, CORS.

---

## Contracts

### Testnet

| Role | Account |
|---|---|
| Certificate / `is_clean` | `nixo.testnet` |
| Authorization vault | `nixo-vault.testnet` |
| Copy-trading keys | `nixo-keys.testnet` (deploy with `scripts/deploy-copykeys-testnet.sh`, then set `NIXO_KEYS_CONTRACT`) |
| OutLayer | `outlayer.testnet` |

### Mainnet (live)

| Role | Account | Notes |
|---|---|---|
| Certificate / `is_clean` | [`nixo.nixowallet.near`](https://nearblocks.io/address/nixo.nixowallet.near) | Owner `nixowallet.near`; OutLayer `outlayer.near` |
| Authorization vault | [`vault.nixowallet.near`](https://nearblocks.io/address/vault.nixowallet.near) | `nixo_contract` → `nixo.nixowallet.near` |

Point the app at mainnet (or use the in-app network toggle):

```bash
NEXT_PUBLIC_NIXO_CONTRACT=nixo.nixowallet.near
NEXT_PUBLIC_NIXO_VAULT_CONTRACT=vault.nixowallet.near
NIXO_CONTRACT=nixo.nixowallet.near
NIXO_VAULT_CONTRACT=vault.nixowallet.near
```

Gated deposits still need a mainnet Clean certificate (`request_nixo` via OutLayer) before `is_clean` is true.

Deploy helpers: `scripts/deploy-testnet.sh`, `scripts/deploy-vault-testnet.sh`, `scripts/deploy-copykeys-testnet.sh`.

---

## What is real vs mocked in this version

| Piece | Status |
|-------|--------|
| Checker core + multi-hop search (source) | Real; Kani-proven on bounded harnesses |
| OutLayer + `nixo.testnet` certificates | Real on testnet (re-issue can be blocked by OutLayer worker failures — check live status in PRODUCT_SUMMARY) |
| Mainnet certificate + vault | Live: `nixo.nixowallet.near` + `vault.nixowallet.near` |
| Certified histories | **Live by default** inside the enclave: NearBlocks v3. **Fixtures** only when `NIXO_OFFLINE=1`. Mallory fixture = labelled mainnet-trail replay |
| Sanctions lists | Real snapshot `data-2026-10-29` |
| Hacker list | Seed entries with public attribution caveats (shown in UI) |
| `/verify` “Check any wallet” | Preview only (`caller_supplied`); not certifiable |
| NEAR AI explainer / Private AI | Real path; needs `NEARAI_API_KEY`; no server retention |
| Agents off-chain path | Off-chain / stub provenance / simulated (labelled) |
| On-chain vault gated by `is_clean` | Live on testnet + mainnet (confirm deploy before demos) |
| Viewing keys / encrypted trade log | Delayed key path shipped; auditor stubbed |
| Copy-trading keys (07) | Paid subscriptions on `copykeys/` (testnet), browser-side decryption, hash-chained feed: real. Mirrored trades: paper. Demo traders: simulated history, labelled |
| Mock solver + fail-closed SDK | Shipped (paper fill; not a live Intents network) |
| AI agent execution | Paper by default (1Click dry-run prices). **Live** mode: real mainnet spot swaps via 1Click from a capped agent account, owner-signed start (off unless `NIXO_LIVE_ENABLED=1`) |
| Markets / news / trade desk | Shipped desk features (quotes/news via APIs; dry-run default for swaps) |
| Chain Signatures cross-chain relayer | Not built (later) |

Every mocked piece should stay tagged in the UI and here. Judges should see what is live, fixture, or later in under a minute.

---

## Formal verification

Kani proves the pure list rule and multi-hop search properties on bounded inputs (see `/checker/proofs`). CI fails on regression. Proofs cover algorithm logic, not list completeness, indexer correctness, or attribution of listed wallets.

```bash
cargo install --locked kani-verifier && cargo kani setup
cd checker && cargo kani
# or from root:
pnpm kani
```

---

## Trust assumptions and limits

- Trusts Intel TDX / OutLayer measurements, pinned WASM hash, private `resolve_nixo`, NearBlocks at a pinned block (when live), compiled lists as of snapshot date, documented terminal accounts (faucets/venues).
- Does **not** prove a particular subset of coins is clean; `is_clean` is account-level at check/deposit time.
- Pool-hop linking is a heuristic. Cross-chain origin is out of scope.
- Explorers still show vault and Intents activity.

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

## Roadmap

| This version (hackathon) | Later |
|---|---|
| Live enclave NearBlocks fetch (fixtures labelled for offline/CI) | More indexers |
| Certificates on testnet + mainnet; vault + mock solver use `is_clean` | Real solver network at scale |
| Vault with per-deposit provenance, FC-key agent, revoke/withdraw | Destination / amount-level provenance |
| Agent via Intents within limits; dry-run default | Full production swap state machine |
| Encrypted log + delayed key + paid copy-trading keys with auto-mirror (paper) | Real-money mirroring via vault `execute`, TEE-signed stats, on-chain chain-head anchoring |
| Mock solver Alice/Mallory | Published solver package |
| Honest README (terminals, fixtures, network match, privacy) | — |
| **Not in pitch:** cross-chain coverage, confidential on-chain execution | Those only when built |

**Acceptable cuts if time runs out:** live Intents fills (keep dry-run + vault gate) → TEE model (keep checker TEE) → extra viewing-key types (keep one delayed key) → anything that makes the solver layer look like a live network rather than a mock.

1. **This hackathon version** — close PRD gaps: live history in enclave, on-chain vault gate, one viewing key, mock solver; keep honesty tables current.
2. **v1** — mainnet hardening, multisig, SDKs, audit, withdrawal pilot.
3. **v2** — Chain Signatures registries, richer disclosure keys, broader venue coverage — still without claiming confidential execution until it exists.

---

## How NEAR is used

- **OutLayer (Intel TDX)** — runs the Checker (`/checker`, `/contract/src/outlayer.rs`).
- **Certificate + vault contracts** — `request_nixo`, `resolve_nixo`, `is_clean`, deposit gate, agent `execute`.
- **NEAR Intents / 1Click** — trading desk dry-run and live spot swaps; vault allowlist target for agent execution.
- **NEAR AI Cloud** — `/private-ai`, certificate explainer, agent LLM provider.
- **Chain Signatures / cross-chain registries** — later. Not shipped.

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
- Hosted demo: link here when deployed
- [OutLayer](https://app.outlayer.ai/docs)
- [NEAR AI Cloud](https://docs.near.ai/cloud/quickstart)
- [NEAR Intents](https://docs.near-intents.org/)
- [Kani](https://model-checking.github.io/kani/)
