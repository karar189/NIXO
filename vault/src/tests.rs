use super::*;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{testing_env, AccountId};

fn yocto(n: u128) -> NearToken {
    NearToken::from_yoctonear(n)
}

fn near(n: u128) -> NearToken {
    NearToken::from_near(n)
}

fn ctx(pred: AccountId, ts: u64, deposit: NearToken) {
    testing_env!(VMContextBuilder::new()
        .current_account_id("nixo-vault.testnet".parse().unwrap())
        .predecessor_account_id(pred.clone())
        .signer_account_id(pred)
        .attached_deposit(deposit)
        .account_balance(near(1000))
        .block_timestamp(ts)
        .build());
}

fn setup() -> Vault {
    ctx(accounts(0), 1_000, yocto(0));
    Vault::new(accounts(0), "nixo.testnet".parse().unwrap())
}

fn alice() -> AccountId {
    "alice.testnet".parse().unwrap()
}
fn mallory() -> AccountId {
    "mallory.testnet".parse().unwrap()
}
fn agent() -> AccountId {
    "agent.testnet".parse().unwrap()
}
fn intents() -> AccountId {
    "intents.near".parse().unwrap()
}

fn vault_id() -> AccountId {
    "nixo-vault.testnet".parse().unwrap()
}

/// `#[private]` callbacks require predecessor == current contract.
fn ctx_private(ts: u64) {
    ctx(vault_id(), ts, yocto(0));
}

fn accept_deposit(v: &mut Vault, owner: AccountId, amount: NearToken, ts: u64) -> Deposit {
    ctx_private(ts);
    match v.on_is_clean(owner, amount, Ok(true)) {
        PromiseOrValue::Value(Some(d)) => d,
        _ => panic!("expected accepted deposit"),
    }
}

#[test]
fn clean_deposit_creates_provenance() {
    let mut v = setup();
    let d = accept_deposit(&mut v, alice(), near(5), 1_000);
    assert_eq!(d.deposit_id.0, 1);
    assert!(d.clean_at_deposit);
    assert_eq!(d.remaining, near(5));
    assert_eq!(d.owner, alice());
    assert!(v.get_deposit(U64(1)).is_some());
}

#[test]
fn dirty_deposit_refunds_no_row() {
    let mut v = setup();
    ctx_private(1_000);
    let _ = v.on_is_clean(alice(), near(5), Ok(false));
    assert!(v.get_deposit(U64(1)).is_none());
    assert_eq!(v.get_config().next_deposit_id.0, 1);
}

#[test]
fn is_clean_failure_refunds() {
    let mut v = setup();
    ctx_private(1_000);
    let _ = v.on_is_clean(alice(), near(3), Err(PromiseError::Failed));
    assert!(v.get_deposit(U64(1)).is_none());
}

#[test]
fn two_deposits_are_separate_rows() {
    let mut v = setup();
    let a = accept_deposit(&mut v, alice(), near(2), 1_000);
    let b = accept_deposit(&mut v, alice(), near(3), 2_000);
    assert_ne!(a.deposit_id, b.deposit_id);
    assert_eq!(a.checked_at_ns.0, 1_000);
    assert_eq!(b.checked_at_ns.0, 2_000);
    assert_eq!(v.list_deposits_by_owner(alice()).len(), 2);
}

#[test]
fn assign_revoke_withdraw_lifecycle() {
    let mut v = setup();
    let d = accept_deposit(&mut v, alice(), near(10), 1_000);

    ctx(alice(), 1_000, yocto(0));
    let a = v.assign(
        d.deposit_id,
        agent(),
        near(2),
        near(5),
        U64(1_000_000),
        U64(10_000),
        vec![intents()],
    );
    assert_eq!(a.status, "active");
    assert_eq!(v.get_deposit(d.deposit_id).unwrap().assignment_id, Some(a.assignment_id));

    ctx(alice(), 2_000, yocto(0));
    let revoked = v.revoke(a.assignment_id);
    assert_eq!(revoked.status, "revoked");
    assert!(v.get_deposit(d.deposit_id).unwrap().assignment_id.is_none());

    ctx(alice(), 3_000, yocto(0));
    let _ = v.withdraw(d.deposit_id, near(10));
    assert_eq!(v.get_deposit(d.deposit_id).unwrap().remaining, yocto(0));
    assert_eq!(v.get_deposit(d.deposit_id).unwrap().status, "closed");
}

#[test]
#[should_panic(expected = "NOT_OWNER")]
fn non_owner_cannot_assign() {
    let mut v = setup();
    let d = accept_deposit(&mut v, alice(), near(5), 1_000);
    ctx(mallory(), 1_000, yocto(0));
    let _ = v.assign(
        d.deposit_id,
        agent(),
        near(1),
        near(2),
        U64(100),
        U64(10_000),
        vec![intents()],
    );
}

#[test]
fn execute_dry_run_debits_within_caps() {
    let mut v = setup();
    let d = accept_deposit(&mut v, alice(), near(10), 1_000);
    ctx(alice(), 1_000, yocto(0));
    let a = v.assign(
        d.deposit_id,
        agent(),
        near(2),
        near(5),
        U64(1_000_000),
        U64(10_000),
        vec![intents()],
    );

    ctx(agent(), 1_100, yocto(0));
    match v.execute(a.assignment_id, near(2), intents(), true) {
        PromiseOrValue::Value(true) => {}
        _ => panic!("expected dry_run success"),
    }
    assert_eq!(v.get_deposit(d.deposit_id).unwrap().remaining, near(8));
    assert_eq!(v.get_assignment(a.assignment_id).unwrap().window_spent, near(2));
}

#[test]
#[should_panic(expected = "MAX_TRADE_EXCEEDED")]
fn execute_rejects_over_per_tx_cap() {
    let mut v = setup();
    let d = accept_deposit(&mut v, alice(), near(10), 1_000);
    ctx(alice(), 1_000, yocto(0));
    let a = v.assign(
        d.deposit_id,
        agent(),
        near(2),
        near(10),
        U64(1_000_000),
        U64(10_000),
        vec![intents()],
    );
    ctx(agent(), 1_100, yocto(0));
    let _ = v.execute(a.assignment_id, near(3), intents(), true);
}

#[test]
#[should_panic(expected = "TARGET_NOT_ALLOWLISTED")]
fn execute_rejects_injection_target() {
    let mut v = setup();
    let d = accept_deposit(&mut v, alice(), near(10), 1_000);
    ctx(alice(), 1_000, yocto(0));
    let a = v.assign(
        d.deposit_id,
        agent(),
        near(2),
        near(10),
        U64(1_000_000),
        U64(10_000),
        vec![intents()],
    );
    ctx(agent(), 1_100, yocto(0));
    let _ = v.execute(a.assignment_id, near(1), mallory(), true);
}

#[test]
#[should_panic(expected = "ASSIGNMENT_REVOKED")]
fn execute_rejects_after_revoke() {
    let mut v = setup();
    let d = accept_deposit(&mut v, alice(), near(10), 1_000);
    ctx(alice(), 1_000, yocto(0));
    let a = v.assign(
        d.deposit_id,
        agent(),
        near(2),
        near(10),
        U64(1_000_000),
        U64(10_000),
        vec![intents()],
    );
    ctx(alice(), 1_050, yocto(0));
    let _ = v.revoke(a.assignment_id);
    ctx(agent(), 1_100, yocto(0));
    let _ = v.execute(a.assignment_id, near(1), intents(), true);
}

#[test]
#[should_panic(expected = "ASSIGNMENT_EXPIRED")]
fn execute_rejects_expired() {
    let mut v = setup();
    let d = accept_deposit(&mut v, alice(), near(10), 1_000);
    ctx(alice(), 1_000, yocto(0));
    let a = v.assign(
        d.deposit_id,
        agent(),
        near(2),
        near(10),
        U64(1_000_000),
        U64(1_500),
        vec![intents()],
    );
    ctx(agent(), 2_000, yocto(0));
    let _ = v.execute(a.assignment_id, near(1), intents(), true);
}

#[test]
#[should_panic(expected = "TOTAL_SPEND_EXCEEDED")]
fn execute_rejects_window_cap() {
    let mut v = setup();
    let d = accept_deposit(&mut v, alice(), near(10), 1_000);
    ctx(alice(), 1_000, yocto(0));
    let a = v.assign(
        d.deposit_id,
        agent(),
        near(3),
        near(4),
        U64(10_000),
        U64(100_000),
        vec![intents()],
    );
    ctx(agent(), 1_100, yocto(0));
    let _ = v.execute(a.assignment_id, near(3), intents(), true);
    ctx(agent(), 1_200, yocto(0));
    let _ = v.execute(a.assignment_id, near(2), intents(), true);
}

#[test]
fn rollback_restores_remaining() {
    let mut v = setup();
    let d = accept_deposit(&mut v, alice(), near(10), 1_000);
    ctx(alice(), 1_000, yocto(0));
    let a = v.assign(
        d.deposit_id,
        agent(),
        near(5),
        near(10),
        U64(1_000_000),
        U64(10_000),
        vec![intents()],
    );
    ctx(agent(), 1_100, yocto(0));
    v.apply_spend(a.assignment_id.0, near(4));
    assert_eq!(v.get_deposit(d.deposit_id).unwrap().remaining, near(6));
    ctx_private(1_200);
    let ok = v.on_execute_result(a.assignment_id, near(4), intents(), Err(PromiseError::Failed));
    assert!(!ok);
    assert_eq!(v.get_deposit(d.deposit_id).unwrap().remaining, near(10));
}

#[test]
fn commit_trade_hash() {
    let mut v = setup();
    let d = accept_deposit(&mut v, alice(), near(1), 1_000);
    ctx(alice(), 1_000, yocto(0));
    let a = v.assign(
        d.deposit_id,
        agent(),
        near(1),
        near(1),
        U64(100),
        U64(10_000),
        vec![intents()],
    );
    let h = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    ctx(agent(), 1_100, yocto(0));
    v.commit_trade_hash(d.deposit_id, a.assignment_id, h.into());
    assert!(v.get_trade_hash(a.assignment_id, h.into()).is_some());
}
