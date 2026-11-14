#!/usr/bin/env bash
# Deploy the NIXO verifier contract to testnet, pinned to the current checker WASM.
#
# Prereqs: near-cli-rs, cargo-near, and the contract account already created, e.g.
#   near account create-account sponsor-by-faucet-service nixo.testnet autogenerate-new-keypair save-to-keychain network-config testnet create
#
# Usage:
#   CHECKER_URL=https://.../nixo_checker.wasm scripts/deploy-testnet.sh [contract-account] [owner-account]
# CHECKER_URL must serve exactly the WASM built here (OutLayer checks the SHA-256).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTRACT="${1:-nixo.testnet}"
OWNER="${2:-$CONTRACT}"
OUTLAYER="${OUTLAYER:-outlayer.testnet}"
TIMELOCK_NS="${TIMELOCK_NS:-300000000000}"        # 5 min on testnet; 48h default on mainnet
CERT_TTL_NS="${CERT_TTL_NS:-604800000000000}"     # 7 days
: "${CHECKER_URL:?set CHECKER_URL to an https URL serving the checker WASM}"

(cd "$ROOT/checker" && cargo build --release --locked --target wasm32-wasip2)
WASM="$ROOT/checker/target/wasm32-wasip2/release/nixo_checker.wasm"
HASH="$(shasum -a 256 "$WASM" | cut -d' ' -f1)"
REMOTE="$(curl -fsSL "$CHECKER_URL" | shasum -a 256 | cut -d' ' -f1)"
[ "$HASH" = "$REMOTE" ] || { echo "CHECKER_URL serves $REMOTE, local build is $HASH" >&2; exit 1; }
echo "checker_hash=$HASH"

(cd "$ROOT/contract" && cargo near build non-reproducible-wasm)
ARGS=$(printf '{"owner":"%s","outlayer":"%s","checker":{"hash":"%s","url":"%s"},"timelock_ns":"%s","cert_ttl_ns":"%s"}' \
  "$OWNER" "$OUTLAYER" "$HASH" "$CHECKER_URL" "$TIMELOCK_NS" "$CERT_TTL_NS")

near contract deploy "$CONTRACT" \
  use-file "$ROOT/contract/target/near/nixo_contract.wasm" \
  with-init-call new json-args "$ARGS" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send

near contract call-function as-read-only "$CONTRACT" get_config json-args '{}' network-config testnet now
