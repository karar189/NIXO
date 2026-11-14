# Fictional sample documents (Privacy / Private AI)

Judges can run the Private AI flow without real wallets or bank data.
These JSON files are **synthetic**: they mimic a public NIXO certificate
payload (what an exchange already sees on-chain). The model never receives
transaction history, balances, or counterparties.

| File | Story |
|---|---|
| `alice-clean.cert.json` | Clean funds passport — Alice |
| `mallory-rejected.cert.json` | Rejected — Mallory (`taint_path`) |
| `expense-memo.clean.json` | Fictional “expense memo” framing of a clean cert (track-style sample) |

Used by `/private-ai` and `POST /api/private-ai`. Nothing is written to disk
or a database after the response returns.
