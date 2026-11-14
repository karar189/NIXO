use super::*;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::testing_env;

const H1: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const H2: &str = "2222222222222222222222222222222222222222222222222222222222222222";

fn ctx(pred: AccountId, ts: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id("nixo.testnet".parse().unwrap())
        .predecessor_account_id(pred)
        .block_timestamp(ts)
        .build());
}

fn setup() -> Nixo {
    ctx(accounts(0), 1_000);
    Nixo::new(
        accounts(0),
        "outlayer.testnet".parse().unwrap(),
        Checker { hash: H1.into(), url: "https://example.com/c.wasm".into() },
        Some(U64(100)),
        Some(U64(1_000)),
    )
}

fn out(account: &str, verdict: &str, reason: Option<&str>) -> Value {
    json!({
        "account": account, "verdict": verdict, "reason": reason,
        "checker_version": "0.1.0", "list_snapshot": "data-2026-10-29", "list_hash": "ab",
        "trace_depth": 1, "history_source": "fixture", "input_hash": "cd"
    })
}

fn alice() -> AccountId { "alice.testnet".parse().unwrap() }

#[test]
fn clean_result_is_stored_and_expires() {
    let mut c = setup();
    let cert = c.resolve_nixo(alice(), H1.into(), Ok(Some(out("alice.testnet", "clean", None))));
    assert!(cert.is_some());
    assert!(c.is_clean(alice()));
    ctx(accounts(0), 1_000 + 1_000);
    assert!(!c.is_clean(alice()), "expired");
}

#[test]
fn rejected_is_not_clean() {
    let mut c = setup();
    c.resolve_nixo(alice(), H1.into(), Ok(Some(out("alice.testnet", "rejected", Some("list_hit")))));
    assert!(!c.is_clean(alice()));
    assert_eq!(c.certs.get(&alice()).unwrap().reason.as_deref(), Some("list_hit"));
}

#[test]
fn fails_closed_on_bad_results() {
    let mut c = setup();
    for r in [
        Ok(None),
        Err(PromiseError::Failed),
        Ok(Some(json!("garbage"))),
        Ok(Some(out("mallory.testnet", "clean", None))),     // account mismatch
        Ok(Some(out("alice.testnet", "CLEAN", None))),       // unknown verdict
        Ok(Some(out("alice.testnet", "clean", Some("x")))),  // inconsistent
    ] {
        assert!(c.resolve_nixo(alice(), H1.into(), r).is_none());
        assert!(!c.is_clean(alice()));
    }
}

#[test]
fn string_wrapped_json_is_accepted() {
    let mut c = setup();
    let s = out("alice.testnet", "clean", None).to_string();
    assert!(c.resolve_nixo(alice(), H1.into(), Ok(Some(Value::String(s)))).is_some());
}

#[test]
fn revocation_kills_certificates() {
    let mut c = setup();
    c.resolve_nixo(alice(), H1.into(), Ok(Some(out("alice.testnet", "clean", None))));
    c.revoke_checker_hash(H1.into());
    assert!(!c.is_clean(alice()));
    assert!(c.resolve_nixo(alice(), H1.into(), Ok(Some(out("alice.testnet", "clean", None)))).is_none());
}

#[test]
#[should_panic(expected = "timelock not elapsed")]
fn apply_before_timelock_fails() {
    let mut c = setup();
    c.set_checker_hash(Checker { hash: H2.into(), url: "https://example.com/c2.wasm".into() });
    ctx(accounts(1), 1_099);
    c.apply_checker_hash();
}

#[test]
fn apply_after_timelock_by_anyone() {
    let mut c = setup();
    c.set_checker_hash(Checker { hash: H2.into(), url: "https://example.com/c2.wasm".into() });
    assert_eq!(c.get_checker_hash(), H1);
    ctx(accounts(1), 1_100);
    c.apply_checker_hash();
    assert_eq!(c.get_checker_hash(), H2);
}

#[test]
#[should_panic(expected = "owner only")]
fn only_owner_sets_hash() {
    let mut c = setup();
    ctx(accounts(1), 1_000);
    c.set_checker_hash(Checker { hash: H2.into(), url: "https://example.com/x.wasm".into() });
}

#[test]
fn taint_path_with_hops_is_stored_and_not_clean() {
    let mut c = setup();
    let mut o = out("alice.testnet", "rejected", Some("taint_path"));
    o["hops"] = json!(4); // extra field from the multi-hop checker
    o["trace_depth"] = json!(6);
    assert!(c.resolve_nixo(alice(), H1.into(), Ok(Some(o))).is_some());
    assert!(!c.is_clean(alice()));
    let cert = c.certs.get(&alice()).unwrap();
    assert_eq!((cert.reason.as_deref(), cert.trace_depth), (Some("taint_path"), 6));
}

#[test]
fn warn_is_stored_but_not_clean() {
    let mut c = setup();
    assert!(c.resolve_nixo(alice(), H1.into(), Ok(Some(out("alice.testnet", "warn", Some("taint_path"))))).is_some());
    assert!(!c.is_clean(alice()));
    assert_eq!(c.certs.get(&alice()).unwrap().verdict, "warn");
}

#[test]
fn caller_supplied_history_is_never_certified() {
    let mut c = setup();
    let mut o = out("alice.testnet", "clean", None);
    o["history_source"] = json!("caller_supplied");
    assert!(c.resolve_nixo(alice(), H1.into(), Ok(Some(o))).is_none());
    assert!(!c.is_clean(alice()));
    assert!(c.certs.get(&alice()).is_none());
}

#[test]
fn live_nearblocks_history_is_certifiable() {
    let mut c = setup();
    let mut o = out("alice.testnet", "clean", None);
    o["history_source"] = json!("nearblocks-v3:testnet@h=12345");
    assert!(c.resolve_nixo(alice(), H1.into(), Ok(Some(o))).is_some());
    assert!(c.is_clean(alice()));
}

#[test]
fn unavailable_nearblocks_is_not_certifiable() {
    let mut c = setup();
    let mut o = out("alice.testnet", "rejected", Some("history_unavailable"));
    o["history_source"] = json!("nearblocks-v3:unavailable");
    assert!(c.resolve_nixo(alice(), H1.into(), Ok(Some(o))).is_none());
    assert!(c.certs.get(&alice()).is_none());
}

#[test]
fn non_clean_without_reason_is_refused() {
    let mut c = setup();
    assert!(c.resolve_nixo(alice(), H1.into(), Ok(Some(out("alice.testnet", "rejected", None)))).is_none());
}
