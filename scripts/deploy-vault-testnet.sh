#!/usr/bin/env bash
# Deploy the Layer 2 vault to testnet (separate from nixo.testnet).
#
# Prereqs: near-cli-rs, cargo-near, vault account created, e.g.
#   near account create-account sponsor-by-faucet-service nixo-vault.testnet \
#     autogenerate-new-keypair save-to-keychain network-config testnet create
#
# Usage:
#   scripts/deploy-vault-testnet.sh [vault-account] [owner] [nixo-contract]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="${1:-nixo-vault.testnet}"
OWNER="${2:-$VAULT}"
NIXO="${3:-nixo.testnet}"

(cd "$ROOT/vault" && cargo near build non-reproducible-wasm)
ARGS=$(printf '{"owner":"%s","nixo_contract":"%s"}' "$OWNER" "$NIXO")

near contract deploy "$VAULT" \
  use-file "$ROOT/vault/target/near/nixo_vault.wasm" \
  with-init-call new json-args "$ARGS" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send

near contract call-function as-read-only "$VAULT" get_config json-args '{}' network-config testnet now
