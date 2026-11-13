//! OutLayer integration: request a run of the pinned checker WASM and parse
//! the result. OutLayer yields until a registered TDX worker resolves the run,
//! then returns the guest's stdout JSON (or `null` on failure) to our callback.
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{ext_contract, AccountId};

#[ext_contract(ext_outlayer)]
#[allow(dead_code)]
pub trait OutLayer {
    fn request_execution(
        &mut self,
        source: Value,
        resource_limits: Option<Value>,
        input_data: Option<String>,
        secrets_ref: Option<Value>,
        response_format: Option<String>,
        payer_account_id: Option<AccountId>,
    );
}

/// Source pinned by hash: OutLayer only runs a WASM whose SHA-256 matches.
pub fn source(wasm_url: &str, wasm_hash: &str) -> Value {
    json!({ "WasmUrl": { "url": wasm_url, "hash": wasm_hash, "build_target": "wasm32-wasip2" } })
}

pub fn resource_limits() -> Value {
    json!({ "max_instructions": 10_000_000_000u64, "max_memory_mb": 128u32, "max_execution_seconds": 30u64 })
}

/// The only public input: the caller's account. Never the history.
pub fn input_data(account: &AccountId) -> String {
    json!({ "account": account }).to_string()
}

/// Mirror of the checker's `shell::Output`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub struct CheckerOutput {
    pub account: String,
    pub verdict: String,
    pub reason: Option<String>,
    pub checker_version: String,
    pub list_snapshot: String,
    pub list_hash: String,
    pub trace_depth: u8,
    pub history_source: String,
    pub input_hash: String,
}

/// Parse OutLayer's JSON result. `Json` format gives an object; tolerate a
/// string containing JSON as well.
pub fn parse(v: Value) -> Option<CheckerOutput> {
    match v {
        Value::String(s) => serde_json::from_str(&s).ok(),
        other => serde_json::from_value(other).ok(),
    }
}
