# Certified demo fixtures

Compiled into the checker WASM for offline / CI / labelled fixture mode.

| File | Account | Role |
|---|---|---|
| `alice.json` | `nixo-alice.testnet` | Synthetic clean history (faucet + small outflows). No path to a listed address. |
| `mallory.json` | `nixo-mallory.testnet` | Replay of the documented mainnet trail ending at `farstreet4572.near` (Binance-hack seed → transfers → MEILI pool 9009 → sell). Subject renamed only; amounts and tx hashes are as on mainnet. |
| `mainnet/` | various | Cached NearBlocks fetches for the `/verify` preview and regenerating replays (`pnpm fetch-history`, `pnpm make-replay`). |

Live enclave NearBlocks fetch (`checker/src/live.rs`) is the default. Fixtures are used only when `NIXO_OFFLINE=1` / `NIXO_USE_FIXTURES=1` (or `cfg!(test)`) — never silently after a failed live fetch.
