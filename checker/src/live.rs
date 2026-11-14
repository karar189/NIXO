//! Live history fetch inside the enclave from NearBlocks API v3.
//!
//! Called only in certified mode (account in, no caller-supplied history).
//! Fixtures are a separate offline path in `shell` — never used silently here.
//!
//! Caps are tight for OutLayer fuel/time. Hitting a cap on a non-terminal
//! account yields an incomplete note; `assess` then fails closed.

use crate::http_get::{get_json, HttpError};
use crate::shell::{normalize, Edge, HistoryDoc, Incomplete};
use crate::trace::{MAX_HOPS, POOL_WINDOW_NS};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};

const REF_MAIN: &str = "v2.ref-finance.near";
const REF_TEST: &str = "ref-finance.testnet";
const WNEAR_MAIN: &str = "wrap.near";
const WNEAR_TEST: &str = "wrap.testnet";
const FRESH_TOKEN_NS: u64 = 7 * 86_400 * 1_000_000_000;
const DUST_YOCTO: u128 = 10u128.pow(21); // 0.001 NEAR
const RECEIPT_PAGE: u32 = 50;
const MAX_RECEIPT_PAGES: u32 = 6;
const MAX_API_CALLS: u32 = 48;
/// Documented terminals: list-checked, never expanded (PRD §4.1 / §11).
fn is_terminal(account: &str, network: &str) -> bool {
    matches!(
        account,
        "system"
            | "near"
            | "aurora"
            | "aurora.near"
            | "intents.near"
            | "intents.testnet"
            | "aggregatedex.near"
            | "meta-pool.near"
            | "linear-protocol.near"
            | "lockup.near"
            | "faucet.testnet"
            | "testnet"
    ) || account == REF_MAIN
        || account == REF_TEST
        || account == WNEAR_MAIN
        || account == WNEAR_TEST
        || account.ends_with(".poolv1.near")
        || account.ends_with(".pool.near")
        || (network == "testnet" && (account.contains("faucet") || account.ends_with(".helper.testnet")))
}

fn is_dex_payer(account: &str) -> bool {
    matches!(
        account,
        "v2.ref-finance.near" | "ref-finance.testnet" | "aggregatedex.near" | "wrap.near" | "wrap.testnet"
    )
}

fn ref_venue(network: &str) -> &'static str {
    if network == "testnet" {
        REF_TEST
    } else {
        REF_MAIN
    }
}

fn wnear(network: &str) -> &'static str {
    if network == "testnet" {
        WNEAR_TEST
    } else {
        WNEAR_MAIN
    }
}

fn api_base(network: &str) -> &'static str {
    if network == "testnet" {
        "https://api-testnet.nearblocks.io/v3"
    } else {
        "https://api.nearblocks.io/v3"
    }
}

/// Infer network from account; optional override must match.
pub fn resolve_network(account: &str, requested: Option<&str>) -> Result<&'static str, String> {
    let inferred = if account.ends_with(".testnet") {
        "testnet"
    } else {
        "mainnet"
    };
    match requested.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(inferred),
        Some(r) if r == inferred || (r == "testnet-replay" && inferred == "testnet") => Ok(inferred),
        Some(r) if (r == "mainnet" || r == "testnet") && r != inferred => {
            Err(format!("network mismatch: account looks like {inferred}, request said {r}"))
        }
        Some(r) if r == "mainnet" || r == "testnet" => Ok(if r == "testnet" { "testnet" } else { "mainnet" }),
        Some(r) => Err(format!("unknown network {r}")),
    }
}

#[derive(Debug)]
pub enum LiveError {
    Http(String),
    Network(String),
    Budget,
    Other(String),
}

impl From<HttpError> for LiveError {
    fn from(e: HttpError) -> Self {
        LiveError::Http(e.0)
    }
}

struct Client<'a> {
    base: &'a str,
    api_key: Option<&'a str>,
    calls: u32,
    max_calls: u32,
}

impl<'a> Client<'a> {
    fn get(&mut self, path_and_query: &str) -> Result<Value, LiveError> {
        if self.calls >= self.max_calls {
            return Err(LiveError::Budget);
        }
        self.calls += 1;
        let url = format!("{}{}", self.base, path_and_query);
        // Simple retry once on 429.
        match get_json(&url, self.api_key) {
            Ok(v) => Ok(v),
            Err(e) if e.0.contains("429") => {
                // No sleep API in WASI reliably; one immediate retry after a burn loop is useless.
                // Fail closed — caller treats as history_unavailable / incomplete.
                Err(LiveError::Http(e.0))
            }
            Err(e) => Err(e.into()),
        }
    }
}

fn receipt_ts(r: &Value) -> u64 {
    r.get("included_in_block_timestamp")
        .or_else(|| r.pointer("/block/block_timestamp"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

fn parse_ref_swaps(root: &Value, tx_hash: &str, venue: &str) -> Vec<Edge> {
    let mut out = Vec::new();
    fn walk(r: &Value, tx_hash: &str, venue: &str, out: &mut Vec<Edge>) {
        let receiver = r.get("receiver_account_id").and_then(|v| v.as_str()).unwrap_or("");
        let status_ok = r.pointer("/outcome/status").and_then(|v| v.as_bool()) != Some(false);
        if receiver == venue && status_ok {
            let logs = r
                .pointer("/outcome/logs")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let mut swaps = Vec::new();
            for log in &logs {
                let Some(s) = log.as_str() else { continue };
                // Swapped <ain> <tin> for <aout> <tout>
                let parts: Vec<&str> = s.split_whitespace().collect();
                if parts.len() == 6 && parts[0] == "Swapped" && parts[3] == "for" {
                    swaps.push((parts[1].to_string(), parts[2].to_string(), parts[4].to_string(), parts[5].to_string()));
                }
            }
            if !swaps.is_empty() {
                let arg_text = serde_json::to_string(r.get("actions").unwrap_or(&Value::Null)).unwrap_or_default().replace('\\', "");
                let pools: Vec<u32> = arg_text
                    .match_indices("\"pool_id\":")
                    .filter_map(|(i, _)| {
                        let rest = &arg_text[i + 10..];
                        let num: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                        num.parse().ok()
                    })
                    .collect();
                let t = receipt_ts(r).to_string();
                for (i, (ain, tin, aout, tout)) in swaps.into_iter().enumerate() {
                    let Some(&pool_id) = pools.get(i) else { continue };
                    out.push(Edge::Swap {
                        account: String::new(), // filled by caller
                        venue: venue.to_string(),
                        pool_id,
                        token_in: tin,
                        amount_in: ain,
                        token_out: tout,
                        amount_out: aout,
                        tx_hash: tx_hash.to_string(),
                        timestamp: t.clone(),
                        token_created_at: None,
                    });
                }
            }
        }
        if let Some(children) = r.get("receipts").and_then(|v| v.as_array()) {
            for c in children {
                walk(c, tx_hash, venue, out);
            }
        }
    }
    walk(root, tx_hash, venue, &mut out);
    out
}

/// Fetch a bounded backward history for `account` on the resolved network.
/// Returns `(doc, history_source)` e.g. `nearblocks-v3:mainnet@h=123`.
pub fn fetch_history(account: &str, network_req: Option<&str>) -> Result<(HistoryDoc, String), LiveError> {
    let account = normalize(account);
    let network = resolve_network(&account, network_req).map_err(LiveError::Network)?;
    let api_key = std::env::var("NEARBLOCKS_API_KEY").ok().filter(|s| !s.is_empty());
    let base = api_base(network);
    let venue = ref_venue(network);
    let wnear_token = wnear(network);

    let mut client = Client {
        base,
        api_key: api_key.as_deref(),
        calls: 0,
        max_calls: MAX_API_CALLS,
    };

    // Pin latest block height for history_source label. Fail closed if we cannot.
    let latest = client.get("/blocks/latest")?;
    // NearBlocks v3 `/blocks/latest` returns `{ "data": [ { "block_height": "…" } ] }`.
    let height = latest
        .pointer("/data/0/block_height")
        .or_else(|| latest.pointer("/blocks/0/block_height"))
        .or_else(|| latest.pointer("/data/blocks/0/block_height"))
        .or_else(|| latest.pointer("/data/block_height"))
        .or_else(|| latest.pointer("/block_height"))
        .or_else(|| latest.get("block_height"))
        .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
        .unwrap_or(0);
    if height == 0 {
        return Err(LiveError::Other(format!(
            "could not pin latest block height from NearBlocks (body keys: {:?})",
            latest.as_object().map(|o| o.keys().take(8).cloned().collect::<Vec<_>>())
        )));
    }
    let history_source = format!("nearblocks-v3:{network}@h={height}");

    // Seeds = near accounts from compiled hacker + sanctions lists (implicit/named).
    let seeds: HashSet<String> = crate::shell::listed_near_accounts();

    let mut edges: BTreeMap<String, Edge> = BTreeMap::new();
    let mut expanded: BTreeSet<String> = BTreeSet::new();
    let mut incomplete: Vec<Incomplete> = Vec::new();
    let mut token_created: HashMap<String, Option<String>> = HashMap::new();

    let add_edge = |edges: &mut BTreeMap<String, Edge>, e: Edge| {
        let k = match &e {
            Edge::Transfer { tx_hash, from, to, amount, .. } => format!("t:{tx_hash}:{from}:{to}:{amount}"),
            Edge::Swap { tx_hash, pool_id, token_in, amount_in, .. } => format!("s:{tx_hash}:{pool_id}:{token_in}:{amount_in}"),
        };
        edges.insert(k, e);
    };

    let swaps_of = |client: &mut Client, tx: &str| -> Result<Vec<Edge>, LiveError> {
        let r = client.get(&format!("/txns/{tx}/receipts"))?;
        let data = r.get("data").cloned().unwrap_or(Value::Null);
        let signer = data
            .get("predecessor_account_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let mut swaps = parse_ref_swaps(&data, tx, venue);
        for s in &mut swaps {
            if let Edge::Swap { account, .. } = s {
                *account = signer.clone();
            }
        }
        Ok(swaps)
    };

    let created_at = |client: &mut Client, token: &str, cache: &mut HashMap<String, Option<String>>| -> Result<Option<String>, LiveError> {
        if let Some(v) = cache.get(token) {
            return Ok(v.clone());
        }
        let r = client.get(&format!("/accounts/{token}"))?;
        let ts = r
            .pointer("/data/created/block_timestamp")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        cache.insert(token.to_string(), ts.clone());
        Ok(ts)
    };

    struct Item {
        account: String,
        depth: u8,
        before: Option<u64>,
    }
    let mut queue: VecDeque<Item> = VecDeque::new();
    queue.push_back(Item {
        account: account.clone(),
        depth: 0,
        before: None,
    });
    let mut seen: HashMap<String, Option<u64>> = HashMap::new();

    let fetch_result = (|| -> Result<(), LiveError> {
        while let Some(Item { account: acc, depth, before }) = queue.pop_front() {
            let prev = seen.get(&acc).cloned();
            if let Some(p) = prev {
                if p.is_none() || before.is_some_and(|b| p.is_some_and(|pb| b <= pb)) {
                    continue;
                }
            }
            seen.insert(acc.clone(), before);

            if seeds.contains(&acc) {
                expanded.insert(acc);
                break;
            }
            if is_terminal(&acc, network) || depth >= MAX_HOPS {
                if is_terminal(&acc, network) {
                    expanded.insert(acc); // listed as terminal = fully handled
                }
                continue;
            }

            let mut cursor: Option<String> = None;
            let mut pages = 0u32;
            let mut complete = true;

            loop {
                let mut path = format!("/accounts/{acc}/receipts?limit={RECEIPT_PAGE}");
                if let Some(b) = before {
                    path.push_str(&format!("&before_ts={b}"));
                }
                if let Some(c) = &cursor {
                    path.push_str(&format!("&next={c}"));
                }
                let page = client.get(&path)?;
                pages += 1;
                let rows = page.get("data").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                for r in rows {
                    let deposit: u128 = r
                        .pointer("/actions_agg/deposit")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(0);
                    let is_transfer = r
                        .get("actions")
                        .and_then(|v| v.as_array())
                        .map(|a| a.iter().any(|x| x.get("action").and_then(|v| v.as_str()) == Some("TRANSFER")))
                        .unwrap_or(false);
                    let status_ok = r.pointer("/outcome/status").and_then(|v| v.as_bool()) != Some(false);
                    if !is_transfer || deposit < DUST_YOCTO || !status_ok {
                        continue;
                    }
                    let t = receipt_ts(&r);
                    if before.is_some_and(|b| t >= b) {
                        continue;
                    }
                    let from = r.get("predecessor_account_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let to = r.get("receiver_account_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let tx_hash = r.get("transaction_hash").and_then(|v| v.as_str()).unwrap_or("").to_string();

                    if from == acc && depth == 0 && to != acc {
                        add_edge(
                            &mut edges,
                            Edge::Transfer {
                                from: from.clone(),
                                to: to.clone(),
                                amount: deposit.to_string(),
                                token: "NEAR".into(),
                                tx_hash,
                                timestamp: t.to_string(),
                            },
                        );
                        continue;
                    }
                    if to != acc || from == acc || from == "system" {
                        continue;
                    }

                    if is_dex_payer(&from) {
                        let swaps = swaps_of(&mut client, &tx_hash)?
                            .into_iter()
                            .filter(|s| matches!(s, Edge::Swap { account, token_out, .. } if account == &acc && token_out == wnear_token))
                            .collect::<Vec<_>>();
                        if swaps.is_empty() {
                            incomplete.push(Incomplete {
                                account: acc.clone(),
                                reason: format!("unparsed DEX payout from {from} in {tx_hash}"),
                            });
                            complete = false;
                            continue;
                        }
                        for mut s in swaps {
                            let (token_in, pool_id, ts) = match &s {
                                Edge::Swap { token_in, pool_id, timestamp, .. } => {
                                    (token_in.clone(), *pool_id, timestamp.parse::<u64>().unwrap_or(0))
                                }
                                _ => continue,
                            };
                            let created = created_at(&mut client, &token_in, &mut token_created).unwrap_or(None);
                            if let Edge::Swap { token_created_at, .. } = &mut s {
                                *token_created_at = created.clone();
                            }
                            let fresh = created
                                .as_ref()
                                .and_then(|c| c.parse::<u64>().ok())
                                .map(|c| ts.saturating_sub(c) < FRESH_TOKEN_NS)
                                .unwrap_or(false);
                            add_edge(&mut edges, s);
                            if !fresh {
                                continue;
                            }
                            // Pool window: opposite-direction swaps shortly before this sell.
                            let end = ts;
                            let start = end.saturating_sub(POOL_WINDOW_NS);
                            let q = format!("/fts/{token_in}/txns?limit=50&before_ts={end}");
                            let Ok(page) = client.get(&q) else { continue };
                            let rows = page.get("data").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                            if rows.len() == 50 {
                                if let Some(last_ts) = rows
                                    .last()
                                    .and_then(|e| e.get("block_timestamp"))
                                    .and_then(|v| v.as_str())
                                    .and_then(|s| s.parse::<u64>().ok())
                                {
                                    if last_ts > start {
                                        incomplete.push(Incomplete {
                                            account: acc.clone(),
                                            reason: format!("pool {pool_id} window has more than 50 events"),
                                        });
                                    }
                                }
                            }
                            let mut txs: BTreeSet<String> = BTreeSet::new();
                            for e in &rows {
                                let involved = e.get("involved_account_id").and_then(|v| v.as_str()).unwrap_or("");
                                let affected = e.get("affected_account_id").and_then(|v| v.as_str()).unwrap_or("");
                                let bts: u64 = e
                                    .get("block_timestamp")
                                    .and_then(|v| v.as_str())
                                    .and_then(|s| s.parse().ok())
                                    .unwrap_or(0);
                                let th = e.get("transaction_hash").and_then(|v| v.as_str()).unwrap_or("");
                                if involved == venue && affected != venue && bts >= start && th != tx_hash.as_str() {
                                    txs.insert(th.to_string());
                                }
                            }
                            for th in txs {
                                for cp in swaps_of(&mut client, &th)? {
                                    let Edge::Swap {
                                        account: cpa,
                                        pool_id: cpid,
                                        token_in: cti,
                                        token_out: cto,
                                        timestamp: cts,
                                        ..
                                    } = &cp
                                    else {
                                        continue;
                                    };
                                    let cts_n: u64 = cts.parse().unwrap_or(0);
                                    if *cpid == pool_id && cti == wnear_token && cto == token_in.as_str() && cts_n <= end {
                                        let mut cp2 = cp.clone();
                                        if let Edge::Swap { token_created_at: tca, .. } = &mut cp2 {
                                            *tca = created.clone();
                                        }
                                        add_edge(&mut edges, cp2);
                                        queue.push_back(Item {
                                            account: cpa.clone(),
                                            depth: depth + 1,
                                            before: Some(cts_n),
                                        });
                                    }
                                }
                            }
                        }
                        continue;
                    }

                    if is_terminal(&from, network) {
                        // Terminal inflow: still record the edge for list checks, do not expand.
                        add_edge(
                            &mut edges,
                            Edge::Transfer {
                                from: from.clone(),
                                to: to.clone(),
                                amount: deposit.to_string(),
                                token: "NEAR".into(),
                                tx_hash,
                                timestamp: t.to_string(),
                            },
                        );
                        continue;
                    }

                    add_edge(
                        &mut edges,
                        Edge::Transfer {
                            from: from.clone(),
                            to: to.clone(),
                            amount: deposit.to_string(),
                            token: "NEAR".into(),
                            tx_hash,
                            timestamp: t.to_string(),
                        },
                    );
                    queue.push_back(Item {
                        account: from,
                        depth: depth + 1,
                        before: Some(t),
                    });
                }

                cursor = page
                    .pointer("/meta/next_page")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                if cursor.is_none() {
                    break;
                }
                if pages >= MAX_RECEIPT_PAGES {
                    incomplete.push(Incomplete {
                        account: acc.clone(),
                        reason: format!("more than {} receipts", MAX_RECEIPT_PAGES * RECEIPT_PAGE),
                    });
                    complete = false;
                    break;
                }
            }
            if complete {
                expanded.insert(acc);
            }
        }
        Ok(())
    })();

    if let Err(LiveError::Budget) = &fetch_result {
        incomplete.push(Incomplete {
            account: account.clone(),
            reason: format!("API budget of {MAX_API_CALLS} calls used"),
        });
    } else if let Err(e) = fetch_result {
        return Err(e);
    }

    for q in &queue {
        if !expanded.contains(&q.account) && !is_terminal(&q.account, network) && q.depth < MAX_HOPS && !seeds.contains(&q.account) {
            incomplete.push(Incomplete {
                account: q.account.clone(),
                reason: "not fetched (search stopped)".into(),
            });
        }
    }

    let mut edge_list: Vec<Edge> = edges.into_values().collect();
    edge_list.sort_by(|a, b| {
        let ta = match a {
            Edge::Transfer { timestamp, .. } | Edge::Swap { timestamp, .. } => timestamp,
        };
        let tb = match b {
            Edge::Transfer { timestamp, .. } | Edge::Swap { timestamp, .. } => timestamp,
        };
        ta.cmp(tb)
    });

    Ok((
        HistoryDoc {
            version: 1,
            subject: account,
            network: network.to_string(),
            source: history_source.clone(),
            fetched_at: format!("block:{height}"),
            max_hops: MAX_HOPS,
            expanded: expanded.into_iter().collect(),
            incomplete,
            edges: edge_list,
            replay_of: None,
            note: Some("Fetched inside checker enclave from NearBlocks v3.".into()),
        },
        history_source,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn network_from_account() {
        assert_eq!(resolve_network("alice.testnet", None).unwrap(), "testnet");
        assert_eq!(resolve_network("alice.near", None).unwrap(), "mainnet");
        assert!(resolve_network("alice.testnet", Some("mainnet")).is_err());
        assert_eq!(resolve_network("alice.near", Some("mainnet")).unwrap(), "mainnet");
    }

    #[test]
    fn terminals_include_faucets_and_ref() {
        assert!(is_terminal("faucet.testnet", "testnet"));
        assert!(is_terminal("v2.ref-finance.near", "mainnet"));
        assert!(is_terminal("wrap.near", "mainnet"));
        assert!(!is_terminal("farstreet4572.near", "mainnet"));
    }
}
