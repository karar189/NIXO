# agents

Python FastAPI service for NIXO trading agents and the Layer 2 vault experiment.
Product framing: root [`NIXO_PRD.md`](../NIXO_PRD.md) and [`docs/`](../docs/).

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env   # or use the repo-root .env via pnpm dev

uvicorn app.main:app --reload --port 8000   # http://localhost:8000/docs
pytest
```

## LLM providers

`app/llm.py` gives the planner, supervisor and NIXO agents one interface over
Anthropic, OpenAI, DeepSeek, NVIDIA NIM and NEAR AI Cloud (keys in the root
`.env`, see `.env.example`). `llm_provider: "auto"` walks `LLM_PROVIDER_ORDER`
and falls through on failure; naming a provider tries it first, optionally with
`llm_model`, then the others.

- `GET /llm/providers`: configured providers and cool-downs
- `GET /llm/models/{provider}`: chat models from the provider's catalog
- `POST /llm/ping {"provider": "deepseek"}`: live health check

## NIXO v0.1 experiment (`app/nixo`)

**Spec:** [`docs/Nixo_agents.md`](../docs/Nixo_agents.md) (defers to the PRD on
product language). **UI:** `/dashboard/agents`.

On-chain vault helpers: `GET /nixo/onchain`, deposit views, `POST /nixo/onchain/execute-args`.
Set `NIXO_VAULT_CONTRACT` / `NEXT_PUBLIC_NIXO_VAULT_CONTRACT` (default `nixo-vault.testnet`).

Delayed viewing keys: `POST /nixo/viewing/append|offer|redeem`, `POST /nixo/viewing/keypair`.

Two agents, same task, equivalent capital. Agent B trades through the vault
(`vault.py`), which enforces assignment, revocation, identity, action/asset
rules, per-trade and total-spend caps, replay protection and atomic
reservations; Agent A is the unrestricted baseline. Both share the paper
adapter (`adapter.py`) and a frozen market snapshot.

- `POST /nixo/runs` (header `X-Near-Account`): start a run (setup → task → 17
  adversarial tests → revocation)
- `GET /nixo/runs`: this account's runs, newest first (the last 20, kept in memory)
- `GET /nixo/runs/{id}`: report (comparison, success criteria, tests)
- `GET /nixo/runs/{id}/audit`: audit trail
- `POST /nixo/runs/{id}/revoke`, `POST /nixo/runs/{id}/attempt`: owner console
- `GET /nixo/assets`: every token NEAR Intents (1Click) can route, as `SYMBOL@chain` codes grouped by chain
- `GET /nixo/defaults`: default run config and the execution/provenance/enforcement labels

**Multi-token and cross-chain.** The task is a target portfolio of up to 4 assets (any
1Click token, e.g. `NEAR@near`, `ETH@eth`, `SOL@sol`); agents always spend `USDC@near`.
Agent B's policy adds **allowed chains** (the chain comes from a catalogue map frozen into
the policy, never from the request) and **recipient pinning** (cross-chain output stays in
the vault or goes to the owner's pinned address for that chain). In recorded mode, each
asset is priced from Binance bars when available (else flat at the 1Click spot), and one
1Click dry quote per asset confirms it's routable before the run starts. Attack tests
t15–t17 cover attacker recipients, forbidden chains and pinned payouts.

v0.1 enforcement runs inside this service (off-chain); execution is simulated
and provenance verification is a stub. The UI is `/dashboard/agents`.
