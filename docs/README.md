# NIXO docs

Product and experiment documentation for this repo. The root [`readme.md`](../readme.md) is the judge-facing entry; this folder holds deeper narrative and specs.

| Doc | Role |
|---|---|
| [`../NIXO_PRD.md`](../NIXO_PRD.md) | **Authoritative product requirements** for this hackathon version: three layers (tracer, vault + agent, solver), privacy wording, demo script, cut list, trust limits |
| [`PRODUCT_SUMMARY.md`](PRODUCT_SUMMARY.md) | End-to-end narrative + **current status** vs the PRD (what is live, stubbed, or missing) |
| [`Nixo_agents.md`](Nixo_agents.md) | Layer 2 **v0.1 experiment** spec: two-agent comparison, off-chain vault rules, adversarial suite (implementation under `agents/app/nixo/`) |
| [`../vault/README.md`](../vault/README.md) | On-chain Layer 2 vault (`nixo-vault.testnet`): deposit gate, assign/execute, deploy |

## Narrative in one paragraph

NIXO is a clean-funds passport and a gated trading layer for NEAR. A pinned checker in an OutLayer TEE issues short certificates on `nixo.testnet`. A vault (target: on-chain) accepts only currently Clean deposits and lets an AI agent trade under contract-enforced limits. Solvers (target: mock demo this version) call `is_clean` before fill. Strategy may be private in a TEE; trade logs may be encrypted with viewing keys; fund history is checked without being revealed. Trades are **not** hidden on-chain.
