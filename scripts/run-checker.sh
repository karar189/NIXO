#!/usr/bin/env bash
# Re-run the checker locally, exactly as the TEE does: input on stdin, verdict on stdout.
# Usage: scripts/run-checker.sh nixo-alice.testnet
set -euo pipefail
ACCOUNT="${1:?account, e.g. nixo-alice.testnet}"
WASM="$(dirname "$0")/../checker/target/wasm32-wasip2/release/nixo_checker.wasm"
[ -f "$WASM" ] || (cd "$(dirname "$0")/../checker" && cargo build --release --target wasm32-wasip2 >&2)
printf '{"account":"%s"}' "$ACCOUNT" | wasmtime run "$WASM"
echo
