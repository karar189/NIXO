#!/usr/bin/env bash
# Start web (3000), agents (AGENTS_PORT, default 8000) and backend (BACKEND_PORT,
# default 4000) together, with the repo-root .env exported into all three.
# Ctrl-C stops everything. Run `pnpm setup` once first.
set -euo pipefail
cd "$(dirname "$0")/.."

# Export the root .env literally. It is a dotenv file, not shell: values are
# never evaluated (no expansion, globbing or redirects), and one pair of
# surrounding quotes is stripped.
if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}" val="${BASH_REMATCH[2]}"
    if [[ "$val" =~ ^\"(.*)\"$ || "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
    export "$key=$val"
  done < .env
else
  echo "note: no .env at repo root (see .env.example)"
fi
[[ -x agents/.venv/bin/uvicorn ]] || { echo "agents venv missing: run 'pnpm setup'"; exit 1; }
[[ -d backend/node_modules ]] || { echo "backend deps missing: run 'pnpm setup'"; exit 1; }

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; wait 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd agents && exec .venv/bin/uvicorn app.main:app --reload --port "${AGENTS_PORT:-8000}") 2>&1 | sed -u 's/^/[agents]  /' & pids+=($!)
(cd backend && exec npm run --silent start:dev) 2>&1 | sed -u 's/^/[backend] /' & pids+=($!)
(exec pnpm --filter web dev) 2>&1 | sed -u 's/^/[web]     /' & pids+=($!)

wait
