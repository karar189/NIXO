# NIXO vault (`nixo-vault.testnet`)

Layer 2 deposit vault — **separate** from the certificate contract (`nixo.testnet`).

## Behaviour

1. `deposit` (payable) → cross-contract `nixo.is_clean(predecessor)` → provenance row or full NEAR refund.
2. Owner `assign` / `revoke` / `withdraw` with per-tx + window caps, expiry, allowlist.
3. Agent `execute` (FC-key limited to this method): PRD check order, debit-before-outbound, rollback on failure. `dry_run=true` debits remaining without transferring.
4. Optional `commit_trade_hash` for encrypted trade-log commitments.

## Build / test / deploy

```bash
cargo test --locked          # unit + acceptance matrix
pnpm build:vault             # from repo root
scripts/deploy-vault-testnet.sh nixo-vault.testnet nixo-vault.testnet nixo.testnet
scripts/vault-fc-key.sh      # AGENT=… VAULT=nixo-vault.testnet
```

Init args: `{"owner":"…","nixo_contract":"nixo.testnet"}`.
