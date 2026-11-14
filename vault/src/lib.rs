//! NIXO deposit vault (Layer 2).
//!
//! Separate from `nixo.testnet` (passport). Deposits call `is_clean` cross-contract;
//! agents may only `execute` under frozen assignment limits. Native NEAR only.
#![allow(clippy::too_many_arguments)]

use near_sdk::json_types::U64;
use near_sdk::serde_json::{json, Value};
use near_sdk::store::IterableMap;
use near_sdk::{
    env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};

const IS_CLEAN_GAS: Gas = Gas::from_tgas(10);
const CALLBACK_GAS: Gas = Gas::from_tgas(30);
const EXECUTE_CALLBACK_GAS: Gas = Gas::from_tgas(20);

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Deposit {
    pub deposit_id: U64,
    pub owner: AccountId,
    pub amount: NearToken,
    pub remaining: NearToken,
    pub clean_at_deposit: bool,
    pub checked_at_ns: U64,
    pub status: String, // active | closed
    pub assignment_id: Option<U64>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Assignment {
    pub assignment_id: U64,
    pub deposit_id: U64,
    pub agent_id: AccountId,
    pub max_per_tx: NearToken,
    pub max_per_window: NearToken,
    pub window_ns: u64,
    pub window_started_at_ns: U64,
    pub window_spent: NearToken,
    pub expires_at_ns: U64,
    pub allowlist: Vec<AccountId>,
    pub status: String, // active | revoked
    pub revoked_at_ns: Option<U64>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct TradeHash {
    pub deposit_id: U64,
    pub assignment_id: U64,
    pub hash: String,
    pub committed_at_ns: U64,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub nixo_contract: AccountId,
    pub next_deposit_id: U64,
    pub next_assignment_id: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    /// Contract admin (can update nixo_contract pointer). Deposit owners manage their own funds.
    owner: AccountId,
    nixo_contract: AccountId,
    next_deposit_id: u64,
    next_assignment_id: u64,
    deposits: IterableMap<u64, Deposit>,
    assignments: IterableMap<u64, Assignment>,
    /// Optional on-chain commitments of encrypted trade-log hashes (hex sha256).
    trade_hashes: IterableMap<String, TradeHash>,
}

fn emit(event: &str, data: Value) {
    let ev = json!({ "standard": "nixo-vault", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{ev}"));
}

#[ext_contract(ext_nixo)]
pub trait ExtNixo {
    fn is_clean(&self, account: AccountId) -> bool;
}

#[near]
impl Vault {
    #[init]
    pub fn new(owner: AccountId, nixo_contract: AccountId) -> Self {
        Self {
            owner,
            nixo_contract,
            next_deposit_id: 1,
            next_assignment_id: 1,
            deposits: IterableMap::new(b"d"),
            assignments: IterableMap::new(b"a"),
            trade_hashes: IterableMap::new(b"t"),
        }
    }

    // ---------- admin ----------

    pub fn set_nixo_contract(&mut self, nixo_contract: AccountId) {
        self.assert_admin();
        self.nixo_contract = nixo_contract;
    }

    // ---------- deposit gate ----------

    /// Attach NEAR. Cross-calls `nixo.is_clean(predecessor)`. Clean → provenance row; else full refund.
    #[payable]
    pub fn deposit(&mut self) -> Promise {
        let amount = env::attached_deposit();
        require!(amount > NearToken::from_yoctonear(0), "attach NEAR to deposit");
        let depositor = env::predecessor_account_id();
        ext_nixo::ext(self.nixo_contract.clone())
            .with_static_gas(IS_CLEAN_GAS)
            .is_clean(depositor.clone())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_is_clean(depositor, amount),
            )
    }

    #[private]
    pub fn on_is_clean(
        &mut self,
        depositor: AccountId,
        amount: NearToken,
        #[callback_result] clean: Result<bool, PromiseError>,
    ) -> PromiseOrValue<Option<Deposit>> {
        let ok = matches!(clean, Ok(true));
        if !ok {
            emit(
                "deposit_refunded",
                json!({
                    "depositor": depositor,
                    "amount": amount,
                    "reason": match &clean {
                        Ok(false) => "not_clean",
                        Err(_) => "is_clean_failed",
                        Ok(true) => unreachable!(),
                    }
                }),
            );
            return PromiseOrValue::Promise(Promise::new(depositor).transfer(amount));
        }

        let deposit_id = self.next_deposit_id;
        self.next_deposit_id += 1;
        let now = env::block_timestamp();
        let dep = Deposit {
            deposit_id: U64(deposit_id),
            owner: depositor.clone(),
            amount,
            remaining: amount,
            clean_at_deposit: true,
            checked_at_ns: U64(now),
            status: "active".into(),
            assignment_id: None,
        };
        self.deposits.insert(deposit_id, dep.clone());
        emit(
            "deposit_accepted",
            json!({
                "deposit_id": deposit_id,
                "depositor": depositor,
                "amount": amount,
                "clean_at_deposit": true,
                "checked_at_ns": now
            }),
        );
        PromiseOrValue::Value(Some(dep))
    }

    // ---------- assign / revoke / withdraw ----------

    pub fn assign(
        &mut self,
        deposit_id: U64,
        agent_id: AccountId,
        max_per_tx: NearToken,
        max_per_window: NearToken,
        window_ns: U64,
        expires_at_ns: U64,
        allowlist: Vec<AccountId>,
    ) -> Assignment {
        let dep = self.deposits.get(&deposit_id.0).unwrap_or_else(|| env::panic_str("UNKNOWN_DEPOSIT"));
        require!(env::predecessor_account_id() == dep.owner, "NOT_OWNER");
        require!(dep.status == "active", "DEPOSIT_INACTIVE");
        require!(dep.clean_at_deposit, "DEPOSIT_NOT_ELIGIBLE");
        require!(dep.assignment_id.is_none(), "ALREADY_ASSIGNED");
        require!(dep.remaining > NearToken::from_yoctonear(0), "NOTHING_TO_ASSIGN");
        require!(max_per_tx > NearToken::from_yoctonear(0), "INVALID_MAX_PER_TX");
        require!(max_per_window > NearToken::from_yoctonear(0), "INVALID_MAX_PER_WINDOW");
        require!(!allowlist.is_empty(), "EMPTY_ALLOWLIST");
        require!(expires_at_ns.0 > env::block_timestamp(), "ALREADY_EXPIRED");

        let assignment_id = self.next_assignment_id;
        self.next_assignment_id += 1;
        let now = env::block_timestamp();
        let a = Assignment {
            assignment_id: U64(assignment_id),
            deposit_id,
            agent_id: agent_id.clone(),
            max_per_tx,
            max_per_window,
            window_ns: window_ns.0,
            window_started_at_ns: U64(now),
            window_spent: NearToken::from_yoctonear(0),
            expires_at_ns,
            allowlist: allowlist.clone(),
            status: "active".into(),
            revoked_at_ns: None,
        };
        self.assignments.insert(assignment_id, a.clone());
        let mut dep = dep.clone();
        dep.assignment_id = Some(U64(assignment_id));
        self.deposits.insert(deposit_id.0, dep);

        emit(
            "assigned",
            json!({
                "assignment_id": assignment_id,
                "deposit_id": deposit_id.0,
                "agent_id": agent_id,
                "max_per_tx": max_per_tx,
                "max_per_window": max_per_window,
                "expires_at_ns": expires_at_ns,
                "allowlist": allowlist
            }),
        );
        a
    }

    pub fn revoke(&mut self, assignment_id: U64) -> Assignment {
        let a = self
            .assignments
            .get(&assignment_id.0)
            .unwrap_or_else(|| env::panic_str("UNKNOWN_ASSIGNMENT"));
        let dep = self
            .deposits
            .get(&a.deposit_id.0)
            .unwrap_or_else(|| env::panic_str("UNKNOWN_DEPOSIT"));
        require!(env::predecessor_account_id() == dep.owner, "NOT_OWNER");

        let mut a = a.clone();
        if a.status != "revoked" {
            a.status = "revoked".into();
            a.revoked_at_ns = Some(U64(env::block_timestamp()));
            self.assignments.insert(assignment_id.0, a.clone());
            // Clear assignment pointer so owner can withdraw / re-assign remaining.
            let mut dep = dep.clone();
            dep.assignment_id = None;
            self.deposits.insert(a.deposit_id.0, dep);
            emit(
                "revoked",
                json!({
                    "assignment_id": assignment_id.0,
                    "deposit_id": a.deposit_id.0,
                    "agent_id": a.agent_id
                }),
            );
        }
        a
    }

    /// Owner withdraws unassigned remaining NEAR from a deposit.
    pub fn withdraw(&mut self, deposit_id: U64, amount: NearToken) -> Promise {
        let dep = self.deposits.get(&deposit_id.0).unwrap_or_else(|| env::panic_str("UNKNOWN_DEPOSIT"));
        require!(env::predecessor_account_id() == dep.owner, "NOT_OWNER");
        require!(dep.status == "active", "DEPOSIT_INACTIVE");
        require!(dep.assignment_id.is_none(), "STILL_ASSIGNED");
        require!(amount > NearToken::from_yoctonear(0), "INVALID_AMOUNT");
        require!(amount <= dep.remaining, "INSUFFICIENT_REMAINING");

        let mut dep = dep.clone();
        dep.remaining = NearToken::from_yoctonear(
            dep.remaining.as_yoctonear().saturating_sub(amount.as_yoctonear()),
        );
        if dep.remaining == NearToken::from_yoctonear(0) {
            dep.status = "closed".into();
        }
        let owner = dep.owner.clone();
        self.deposits.insert(deposit_id.0, dep);
        emit(
            "withdrawn",
            json!({ "deposit_id": deposit_id.0, "owner": owner, "amount": amount }),
        );
        Promise::new(owner).transfer(amount)
    }

    // ---------- execute ----------

    /// Agent-only. Checks PRD order, debits, then transfers to allowlisted `target` (or dry-run settle).
    ///
    /// `dry_run = true`: all checks + debit remaining; NEAR stays in the vault (demo / Intents dry path).
    /// `dry_run = false`: transfer `amount` to `target`, rollback debit if the promise fails.
    #[payable]
    pub fn execute(
        &mut self,
        assignment_id: U64,
        amount: NearToken,
        target: AccountId,
        dry_run: bool,
    ) -> PromiseOrValue<bool> {
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(0),
            "do not attach deposit to execute"
        );
        let caller = env::predecessor_account_id();

        if let Err((code, msg)) = self.check_execute(&caller, assignment_id.0, amount, &target) {
            emit(
                "execution_blocked",
                json!({
                    "assignment_id": assignment_id.0,
                    "agent_id": caller,
                    "amount": amount,
                    "target": target,
                    "reason_code": code,
                    "message": msg
                }),
            );
            env::panic_str(&format!("{code}: {msg}"));
        }

        // Debit before outbound (rollback on failure).
        self.apply_spend(assignment_id.0, amount);

        emit(
            "execution_allowed",
            json!({
                "assignment_id": assignment_id.0,
                "agent_id": caller,
                "amount": amount,
                "target": target,
                "dry_run": dry_run
            }),
        );

        if dry_run {
            return PromiseOrValue::Value(true);
        }

        PromiseOrValue::Promise(
            Promise::new(target.clone())
                .transfer(amount)
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(EXECUTE_CALLBACK_GAS)
                        .on_execute_result(assignment_id, amount, target),
                ),
        )
    }

    #[private]
    pub fn on_execute_result(
        &mut self,
        assignment_id: U64,
        amount: NearToken,
        target: AccountId,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            return true;
        }
        // Rollback spend.
        self.rollback_spend(assignment_id.0, amount);
        emit(
            "execution_rolled_back",
            json!({
                "assignment_id": assignment_id.0,
                "amount": amount,
                "target": target,
                "reason": "outbound_failed"
            }),
        );
        false
    }

    /// Commit a hex hash of an encrypted trade-log entry (viewing-key scope lives off-chain).
    pub fn commit_trade_hash(&mut self, deposit_id: U64, assignment_id: U64, hash: String) {
        require!(hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()), "hash must be 64 hex");
        let a = self
            .assignments
            .get(&assignment_id.0)
            .unwrap_or_else(|| env::panic_str("UNKNOWN_ASSIGNMENT"));
        require!(a.deposit_id == deposit_id, "ASSIGNMENT_DEPOSIT_MISMATCH");
        let dep = self
            .deposits
            .get(&deposit_id.0)
            .unwrap_or_else(|| env::panic_str("UNKNOWN_DEPOSIT"));
        let pred = env::predecessor_account_id();
        require!(pred == dep.owner || pred == a.agent_id, "NOT_AUTHORIZED");
        let key = format!("{}:{}", assignment_id.0, hash.to_lowercase());
        let rec = TradeHash {
            deposit_id,
            assignment_id,
            hash: hash.to_lowercase(),
            committed_at_ns: U64(env::block_timestamp()),
        };
        self.trade_hashes.insert(key, rec.clone());
        emit("trade_hash_committed", json!({ "deposit_id": deposit_id.0, "assignment_id": assignment_id.0, "hash": rec.hash }));
    }

    // ---------- views ----------

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            nixo_contract: self.nixo_contract.clone(),
            next_deposit_id: U64(self.next_deposit_id),
            next_assignment_id: U64(self.next_assignment_id),
        }
    }

    pub fn get_deposit(&self, deposit_id: U64) -> Option<Deposit> {
        self.deposits.get(&deposit_id.0).cloned()
    }

    pub fn get_assignment(&self, assignment_id: U64) -> Option<Assignment> {
        self.assignments.get(&assignment_id.0).cloned()
    }

    pub fn list_deposits_by_owner(&self, owner: AccountId) -> Vec<Deposit> {
        self.deposits
            .values()
            .filter(|d| d.owner == owner)
            .cloned()
            .collect()
    }

    pub fn get_trade_hash(&self, assignment_id: U64, hash: String) -> Option<TradeHash> {
        let key = format!("{}:{}", assignment_id.0, hash.to_lowercase());
        self.trade_hashes.get(&key).cloned()
    }

    // ---------- internals ----------

    fn assert_admin(&self) {
        require!(env::predecessor_account_id() == self.owner, "admin only");
    }

    fn check_execute(
        &self,
        caller: &AccountId,
        assignment_id: u64,
        amount: NearToken,
        target: &AccountId,
    ) -> Result<(), (&'static str, String)> {
        let a = self
            .assignments
            .get(&assignment_id)
            .ok_or(("UNKNOWN_ASSIGNMENT", format!("assignment {assignment_id} does not exist")))?;

        if a.status == "revoked" {
            return Err(("ASSIGNMENT_REVOKED", "assignment was revoked by its owner".into()));
        }
        if a.status != "active" {
            return Err(("ASSIGNMENT_INACTIVE", "assignment is not active".into()));
        }
        if env::block_timestamp() >= a.expires_at_ns.0 {
            return Err(("ASSIGNMENT_EXPIRED", "assignment permission has expired".into()));
        }
        if caller != &a.agent_id {
            return Err(("AGENT_MISMATCH", format!("{caller} is not the agent on this assignment")));
        }

        let dep = self
            .deposits
            .get(&a.deposit_id.0)
            .ok_or(("UNKNOWN_DEPOSIT", "deposit missing".into()))?;
        if dep.assignment_id != Some(U64(assignment_id)) {
            return Err(("ASSIGNMENT_INACTIVE", "deposit is not assigned to this permission".into()));
        }
        if !dep.clean_at_deposit {
            return Err(("DEPOSIT_NOT_ELIGIBLE", "clean_at_deposit is false".into()));
        }
        if amount == NearToken::from_yoctonear(0) {
            return Err(("INVALID_AMOUNT", "amount must be > 0".into()));
        }
        if amount > a.max_per_tx {
            return Err((
                "MAX_TRADE_EXCEEDED",
                format!("{amount} exceeds the per-trade limit {}", a.max_per_tx),
            ));
        }

        let window_spent = self.window_spent_now(a);
        let window_next = NearToken::from_yoctonear(
            window_spent.as_yoctonear().saturating_add(amount.as_yoctonear()),
        );
        if window_next > a.max_per_window {
            return Err((
                "TOTAL_SPEND_EXCEEDED",
                format!(
                    "{window_spent} window spent + {amount} exceeds window cap {}",
                    a.max_per_window
                ),
            ));
        }
        if amount > dep.remaining {
            return Err((
                "ALLOCATION_EXCEEDED",
                format!("{amount} exceeds remaining {}", dep.remaining),
            ));
        }
        if !a.allowlist.iter().any(|t| t == target) {
            return Err((
                "TARGET_NOT_ALLOWLISTED",
                format!("{target} is not in the assignment allowlist"),
            ));
        }
        Ok(())
    }

    fn window_spent_now(&self, a: &Assignment) -> NearToken {
        let now = env::block_timestamp();
        if a.window_ns == 0 || now.saturating_sub(a.window_started_at_ns.0) >= a.window_ns {
            NearToken::from_yoctonear(0)
        } else {
            a.window_spent
        }
    }

    fn apply_spend(&mut self, assignment_id: u64, amount: NearToken) {
        let mut a = self.assignments.get(&assignment_id).unwrap().clone();
        let mut dep = self.deposits.get(&a.deposit_id.0).unwrap().clone();
        let now = env::block_timestamp();
        if a.window_ns == 0 || now.saturating_sub(a.window_started_at_ns.0) >= a.window_ns {
            a.window_started_at_ns = U64(now);
            a.window_spent = amount;
        } else {
            a.window_spent = NearToken::from_yoctonear(
                a.window_spent.as_yoctonear().saturating_add(amount.as_yoctonear()),
            );
        }
        dep.remaining = NearToken::from_yoctonear(
            dep.remaining.as_yoctonear().saturating_sub(amount.as_yoctonear()),
        );
        self.assignments.insert(assignment_id, a);
        self.deposits.insert(dep.deposit_id.0, dep);
    }

    fn rollback_spend(&mut self, assignment_id: u64, amount: NearToken) {
        let Some(mut a) = self.assignments.get(&assignment_id).cloned() else {
            return;
        };
        let Some(mut dep) = self.deposits.get(&a.deposit_id.0).cloned() else {
            return;
        };
        dep.remaining = NearToken::from_yoctonear(
            dep.remaining.as_yoctonear().saturating_add(amount.as_yoctonear()),
        );
        a.window_spent = NearToken::from_yoctonear(
            a.window_spent.as_yoctonear().saturating_sub(amount.as_yoctonear()),
        );
        self.assignments.insert(assignment_id, a);
        self.deposits.insert(dep.deposit_id.0, dep);
    }
}

#[cfg(test)]
mod tests;
