use super::*;
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::testing_env;

const PUB: &str = "q83vEjRWeJCrze8SNFZ4kKvN7xI0VniQq83vEjRWeJA=";
const MILLI: u128 = 1_000_000_000_000_000_000_000; // 0.001 NEAR
const NS: u64 = 1_000_000_000;

fn trader() -> AccountId {
    "alice.testnet".parse().unwrap()
}
fn follower() -> AccountId {
    "bob.testnet".parse().unwrap()
}

fn ctx(pred: AccountId, ts: u64, deposit: u128) {
    testing_env!(VMContextBuilder::new()
        .current_account_id("nixo-keys.testnet".parse().unwrap())
        .predecessor_account_id(pred.clone())
        .signer_account_id(pred)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(100))
        .block_timestamp(ts)
        .build());
}

/// Contract with alice listed at 0.01 NEAR per 1-hour period.
fn listed() -> CopyKeys {
    ctx(trader(), 1_000, 0);
    let mut c = CopyKeys::new("nixo-keys.testnet".parse().unwrap());
    c.list_key(U128(10 * MILLI), 3600);
    c
}

#[test]
fn list_and_view() {
    let c = listed();
    let l = c.get_listing(trader()).unwrap();
    assert!(l.active);
    assert_eq!(l.price_per_period, U128(10 * MILLI));
    assert_eq!(c.list_listings(None, None).len(), 1);
}

#[test]
#[should_panic(expected = "PRICE_TOO_LOW")]
fn rejects_tiny_price() {
    ctx(trader(), 1_000, 0);
    let mut c = CopyKeys::new("nixo-keys.testnet".parse().unwrap());
    c.list_key(U128(1), 3600);
}

#[test]
#[should_panic(expected = "INVALID_PERIOD")]
fn rejects_short_period() {
    ctx(trader(), 1_000, 0);
    let mut c = CopyKeys::new("nixo-keys.testnet".parse().unwrap());
    c.list_key(U128(10 * MILLI), 5);
}

#[test]
fn subscribe_pays_trader_and_records_pubkey() {
    let mut c = listed();
    ctx(follower(), 5 * NS, 20 * MILLI);
    let s = c.subscribe(trader(), 2, PUB.into());
    assert_eq!(s.x25519_pub, PUB);
    assert_eq!(s.starts_at_ns, U64(5 * NS));
    assert_eq!(s.expires_at_ns, U64(5 * NS + 2 * 3600 * NS));
    assert_eq!(s.paid_total, U128(20 * MILLI));

    let receipts = get_created_receipts();
    assert!(receipts.iter().any(|r| r.receiver_id == trader()), "payout receipt to trader");

    let l = c.get_listing(trader()).unwrap();
    assert_eq!(l.subscriber_count, 1);
    assert_eq!(l.earned_total, U128(20 * MILLI));

    ctx(follower(), 6 * NS, 0);
    assert!(c.is_active(trader(), follower()));
    assert_eq!(c.subscribers_of(trader()).len(), 1);
    assert_eq!(c.subscriptions_of(follower()).len(), 1);
}

#[test]
#[should_panic(expected = "WRONG_DEPOSIT")]
fn wrong_deposit_rejected() {
    let mut c = listed();
    ctx(follower(), 5 * NS, 5 * MILLI);
    c.subscribe(trader(), 1, PUB.into());
}

#[test]
#[should_panic(expected = "NOT_LISTED")]
fn unlisted_trader_rejected() {
    let mut c = listed();
    ctx(trader(), 2 * NS, 0);
    c.unlist();
    ctx(follower(), 5 * NS, 10 * MILLI);
    c.subscribe(trader(), 1, PUB.into());
}

#[test]
#[should_panic(expected = "NOT_LISTED")]
fn never_listed_rejected() {
    let mut c = listed();
    ctx(follower(), 5 * NS, 10 * MILLI);
    c.subscribe("carol.testnet".parse().unwrap(), 1, PUB.into());
}

#[test]
#[should_panic(expected = "SELF_SUBSCRIBE")]
fn trader_cannot_subscribe_to_self() {
    let mut c = listed();
    ctx(trader(), 5 * NS, 10 * MILLI);
    c.subscribe(trader(), 1, PUB.into());
}

#[test]
#[should_panic(expected = "INVALID_X25519_PUB")]
fn bad_pubkey_rejected() {
    let mut c = listed();
    ctx(follower(), 5 * NS, 10 * MILLI);
    c.subscribe(trader(), 1, "not-a-key".into());
}

#[test]
fn active_subscription_extends_from_expiry() {
    let mut c = listed();
    ctx(follower(), 5 * NS, 10 * MILLI);
    let first = c.subscribe(trader(), 1, PUB.into());
    ctx(follower(), 10 * NS, 10 * MILLI);
    let s = c.subscribe(trader(), 1, PUB.into());
    assert_eq!(s.starts_at_ns, first.starts_at_ns);
    assert_eq!(s.expires_at_ns, U64(first.expires_at_ns.0 + 3600 * NS));
    assert_eq!(c.get_listing(trader()).unwrap().subscriber_count, 1, "extension is not a new subscriber");
}

#[test]
fn lapsed_subscription_restarts_now() {
    let mut c = listed();
    ctx(follower(), 5 * NS, 10 * MILLI);
    c.subscribe(trader(), 1, PUB.into());
    let later = 5 * NS + 2 * 3600 * NS;
    ctx(follower(), later, 0);
    assert!(!c.is_active(trader(), follower()));
    ctx(follower(), later, 10 * MILLI);
    let s = c.subscribe(trader(), 1, PUB.into());
    assert_eq!(s.starts_at_ns, U64(later));
    assert_eq!(s.paid_total, U128(20 * MILLI));
}

#[test]
fn pubkey_validation() {
    assert!(valid_x25519_pub(PUB));
    assert!(!valid_x25519_pub("q83vEjRWeJCrze8SNFZ4kKvN7xI0VniQq83vEjRWeJA"));
    assert!(!valid_x25519_pub("q83vEjRWeJCrze8SNFZ4kKvN7xI0VniQq83vEjRWe!A="));
}
