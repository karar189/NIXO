# NearArc

Monorepo for NearArc, built on the NEAR protocol. See [plan.MD](plan.MD) and [Swarma_P5.md](Swarma_P5.md) for the product plan.

| Folder | Stack | Port | Health check |
|---|---|---|---|
| [frontend/](frontend/) | Next.js 16 (App Router, TypeScript, Tailwind) | 3000 | http://localhost:3000 |
| [backend/](backend/) | NestJS 12 (TypeScript, ESM, Vitest) | 4000 | http://localhost:4000/health (`POST /waitlist` backs the landing page form) |
| [agents/](agents/) | Python FastAPI | 8000 | http://localhost:8000/health (docs at `/docs`) |

## First-time setup

```bash
# frontend
cd frontend && npm install && cp .env.example .env.local

# backend
cd backend && npm install && cp .env.example .env

# agents (Python 3.11+)
cd agents && python3 -m venv .venv && source .venv/bin/activate \
  && pip install -e ".[dev]" && cp .env.example .env
```

## Run (one terminal each)

```bash
cd frontend && npm run dev
cd backend  && npm run start:dev
cd agents   && .venv/bin/uvicorn app.main:app --reload --port 8000   # use the venv: it has the right SDK versions
```

## AI trading (dashboard → AI Trading)

- **Agent:** the agents service analyses the market regime (ATR, ADX, volatility, MA slope), shortlists strategies, and
  plans one with an LLM or a rule-based fallback. The paper engine then trades it on each tick with TP/SL, liquidation,
  an optional LLM supervisor (the provider that made the plan), and a risk gate.
- **LLM providers:** Anthropic, OpenAI, DeepSeek, NVIDIA NIM and NEAR AI Cloud, each enabled by its API key
  (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `NVIDIA_API_KEY`, `NEARAI_API_KEY`). "Auto" walks
  `LLM_PROVIDER_ORDER` and falls through on failure; a named provider is tried first, then the others. With no key
  set, the rule-based planner is used. Settings → AI model providers shows each provider's status and tests it.
- **Paper orders:** pick asset, side, margin, leverage and TP/SL yourself. Every paper fill is priced by a real
  NEAR Intents 1Click dry-run quote, so fees and slippage are real; leverage is simulated.
- **Live swaps (mainnet only):** spot NEAR/USDC through 1Click, signed in Meteor, tracked through
  SUCCESS / REFUNDED / FAILED with explorer links.
- **Network:** switch testnet/mainnet in Settings. NEAR Intents has no testnet, so live swaps need mainnet.

Paper sessions are kept in memory by the agents service and reset when it restarts.

## Tests

```bash
cd backend && npm test
cd agents  && pytest
```
