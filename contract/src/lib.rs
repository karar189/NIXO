//! NIXO verifier contract.
//!
//! - Pins the checker WASM by SHA-256; changes are timelocked and public.
//! - `request_nixo` asks OutLayer (Intel TDX) to run the pinned checker for the caller.
//! - `resolve_nixo` (callback) stores a short-lived certificate.
//! - `is_clean` is the one call an exchange needs.
mod outlayer;

use near_sdk::json_types::U64;
use near_sdk::serde_json::{json, Value};
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};
use outlayer::{ext_outlayer, CheckerOutput};

const CALLBACK_GAS: Gas = Gas::from_tgas(20);
const NS_PER_HOUR: u64 = 3_600_000_000_000;
pub const DEFAULT_CERT_TTL_NS: u64 = 7 * 24 * NS_PER_HOUR;
pub const DEFAULT_TIMELOCK_NS: u64 = 48 * NS_PER_HOUR;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Checker {
    /// Lowercase hex SHA-256 of the checker WASM.
    pub hash: String,
    /// HTTPS URL OutLayer downloads the WASM from (hash-verified).
    pub url: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct PendingChecker {
    pub checker: Checker,
    pub activates_at_ns: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Certificate {
    pub account: AccountId,
    /// "clean", "warn" or "rejected". Only "clean" makes is_clean true.
    pub verdict: String,
    pub reason: Option<String>,
    pub checker_hash: String,
    pub checker_version: String,
    pub list_snapshot: String,
    pub list_hash: String,
    pub trace_depth: u8,
    pub history_source: String,
    pub input_hash: String,
    pub issued_at_ns: U64,
    pub expires_at_ns: U64,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub outlayer: AccountId,
    pub checker: Checker,
    pub pending: Option<PendingChecker>,
    pub timelock_ns: U64,
    pub cert_ttl_ns: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Nixo {
    owner: AccountId,
    outlayer: AccountId,
    checker: Checker,
    pending: Option<PendingChecker>,
    timelock_ns: u64,
    cert_ttl_ns: u64,
    revoked: LookupSet<String>,
    certs: LookupMap<AccountId, Certificate>,
}

fn emit(event: &str, data: Value) {
    let ev = json!({ "standard": "nixo", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{ev}"));
}

fn valid_hash(h: &str) -> bool {
    h.len() == 64 && h.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[near]
impl Nixo {
    #[init]
    pub fn new(
        owner: AccountId,
        outlayer: AccountId,
        checker: Checker,
        timelock_ns: Option<U64>,
        cert_ttl_ns: Option<U64>,
    ) -> Self {
        require!(valid_hash(&checker.hash), "checker hash must be 64 lowercase hex");
        require!(checker.url.starts_with("https://"), "checker url must be https");
        Self {
            owner,
            outlayer,
            checker,
            pending: None,
            timelock_ns: timelock_ns.map_or(DEFAULT_TIMELOCK_NS, |v| v.0),
            cert_ttl_ns: cert_ttl_ns.map_or(DEFAULT_CERT_TTL_NS, |v| v.0),
            revoked: LookupSet::new(b"r"),
            certs: LookupMap::new(b"c"),
        }
    }

    // ---------- user flow ----------

    /// Request a certificate for the caller. Attach NEAR to pay OutLayer;
    /// unused deposit is refunded to the caller by OutLayer.
    #[payable]
    pub fn request_nixo(&mut self) -> Promise {
        let account = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        require!(deposit > NearToken::from_yoctonear(0), "attach NEAR to pay for the TEE run");
        require!(!self.revoked.contains(&self.checker.hash), "active checker is revoked");
        emit("nixo_requested", json!({ "account": account, "checker_hash": self.checker.hash }));
        ext_outlayer::ext(self.outlayer.clone())
            .with_attached_deposit(deposit)
            .with_unused_gas_weight(1)
            .request_execution(
                outlayer::source(&self.checker.url, &self.checker.hash),
                Some(outlayer::resource_limits()),
                Some(outlayer::input_data(&account)),
                None,
                Some("Json".to_string()),
                Some(account.clone()),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .resolve_nixo(account, self.checker.hash.clone()),
            )
    }

    /// OutLayer callback. Fails closed: anything unexpected stores nothing.
    #[private]
    pub fn resolve_nixo(
        &mut self,
        account: AccountId,
        checker_hash: String,
        #[callback_result] result: Result<Option<Value>, PromiseError>,
    ) -> Option<Certificate> {
        let out = match result {
            Ok(Some(v)) => outlayer::parse(v),
            _ => None,
        };
        match self.accept(&account, &checker_hash, out) {
            Ok(cert) => {
                emit("nixo_resolved", json!({
                    "account": account, "verdict": cert.verdict, "reason": cert.reason,
                    "checker_hash": checker_hash, "expires_at_ns": cert.expires_at_ns,
                }));
                self.certs.insert(account, cert.clone());
                Some(cert)
            }
            Err(why) => {
                emit("nixo_failed", json!({ "account": account, "error": why }));
                None
            }
        }
    }

    fn accept(&self, account: &AccountId, checker_hash: &str, out: Option<CheckerOutput>) -> Result<Certificate, &'static str> {
        let out = out.ok_or("no_result")?;
        if out.account != account.as_str() {
            return Err("account_mismatch");
        }
        if self.revoked.contains(checker_hash) {
            return Err("checker_revoked");
        }
        // Only histories compiled into the pinned checker can be certified. A
        // caller-supplied history (the web "check any wallet" preview) could
        // leave edges out, so it is never written as a certificate.
        if out.history_source != "fixture" {
            return Err("uncertifiable_history_source");
        }
        // "warn": a taint path whose only evidence is a weak pool link. Stored
        // so the user sees why, but is_clean stays false (only "clean" passes).
        if !matches!(out.verdict.as_str(), "clean" | "warn" | "rejected") {
            return Err("bad_verdict");
        }
        if (out.verdict == "clean") != out.reason.is_none() {
            return Err("bad_verdict");
        }
        let now = env::block_timestamp();
        Ok(Certificate {
            account: account.clone(),
            verdict: out.verdict,
            reason: out.reason,
            checker_hash: checker_hash.to_string(),
            checker_version: out.checker_version,
            list_snapshot: out.list_snapshot,
            list_hash: out.list_hash,
            trace_depth: out.trace_depth,
            history_source: out.history_source,
            input_hash: out.input_hash,
            issued_at_ns: U64(now),
            expires_at_ns: U64(now.saturating_add(self.cert_ttl_ns)),
        })
    }

    // ---------- verifier views ----------

    /// The one call an exchange needs: valid, unexpired, unrevoked, clean.
    pub fn is_clean(&self, account: AccountId) -> bool {
        self.certs.get(&account).is_some_and(|c| self.is_valid(c) && c.verdict == "clean")
    }

    /// Full certificate (or null). `valid` is false if expired or revoked.
    pub fn get_certificate(&self, account: AccountId) -> Option<Value> {
        self.certs.get(&account).map(|c| json!({ "certificate": c, "valid": self.is_valid(c) }))
    }

    pub fn get_checker_hash(&self) -> String {
        self.checker.hash.clone()
    }

    pub fn is_revoked(&self, checker_hash: String) -> bool {
        self.revoked.contains(&checker_hash)
    }

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            outlayer: self.outlayer.clone(),
            checker: self.checker.clone(),
            pending: self.pending.clone(),
            timelock_ns: U64(self.timelock_ns),
            cert_ttl_ns: U64(self.cert_ttl_ns),
        }
    }

    fn is_valid(&self, c: &Certificate) -> bool {
        env::block_timestamp() < c.expires_at_ns.0 && !self.revoked.contains(&c.checker_hash)
    }

    // ---------- governance ----------

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    /// Propose a new checker. Activates no sooner than `timelock_ns` from now.
    pub fn set_checker_hash(&mut self, checker: Checker) {
        self.assert_owner();
        require!(valid_hash(&checker.hash), "checker hash must be 64 lowercase hex");
        require!(checker.url.starts_with("https://"), "checker url must be https");
        let activates_at_ns = U64(env::block_timestamp() + self.timelock_ns);
        emit("checker_proposed", json!({ "hash": checker.hash, "url": checker.url, "activates_at_ns": activates_at_ns }));
        self.pending = Some(PendingChecker { checker, activates_at_ns });
    }

    /// Anyone can activate a pending checker once its timelock has passed.
    pub fn apply_checker_hash(&mut self) {
        let p = self.pending.take().unwrap_or_else(|| env::panic_str("nothing pending"));
        require!(env::block_timestamp() >= p.activates_at_ns.0, "timelock not elapsed");
        emit("checker_activated", json!({ "hash": p.checker.hash, "previous": self.checker.hash }));
        self.checker = p.checker;
    }

    pub fn cancel_checker_hash(&mut self) {
        self.assert_owner();
        self.pending = None;
    }

    /// Kill every certificate issued by a checker version, immediately.
    pub fn revoke_checker_hash(&mut self, checker_hash: String) {
        self.assert_owner();
        emit("checker_revoked", json!({ "hash": checker_hash }));
        self.revoked.insert(checker_hash);
    }
}

#[cfg(test)]
mod tests;
