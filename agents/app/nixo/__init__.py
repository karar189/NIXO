"""NIXO Layer 2: verified capital and agent authorization.

See docs/Nixo_agents.md (off-chain agents) and vault/ (on-chain contract).

Modules:

- audit:         common audit-event schema shared by both agents
- vault:         provenance registry + authorization vault (Agent B, off-chain)
- adapter:       shared paper execution adapter priced from a frozen market snapshot
- runner:        agent decision logic (LLM via app.llm, or deterministic rules)
- run:           orchestrates setup, task phase, adversarial suite and revocation
- onchain:       view helpers / execute arg builders for nixo-vault.testnet
- viewing_keys:  encrypted trade log + delayed viewing-key path

The off-chain agents path keeps stub provenance labels. On-chain deposits use
nixo.testnet.is_clean; set NIXO_VAULT_CONTRACT to enable that mode in the API.
"""
