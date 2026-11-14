"""NIXO v0.1: verified capital and agent authorization (two-agent experiment).

See Nixo_agents.md at the repo root. Modules:

- audit:      common audit-event schema shared by both agents
- vault:      provenance registry + authorization vault (Agent B's enforcement boundary)
- adapter:    shared paper execution adapter priced from a frozen market snapshot
- runner:     agent decision logic (LLM via app.llm, or deterministic rules)
- experiment: orchestrates setup, task phase, adversarial suite and revocation

Honesty labels (surfaced in every report): execution is simulated, provenance
verification is a stub, and enforcement in v0.1 runs inside the agents service
(off-chain). Nothing here is on-chain proof.
"""
