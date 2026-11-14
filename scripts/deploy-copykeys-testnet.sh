#!/usr/bin/env bash
# Deploy the copy-keys contract (paid viewing keys for copy trading) to testnet.
# Separate from nixo.testnet (passport) and nixo-vault.testnet (vault).
#
# Prereqs: near-cli-rs, cargo-near, and the account created, e.g.
#   near account create-account sponsor-by-faucet-service nixo-keys.testnet \
#     autogenerate-new-keypair save-to-keychain network-config testnet create
#
# Usage:
#   scripts/deploy-copykeys-testnet.sh [keys-account] [owner]
# Then set NIXO_KEYS_CONTRACT (agents) and NEXT_PUBLIC_NIXO_KEYS_CONTRACT (web) in .env.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEYS="${1:-nixo-keys.testnet}"
OWNER="${2:-$KEYS}"

(cd "$ROOT/copykeys" && cargo near build non-reproducible-wasm)
ARGS=$(printf '{"owner":"%s"}' "$OWNER")

# Prefer macOS/OS keychain (faucet create-account default); fall back to ~/.near-credentials.
SIGN_ARGS=(network-config testnet sign-with-keychain send)
if [[ -f "${HOME}/.near-credentials/testnet/${KEYS}.json" ]]; then
  SIGN_ARGS=(network-config testnet sign-with-legacy-keychain send)
fi

near contract deploy "$KEYS" \
  use-file "$ROOT/copykeys/target/near/nixo_copykeys.wasm" \
  with-init-call new json-args "$ARGS" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
  "${SIGN_ARGS[@]}"

near contract call-function as-read-only "$KEYS" list_listings json-args '{}' network-config testnet now
