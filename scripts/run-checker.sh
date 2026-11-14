#!/usr/bin/env bash
# Re-run the checker locally, exactly as the TEE does: input on stdin, verdict on stdout.
#
# Usage:
#   scripts/run-checker.sh nixo-alice.testnet              # offline fixtures (default locally)
#   NIXO_LIVE=1 scripts/run-checker.sh some.near           # live NearBlocks (needs network / API key)
#   NEARBLOCKS_API_KEY=... NIXO_LIVE=1 scripts/run-checker.sh farstreet4572.near
set -euo pipefail
ACCOUNT="${1:?account, e.g. nixo-alice.testnet}"
WASM="$(dirname "$0")/../checker/target/wasm32-wasip2/release/nixo_checker.wasm"
[ -f "$WASM" ] || (cd "$(dirname "$0")/../checker" && cargo build --release --locked --target wasm32-wasip2 >&2)

# Local default: labelled fixtures. OutLayer runs without NIXO_OFFLINE and fetches live.
ENV_ARGS=(--env "NIXO_OFFLINE=${NIXO_OFFLINE:-1}")
if [ "${NIXO_LIVE:-}" = "1" ]; then
  ENV_ARGS=(--env NIXO_OFFLINE=0)
  [ -n "${NEARBLOCKS_API_KEY:-}" ] && ENV_ARGS+=(--env "NEARBLOCKS_API_KEY=$NEARBLOCKS_API_KEY")
fi

# wasi:http is linked even for offline runs; enable it for wasmtime.
printf '{"account":"%s"}' "$ACCOUNT" | wasmtime -S http "${ENV_ARGS[@]}" "$WASM"
echo
