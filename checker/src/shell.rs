//! I/O shell around the proven core. Parses input, normalizes and hashes
//! addresses, loads the pinned lists, and encodes the output.
//!
//! Fail-closed rule: every error path returns `Rejected(reason)`. The only way
//! to emit `clean` is `crate::verdict()` returning `Verdict::Clean`.

use crate::{trace, verdict, Addr, Reason, Verdict};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const CHECKER_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Release tag of safe-fndn/sanctions-address-lists the lists were pinned from.
pub const LIST_SNAPSHOT: &str = "data-2026-10-29";
/// Hop limit of the multi-hop trace (reported on-chain as `trace_depth`).
pub const TRACE_DEPTH: u8 = trace::MAX_HOPS;
/// A token younger than this at trade time is flagged "fresh" on pool hops.
pub const FRESH_TOKEN_NS: u64 = 7 * 86_400 * 1_000_000_000;

/// Pinned lists, compiled into the WASM so the code hash pins them too.
const LISTS: &[(&str, &str)] = &[
    ("us-ofac", include_str!("../lists/us-ofac.txt")),
    ("eu", include_str!("../lists/eu.txt")),
    ("uk", include_str!("../lists/uk.txt")),
    ("un", include_str!("../lists/un.txt")),
    ("ch-seco", include_str!("../lists/ch-seco.txt")),
    ("hackers", include_str!("../lists/hackers.txt")),
];

/// Input.
///
/// Certified mode (what the NIXO contract sends through OutLayer): `account`
/// and optionally `network`. History is fetched inside the enclave from
/// NearBlocks v3 (or from labelled fixtures when `NIXO_OFFLINE=1`).
///
/// Preview mode (web "check any wallet"): `account` plus a fetched `history`.
/// The result is marked `history_source: "caller_supplied"`, and the contract
/// refuses to certify it, because a caller could leave edges out.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    pub account: String,
    /// Optional network override (`mainnet` / `testnet`). Must match the account.
    #[serde(default)]
    pub network: Option<String>,
    #[serde(default)]
    pub history: Option<HistoryDoc>,
}

/// Normalized history, as written by web/lib/history/fetcher.ts.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HistoryDoc {
    pub version: u8,
    pub subject: String,
    pub network: String,
    pub source: String,
    pub fetched_at: String,
    pub max_hops: u8,
    /// Accounts whose inflows were listed completely.
    pub expanded: Vec<String>,
    pub incomplete: Vec<Incomplete>,
    pub edges: Vec<Edge>,
    /// For testnet demo accounts that replay a real mainnet trail.
    #[serde(default)]
    pub replay_of: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Incomplete {
    pub account: String,
    pub reason: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum Edge {
    Transfer {
        from: String,
        to: String,
        amount: String,
        token: String,
        tx_hash: String,
        timestamp: String,
    },
    Swap {
        account: String,
        venue: String,
        pool_id: u32,
        token_in: String,
        amount_in: String,
        token_out: String,
        amount_out: String,
        tx_hash: String,
        timestamp: String,
        #[serde(default)]
        token_created_at: Option<String>,
    },
}

/// Where the history came from.
pub const SOURCE_FIXTURE: &str = "fixture";
pub const SOURCE_CALLER: &str = "caller_supplied";

/// Histories compiled into the WASM for offline / CI (`NIXO_OFFLINE=1`).
const FIXTURES: &[&str] = &[
    include_str!("../../fixtures/alice.json"),
    include_str!("../../fixtures/mallory.json"),
];

/// Documented offline switch: fixtures only. Never used as a silent fallback
/// after a failed live fetch.
pub fn offline_fixtures_enabled() -> bool {
    fn truthy(v: Result<String, std::env::VarError>) -> bool {
        matches!(v.ok().as_deref(), Some("1" | "true" | "TRUE" | "yes" | "YES"))
    }
    truthy(std::env::var("NIXO_OFFLINE")) || truthy(std::env::var("NIXO_USE_FIXTURES")) || cfg!(test)
}

/// Fixture history for offline mode. Unknown account => None => fail closed.
pub fn load_history(account: &str) -> Option<HistoryDoc> {
    FIXTURES
        .iter()
        .filter_map(|f| serde_json::from_str::<HistoryDoc>(f).ok())
        .find(|h| normalize(&h.subject) == account)
}

/// NEAR account ids from the pinned lists (EVM `0x…` skipped). Used as live-fetch seeds.
pub fn listed_near_accounts() -> std::collections::HashSet<String> {
    let mut s = std::collections::HashSet::new();
    for (_, text) in LISTS {
        for line in list_entries(text) {
            let n = normalize(line);
            let is_near = n.ends_with(".near") || n.ends_with(".testnet") || n.ends_with(".tg");
            let is_implicit = n.len() == 64 && n.bytes().all(|b| b.is_ascii_hexdigit());
            if is_near || is_implicit {
                s.insert(n);
            }
        }
    }
    s
}

/// One hop of a taint path, as shown in the preview (never on-chain).
#[derive(Debug, Serialize, PartialEq, Eq, Clone)]
pub struct Hop {
    /// "transfer" or "pool"
    pub kind: &'static str,
    pub from: String,
    pub to: String,
    /// yocto amount that reached `to` (for a pool hop: what came out of the pool)
    pub amount: String,
    pub token: String,
    /// transfer: [tx]; pool: [swap in, swap out]
    pub tx_hashes: Vec<String>,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pool_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pool_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seconds_apart: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount_diff_bps: Option<u128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fresh_token: Option<bool>,
    pub weak: bool,
}

/// The output. In certified mode it carries no addresses, amounts or paths:
/// only the verdict, the reason and the hop count.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Output {
    pub account: String,
    pub verdict: &'static str,
    pub reason: Option<&'static str>,
    /// Links between the listed address and the account (taint_path only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hops: Option<u8>,
    pub checker_version: &'static str,
    pub list_snapshot: &'static str,
    pub list_hash: String,
    pub trace_depth: u8,
    pub history_source: String,
    pub input_hash: String,
    /// Preview only: the path, listed address first.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<Vec<Hop>>,
    /// Preview only: what could not be listed (why a result is incomplete).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub incomplete: Option<Vec<String>>,
}

/// Canonical form: trimmed; EVM `0x` addresses lowercased; NEAR accounts
/// (named or 64-hex implicit) lowercased; everything else kept as-is.
pub fn normalize(raw: &str) -> String {
    let s = raw.trim();
    let is_evm = s.len() == 42 && (s.starts_with("0x") || s.starts_with("0X"));
    let is_near = s.ends_with(".near") || s.ends_with(".testnet") || s.ends_with(".tg");
    let is_implicit = s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit());
    if is_evm || is_near || is_implicit {
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

/// What a link means, for rendering the path.
#[derive(Debug, Clone)]
struct LinkInfo {
    hop: Hop,
}

/// The money graph built from a history: node ids, links, and link details.
pub struct Graph {
    pub names: Vec<String>,
    pub links: Vec<trace::Link>,
    info: Vec<LinkInfo>,
}

fn parse_u64(s: &str) -> Option<u64> {
    s.parse().ok()
}
fn parse_u128(s: &str) -> Option<u128> {
    s.parse().ok()
}

/// Build links: transfers as-is, plus pool hops found by the pool-hop rule.
/// Returns None if any edge is malformed (fail closed).
pub fn build_graph(doc: &HistoryDoc) -> Option<Graph> {
    use std::collections::BTreeMap;
    let mut ids: BTreeMap<String, u32> = BTreeMap::new();
    let mut names: Vec<String> = Vec::new();
    let id = |name: &str, ids: &mut BTreeMap<String, u32>, names: &mut Vec<String>| -> u32 {
        let n = normalize(name);
        if let Some(&i) = ids.get(&n) {
            return i;
        }
        let i = names.len() as u32;
        ids.insert(n.clone(), i);
        names.push(n);
        i
    };
    id(&doc.subject, &mut ids, &mut names);
    let mut links = Vec::new();
    let mut info = Vec::new();
    struct Swap<'a> {
        account: &'a str,
        venue: &'a str,
        pool_id: u32,
        token_in: &'a str,
        amount_in: u128,
        token_out: &'a str,
        amount_out: u128,
        tx: &'a str,
        t: u64,
        created: Option<u64>,
    }
    let mut swaps: Vec<Swap> = Vec::new();
    for e in &doc.edges {
        match e {
            Edge::Transfer { from, to, amount, token, tx_hash, timestamp } => {
                parse_u128(amount)?;
                let t = parse_u64(timestamp)?;
                let (f, d) = (id(from, &mut ids, &mut names), id(to, &mut ids, &mut names));
                links.push(trace::Link { from: f, to: d, t, weak: false });
                info.push(LinkInfo {
                    hop: Hop {
                        kind: "transfer",
                        from: normalize(from),
                        to: normalize(to),
                        amount: amount.clone(),
                        token: token.clone(),
                        tx_hashes: vec![tx_hash.clone()],
                        timestamp: timestamp.clone(),
                        pool_id: None,
                        pool_token: None,
                        seconds_apart: None,
                        amount_diff_bps: None,
                        fresh_token: None,
                        weak: false,
                    },
                });
            }
            Edge::Swap { account, venue, pool_id, token_in, amount_in, token_out, amount_out, tx_hash, timestamp, token_created_at } => {
                let created = match token_created_at {
                    Some(c) => Some(parse_u64(c)?),
                    None => None,
                };
                swaps.push(Swap {
                    account,
                    venue,
                    pool_id: *pool_id,
                    token_in,
                    amount_in: parse_u128(amount_in)?,
                    token_out,
                    amount_out: parse_u128(amount_out)?,
                    tx: tx_hash,
                    t: parse_u64(timestamp)?,
                    created,
                });
            }
        }
    }
    // Pool-hop rule: A swaps into pool P, B swaps out of P (opposite direction)
    // within POOL_WINDOW_NS, and what A put in matches what B took out within
    // ±15%. Funds are linked A -> B at the time of B's swap.
    for a in &swaps {
        for b in &swaps {
            if a.venue != b.venue || a.pool_id != b.pool_id || normalize(a.account) == normalize(b.account) {
                continue;
            }
            if a.token_in != b.token_out || a.token_out != b.token_in {
                continue;
            }
            if b.t < a.t || b.t - a.t > trace::POOL_WINDOW_NS {
                continue;
            }
            let Some(bps) = trace::pool_match_bps(a.amount_in, b.amount_out) else { continue };
            let weak = bps > trace::POOL_WEAK_BPS;
            let (f, d) = (id(a.account, &mut ids, &mut names), id(b.account, &mut ids, &mut names));
            links.push(trace::Link { from: f, to: d, t: b.t, weak });
            let created = a.created.or(b.created);
            info.push(LinkInfo {
                hop: Hop {
                    kind: "pool",
                    from: normalize(a.account),
                    to: normalize(b.account),
                    amount: b.amount_out.to_string(),
                    token: b.token_out.to_string(),
                    tx_hashes: vec![a.tx.to_string(), b.tx.to_string()],
                    timestamp: b.t.to_string(),
                    pool_id: Some(a.pool_id),
                    pool_token: Some(a.token_out.to_string()),
                    seconds_apart: Some((b.t - a.t) / 1_000_000_000),
                    amount_diff_bps: Some(bps),
                    fresh_token: created.map(|c| a.t.saturating_sub(c) < FRESH_TOKEN_NS),
                    weak,
                },
            });
        }
    }
    Some(Graph { names, links, info })
}

/// Account + direct counterparties (both directions), for the proven list check.
fn direct(g: &Graph, subject: u32) -> Vec<Addr> {
    let mut v: Vec<Addr> = std::iter::once(subject)
        .chain(g.links.iter().filter(|l| l.to == subject).map(|l| l.from))
        .chain(g.links.iter().filter(|l| l.from == subject).map(|l| l.to))
        .map(|n| addr(&g.names[n as usize]))
        .collect();
    v.sort_unstable();
    v.dedup();
    v
}

/// Verdict for a history, plus the path (link indices) when tainted.
pub fn assess(doc: &HistoryDoc, banned: &[Addr]) -> (Verdict, Option<Vec<Hop>>) {
    let Some(g) = build_graph(doc) else {
        return (Verdict::Rejected(Reason::MalformedInput), None);
    };
    let subject = 0u32; // build_graph registers the subject first
    // 1. Proven list check on the account and its direct counterparties.
    let v = verdict(&direct(&g, subject), banned);
    if v != Verdict::Clean {
        return (v, None);
    }
    // 2. Multi-hop search.
    let listed: Vec<bool> = g.names.iter().map(|n| banned.binary_search(&addr(n)).is_ok()).collect();
    let incomplete_accounts: Vec<String> = doc.incomplete.iter().map(|i| normalize(&i.account)).collect();
    let complete: Vec<bool> = g
        .names
        .iter()
        .map(|n| doc.expanded.iter().any(|e| normalize(e) == *n) && !incomplete_accounts.contains(n))
        .collect();
    let hops = doc.max_hops.min(trace::MAX_HOPS);
    match trace::search(&g.links, subject, &listed, &complete, hops) {
        trace::Outcome::Clean => (Verdict::Clean, None),
        trace::Outcome::Incomplete => (Verdict::Rejected(Reason::HistoryIncomplete), None),
        trace::Outcome::Tainted { path, weak } => {
            let hops = path.iter().map(|&i| g.info[i].hop.clone()).collect();
            if weak {
                (Verdict::Warn(Reason::TaintPath), Some(hops))
            } else {
                (Verdict::Rejected(Reason::TaintPath), Some(hops))
            }
        }
    }
}

/// Full check: raw input bytes in, output out. Never panics on bad input.
pub fn run(raw: &[u8]) -> Output {
    let input_hash = hex::encode(Sha256::digest(raw));
    let banned = banned();
    let mut source = String::new();
    let mut incomplete_notes = None;
    let (account, v, path) = match serde_json::from_slice::<Input>(raw) {
        Ok(input) if !input.account.trim().is_empty() => {
            let account = normalize(&input.account);
            let doc = match input.history {
                Some(doc) => {
                    source = SOURCE_CALLER.to_string();
                    (normalize(&doc.subject) == account).then_some(doc)
                }
                None if offline_fixtures_enabled() => {
                    source = SOURCE_FIXTURE.to_string();
                    load_history(&account)
                }
                None => match crate::live::fetch_history(&account, input.network.as_deref()) {
                    Ok((doc, src)) => {
                        source = src;
                        Some(doc)
                    }
                    Err(_) => {
                        // Fail closed — never fall through to fixtures after a live miss.
                        source = "nearblocks-v3:unavailable".to_string();
                        None
                    }
                },
            };
            match doc {
                Some(doc) => {
                    if source == SOURCE_CALLER && !doc.incomplete.is_empty() {
                        incomplete_notes = Some(doc.incomplete.iter().take(10).map(|i| format!("{}: {}", i.account, i.reason)).collect());
                    }
                    let (v, path) = assess(&doc, &banned);
                    (account, v, path)
                }
                None if source == SOURCE_CALLER => (account, Verdict::Rejected(Reason::MalformedInput), None),
                None => (account, Verdict::Rejected(Reason::HistoryUnavailable), None),
            }
        }
        _ => (String::new(), Verdict::Rejected(Reason::MalformedInput), None),
    };
    let (verdict, reason) = match v {
        Verdict::Clean => ("clean", None),
        Verdict::Warn(r) => ("warn", Some(r.code())),
        Verdict::Rejected(r) => ("rejected", Some(r.code())),
    };
    let hops = path.as_ref().map(|p| p.len() as u8).filter(|&n| n > 0);
    let is_caller = source == SOURCE_CALLER;
    Output {
        account,
        verdict,
        reason,
        hops,
        checker_version: CHECKER_VERSION,
        list_snapshot: LIST_SNAPSHOT,
        list_hash: list_hash(),
        trace_depth: TRACE_DEPTH,
        history_source: source,
        input_hash,
        // The path never goes on-chain: only previews (caller-supplied) get it.
        path: if is_caller { path } else { None },
        incomplete: incomplete_notes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALICE: &[u8] = br#"{"account":"nixo-alice.testnet"}"#;
    const SEED: &str = "efd224256518a7cacd209867963276efed302a8e222c013c43f4b1bd369ae5af";
    const S: u64 = 1_000_000_000;

    fn doc(subject: &str, expanded: &[&str], edges: Vec<Edge>) -> HistoryDoc {
        HistoryDoc {
            version: 1,
            subject: subject.into(),
            network: "test".into(),
            source: "unit-test".into(),
            fetched_at: String::new(),
            max_hops: 6,
            expanded: expanded.iter().map(|s| s.to_string()).collect(),
            incomplete: vec![],
            edges,
            replay_of: None,
            note: None,
        }
    }
    fn transfer(from: &str, to: &str, t: u64) -> Edge {
        Edge::Transfer { from: from.into(), to: to.into(), amount: "1000".into(), token: "NEAR".into(), tx_hash: format!("t-{from}-{to}"), timestamp: t.to_string() }
    }
    /// Swap of `amount_in` token_in for `amount_out` token_out in pool 1.
    fn swap(account: &str, token_in: &str, amount_in: u128, token_out: &str, amount_out: u128, t: u64) -> Edge {
        Edge::Swap {
            account: account.into(),
            venue: "v2.ref-finance.near".into(),
            pool_id: 1,
            token_in: token_in.into(),
            amount_in: amount_in.to_string(),
            token_out: token_out.into(),
            amount_out: amount_out.to_string(),
            tx_hash: format!("s-{account}"),
            timestamp: t.to_string(),
            token_created_at: None,
        }
    }
    /// seed -> a (transfer), a swaps NEAR->MEME, b swaps MEME->NEAR `dt` s later.
    fn pool_case(near_out: u128, dt: u64, b_direction_ok: bool) -> HistoryDoc {
        let b = if b_direction_ok {
            swap("b.near", "meme.near", 500, "wrap.near", near_out, 100 * S + dt * S)
        } else {
            swap("b.near", "wrap.near", 1000, "meme.near", 500, 100 * S + dt * S)
        };
        doc(
            "b.near",
            &["b.near", "a.near"],
            vec![transfer(SEED, "a.near", 50 * S), swap("a.near", "wrap.near", 1000, "meme.near", 500, 100 * S), b],
        )
    }
    fn verdict_of(d: &HistoryDoc) -> Verdict {
        assess(d, &banned()).0
    }

    #[test]
    fn alice_is_clean() {
        let o = run(ALICE);
        assert_eq!(o.account, "nixo-alice.testnet");
        assert_eq!((o.verdict, o.reason, o.hops), ("clean", None, None));
        assert_eq!(o.history_source.as_str(), "fixture");
    }

    #[test]
    fn real_seed_is_listed() {
        assert!(banned().binary_search(&addr(SEED)).is_ok());
        assert!(banned().binary_search(&addr("nixo-demo-flagged.testnet")).is_err(), "demo entry removed");
    }

    #[test]
    fn seed_itself_is_list_hit() {
        let d = doc(SEED, &[SEED], vec![]);
        assert_eq!(verdict_of(&d), Verdict::Rejected(Reason::ListHit));
    }

    #[test]
    fn direct_counterparty_is_list_hit() {
        let d = doc("x.near", &["x.near"], vec![transfer(SEED, "x.near", 10)]);
        assert_eq!(verdict_of(&d), Verdict::Rejected(Reason::ListHit));
    }

    #[test]
    fn real_ofac_entry_is_hit() {
        let first = list_entries(include_str!("../lists/us-ofac.txt")).next().unwrap();
        let mixed = first.to_uppercase().replacen("0X", "0x", 1);
        let d = doc("x.near", &["x.near"], vec![transfer(&mixed, "x.near", 10)]);
        assert_eq!(verdict_of(&d), Verdict::Rejected(Reason::ListHit));
    }

    // ---- pool-hop rule ----
    #[test]
    fn pool_hop_links_matching_swaps() {
        let (v, path) = assess(&pool_case(1000, 20, true), &banned());
        assert_eq!(v, Verdict::Rejected(Reason::TaintPath));
        let path = path.unwrap();
        assert_eq!(path.len(), 2);
        assert_eq!((path[1].kind, path[1].pool_id, path[1].seconds_apart, path[1].weak), ("pool", Some(1), Some(20), false));
    }
    #[test]
    fn pool_hop_needs_opposite_direction() {
        assert_eq!(verdict_of(&pool_case(1000, 20, false)), Verdict::Clean);
    }
    #[test]
    fn pool_hop_needs_amounts_within_15_percent() {
        assert_eq!(verdict_of(&pool_case(1150, 20, true)), Verdict::Warn(Reason::TaintPath)); // 15%: weak
        assert_eq!(verdict_of(&pool_case(1151, 20, true)), Verdict::Clean); // >15%: no link
        assert_eq!(verdict_of(&pool_case(880, 20, true)), Verdict::Rejected(Reason::TaintPath)); // 12%: strong
    }
    #[test]
    fn pool_hop_needs_window_of_120s() {
        assert_eq!(verdict_of(&pool_case(1000, 120, true)), Verdict::Rejected(Reason::TaintPath));
        assert_eq!(verdict_of(&pool_case(1000, 121, true)), Verdict::Clean);
    }

    // ---- fail closed ----
    #[test]
    fn unknown_account_fails_closed() {
        let o = run(br#"{"account":"stranger.testnet"}"#);
        assert_eq!((o.verdict, o.reason), ("rejected", Some("history_unavailable")));
    }
    #[test]
    fn unlisted_counterparty_fails_closed() {
        // a.near sent money to x.near, but a.near's own inflows were never listed
        let d = doc("x.near", &["x.near"], vec![transfer("a.near", "x.near", 10)]);
        assert_eq!(verdict_of(&d), Verdict::Rejected(Reason::HistoryIncomplete));
    }
    #[test]
    fn fetcher_incomplete_note_fails_closed() {
        let mut d = doc("x.near", &["x.near", "a.near"], vec![transfer("a.near", "x.near", 10)]);
        d.incomplete.push(Incomplete { account: "a.near".into(), reason: "more than 400 receipts".into() });
        assert_eq!(verdict_of(&d), Verdict::Rejected(Reason::HistoryIncomplete));
    }
    #[test]
    fn malformed_edges_fail_closed() {
        let mut d = doc("x.near", &["x.near"], vec![]);
        d.edges.push(Edge::Transfer { from: "a".into(), to: "x.near".into(), amount: "lots".into(), token: "NEAR".into(), tx_hash: "h".into(), timestamp: "1".into() });
        assert_eq!(verdict_of(&d), Verdict::Rejected(Reason::MalformedInput));
    }
    #[test]
    fn preview_subject_must_match_account() {
        let raw = br#"{"account":"x.near","history":{"version":1,"subject":"y.near","network":"mainnet","source":"t","fetched_at":"","max_hops":6,"expanded":["y.near"],"incomplete":[],"edges":[]}}"#;
        let o = run(raw);
        assert_eq!((o.verdict, o.reason, o.history_source.as_str()), ("rejected", Some("malformed_input"), "caller_supplied"));
    }
    #[test]
    fn caller_supplied_history_is_marked() {
        let raw = br#"{"account":"y.near","history":{"version":1,"subject":"y.near","network":"mainnet","source":"t","fetched_at":"","max_hops":6,"expanded":["y.near"],"incomplete":[],"edges":[]}}"#;
        let o = run(raw);
        assert_eq!((o.verdict, o.history_source.as_str()), ("clean", "caller_supplied"));
    }
    #[test]
    fn garbage_fails_closed() {
        for raw in [&b""[..], b"{", b"null", br#"{"account":""}"#, br#"{"account":"a.testnet","x":1}"#] {
            let o = run(raw);
            assert_eq!((o.verdict, o.reason), ("rejected", Some("malformed_input")));
        }
    }

    #[test]
    fn output_fits_outlayer_limit() {
        assert!(serde_json::to_string(&run(ALICE)).unwrap().len() < 900);
    }
    #[test]
    fn deterministic() {
        assert_eq!(run(ALICE), run(ALICE));
        assert!(banned().len() > 100);
    }
}
