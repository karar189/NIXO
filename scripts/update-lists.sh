#!/usr/bin/env bash
# Usage: scripts/update-lists.sh data-YYYY-MM-DD
set -euo pipefail
TAG="${1:?release tag, e.g. data-2026-10-29}"
DIR="$(cd "$(dirname "$0")/../checker/lists" && pwd)"
B="https://github.com/safe-fndn/sanctions-address-lists/releases/download/$TAG"
for s in us-ofac eu uk un ch-seco; do curl -fsSL -o "$DIR/$s.txt" "$B/$s.txt"; done
curl -fsSL -o "$DIR/manifest.json" "$B/manifest.json"
echo "Updated lists to $TAG. Update LIST_SNAPSHOT in checker/src/shell.rs."
