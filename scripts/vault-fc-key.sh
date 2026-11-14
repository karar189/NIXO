#!/usr/bin/env bash
# Add a function-call access key limited to vault `execute` (PRD agent key).
#
# Usage:
#   AGENT=agent.nixo-vault.testnet \
#   VAULT=nixo-vault.testnet \
#   ALLOWANCE=5 \
#   scripts/vault-fc-key.sh
#
# The agent account must already exist and you must control its full-access key.
set -euo pipefail
AGENT="${AGENT:?set AGENT to the agent account id}"
VAULT="${VAULT:-nixo-vault.testnet}"
ALLOWANCE="${ALLOWANCE:-5}"

echo "Adding FC key on $AGENT → $VAULT::execute (allowance ${ALLOWANCE} NEAR)"
near account add-key "$AGENT" \
  grant-function-call-access \
  --allowance "${ALLOWANCE} NEAR" \
  --contract-account-id "$VAULT" \
  --method-names execute \
  autogenerate-new-keypair \
  save-to-keychain \
  network-config testnet \
  sign-with-legacy-keychain \
  send

echo "Done. Keep the key offline; the vault still enforces caps/allowlist/revoke."
