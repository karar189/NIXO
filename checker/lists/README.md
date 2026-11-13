# Pinned screening lists

Compiled into the checker WASM with `include_str!`, so the WASM hash pins the list version too.

| File | Source | Snapshot |
|------|--------|----------|
| `us-ofac.txt`, `eu.txt`, `uk.txt`, `un.txt`, `ch-seco.txt` | [safe-fndn/sanctions-address-lists](https://github.com/safe-fndn/sanctions-address-lists) release `data-2026-10-29` (EVM addresses only) | 2026-10-29 |
| `manifest.json` | Same release, source hashes and fetch metadata | 2026-10-29 |
| `hackers.txt` | Curated by NIXO; currently only a synthetic demo address | n/a |

Refresh: `scripts/update-lists.sh <release-tag>`, then rebuild the WASM and propose the new hash on-chain.
