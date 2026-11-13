//! I/O shell around the proven core. Parses input, normalizes and hashes
//! addresses, loads the pinned lists, and encodes the output.
//!
//! Fail-closed rule: every error path returns `Rejected(reason)`. The only way
//! to emit `clean` is `crate::verdict()` returning `Verdict::Clean`.

use crate::{verdict, Addr, Reason, Verdict};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const CHECKER_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Release tag of safe-fndn/sanctions-address-lists the lists were pinned from.
pub const LIST_SNAPSHOT: &str = "data-2026-10-29";
/// Hop depth traced in this version: direct counterparties only.
pub const TRACE_DEPTH: u8 = 1;

/// Pinned lists, compiled into the WASM so the code hash pins them too.
const LISTS: &[(&str, &str)] = &[
    ("us-ofac", include_str!("../lists/us-ofac.txt")),
    ("eu", include_str!("../lists/eu.txt")),
    ("uk", include_str!("../lists/uk.txt")),
    ("un", include_str!("../lists/un.txt")),
    ("ch-seco", include_str!("../lists/ch-seco.txt")),
    ("hackers", include_str!("../lists/hackers.txt")),
];

/// On-chain input, built by the NIXO contract. It carries only the account:
/// OutLayer `input_data` is public, so the history must never travel in it.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    /// NEAR account requesting the certificate (set by the contract to the caller).
    pub account: String,
}

/// A user's confidential history.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct History {
    pub account: String,
    pub history: Vec<Tx>,
}

/// Where the history came from. MVP: simulated fixtures compiled into the WASM.
/// v1: 1Click session read inside the enclave.
pub const HISTORY_SOURCE: &str = "fixture";

const FIXTURES: &[&str] = &[
    include_str!("../../fixtures/alice.json"),
    include_str!("../../fixtures/mallory.json"),
];

/// History source adapter. Unknown account => None => fail closed.
pub fn load_history(account: &str) -> Option<History> {
    FIXTURES
        .iter()
        .filter_map(|f| serde_json::from_str::<History>(f).ok())
        .find(|h| normalize(&h.account) == account)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tx {
    pub tx_id: String,
    pub chain: String,
    pub direction: String,
    pub counterparty: String,
    pub asset: String,
    pub amount: String,
}

/// The only thing that leaves the enclave. No addresses, amounts or counts.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Output {
    pub account: String,
    pub verdict: &'static str,
    pub reason: Option<&'static str>,
    pub checker_version: &'static str,
    pub list_snapshot: &'static str,
    pub list_hash: String,
    pub trace_depth: u8,
    pub history_source: &'static str,
    pub input_hash: String,
}

/// Canonical form: trimmed; EVM `0x` addresses lowercased; NEAR accounts
/// lowercased; everything else (e.g. base58 Solana) kept as-is.
pub fn normalize(raw: &str) -> String {
    let s = raw.trim();
    let is_evm = s.len() == 42 && (s.starts_with("0x") || s.starts_with("0X"));
    let is_near = s.ends_with(".near") || s.ends_with(".testnet") || s.ends_with(".tg");
    if is_evm || is_near {
        s.to_ascii_lowercase()
    } else {
        s.to_string()
    }
}

pub fn addr(raw: &str) -> Addr {
    Sha256::digest(normalize(raw).as_bytes()).into()
}

fn list_entries(text: &str) -> impl Iterator<Item = &str> {
    text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#'))
}

/// All banned addresses across the pinned lists, hashed, sorted, deduplicated.
pub fn banned() -> Vec<Addr> {
    let mut v: Vec<Addr> = LISTS.iter().flat_map(|(_, t)| list_entries(t)).map(addr).collect();
    v.sort_unstable();
    v.dedup();
    v
}

/// SHA-256 over `name\0contents\0` for each list in order.
pub fn list_hash() -> String {
    let mut h = Sha256::new();
    for (name, text) in LISTS {
        h.update(name.as_bytes());
        h.update([0]);
        h.update(text.as_bytes());
        h.update([0]);
    }
    hex::encode(h.finalize())
}

/// Depth-1 trace: the account itself plus every direct counterparty.
pub fn trace(h: &History) -> Vec<Addr> {
    let mut v: Vec<Addr> = std::iter::once(h.account.as_str())
        .chain(h.history.iter().map(|t| t.counterparty.as_str()))
        .map(addr)
        .collect();
    v.sort_unstable();
    v.dedup();
    v
}

/// Full check: raw input bytes in, output out. Never panics on bad input.
pub fn run(raw: &[u8]) -> Output {
    let input_hash = hex::encode(Sha256::digest(raw));
    let (account, v) = match serde_json::from_slice::<Input>(raw) {
        Ok(input) if !input.account.trim().is_empty() => {
            let account = normalize(&input.account);
            let v = match load_history(&account) {
                Some(h) => verdict(&trace(&h), &banned()),
                None => Verdict::Rejected(Reason::HistoryUnavailable),
            };
            (account, v)
        }
        _ => (String::new(), Verdict::Rejected(Reason::MalformedInput)),
    };
    let (verdict, reason) = match v {
        Verdict::Clean => ("clean", None),
        Verdict::Rejected(r) => ("rejected", Some(r.code())),
    };
    Output {
        account,
        verdict,
        reason,
        checker_version: CHECKER_VERSION,
        list_snapshot: LIST_SNAPSHOT,
        list_hash: list_hash(),
        trace_depth: TRACE_DEPTH,
        history_source: HISTORY_SOURCE,
        input_hash,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALICE: &[u8] = br#"{"account":"nixo-alice.testnet"}"#;
    const MALLORY: &[u8] = br#"{"account":"nixo-mallory.testnet"}"#;

    #[test]
    fn alice_is_clean() {
        let o = run(ALICE);
        assert_eq!(o.account, "nixo-alice.testnet");
        assert_eq!((o.verdict, o.reason), ("clean", None));
    }

    #[test]
    fn mallory_is_rejected_without_revealing_address() {
        let o = run(MALLORY);
        assert_eq!((o.verdict, o.reason), ("rejected", Some("list_hit")));
        let json = serde_json::to_string(&o).unwrap();
        assert!(!json.contains("flagged"));
    }

    #[test]
    fn real_ofac_entry_is_hit() {
        let first = list_entries(include_str!("../lists/us-ofac.txt")).next().unwrap();
        let h = History {
            account: "x.testnet".into(),
            history: vec![Tx {
                tx_id: "t".into(), chain: "eth".into(), direction: "in".into(),
                counterparty: first.to_uppercase().replacen("0X", "0x", 1),
                asset: "eth".into(), amount: "1".into(),
            }],
        };
        assert_eq!(verdict(&trace(&h), &banned()), Verdict::Rejected(Reason::ListHit));
    }

    #[test]
    fn unknown_account_fails_closed() {
        let o = run(br#"{"account":"stranger.testnet"}"#);
        assert_eq!((o.verdict, o.reason), ("rejected", Some("history_unavailable")));
    }

    #[test]
    fn history_in_input_is_refused() {
        let o = run(br#"{"account":"nixo-mallory.testnet","history":[]}"#);
        assert_eq!(o.reason, Some("malformed_input"));
    }

    #[test]
    fn output_fits_outlayer_limit() {
        assert!(serde_json::to_string(&run(ALICE)).unwrap().len() < 900);
    }

    #[test]
    fn garbage_fails_closed() {
        for raw in [&b""[..], b"{", b"null", br#"{"account":""}"#, br#"{"account":"a.testnet","x":1}"#] {
            let o = run(raw);
            assert_eq!((o.verdict, o.reason), ("rejected", Some("malformed_input")));
        }
    }

    #[test]
    fn deterministic() {
        assert_eq!(run(ALICE), run(ALICE));
        assert!(banned().len() > 100);
    }
}
