//! NIXO copy keys: paid subscriptions to a trader's encrypted agent-trade feed.
//!
//! A trader lists a key (price per period). A follower calls `subscribe` with NEAR
//! attached and the X25519 public key their browser generated. The deposit goes
//! straight to the trader. The agents service reads `get_subscription` and only
//! wraps feed keys to the public key stored here, so nobody can claim someone
//! else's subscription by naming their account.
//!
//! This contract sells access to an encrypted log. It does not hide any trade or
//! transfer on-chain, and a subscriber can re-share what they decrypt.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{json, Value};
use near_sdk::store::IterableMap;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

/// Smallest listing price: 0.001 NEAR per period. Bounds storage spam, since the
/// contract pays storage for every subscription row.
pub const MIN_PRICE_YOCTO: u128 = 1_000_000_000_000_000_000_000;
pub const MIN_PERIOD_SECS: u64 = 60;
pub const MAX_PERIOD_SECS: u64 = 365 * 24 * 3600;
pub const MAX_PERIODS: u32 = 52;
const NS_PER_SEC: u64 = 1_000_000_000;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Listing {
    pub trader: AccountId,
    pub price_per_period: U128,
    pub period_secs: u64,
    pub active: bool,
    pub subscriber_count: u32,
    pub earned_total: U128,
    pub listed_at_ns: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Subscription {
    pub trader: AccountId,
    pub follower: AccountId,
    /// Base64 of the follower's 32-byte X25519 public key (44 chars).
    pub x25519_pub: String,
    pub starts_at_ns: U64,
    pub expires_at_ns: U64,
    pub paid_total: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct CopyKeys {
    owner: AccountId,
    listings: IterableMap<AccountId, Listing>,
    subs: IterableMap<String, Subscription>,
}

fn emit(event: &str, data: Value) {
    let ev = json!({ "standard": "nixo-copykeys", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{ev}"));
}

fn sub_key(trader: &AccountId, follower: &AccountId) -> String {
    format!("{trader}|{follower}")
}

/// 32 bytes in standard base64 is exactly 43 alphabet chars plus one '='.
pub fn valid_x25519_pub(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 44
        && b[43] == b'='
        && b[..43].iter().all(|c| c.is_ascii_alphanumeric() || *c == b'+' || *c == b'/')
}

#[near]
impl CopyKeys {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self { owner, listings: IterableMap::new(b"l"), subs: IterableMap::new(b"s") }
    }

    // ---------- trader ----------

    /// List (or re-price) the caller's copy key. Re-listing keeps counts and earnings.
    pub fn list_key(&mut self, price_per_period: U128, period_secs: u64) -> Listing {
        require!(price_per_period.0 >= MIN_PRICE_YOCTO, "PRICE_TOO_LOW");
        require!((MIN_PERIOD_SECS..=MAX_PERIOD_SECS).contains(&period_secs), "INVALID_PERIOD");
        let trader = env::predecessor_account_id();
        let listing = match self.listings.get(&trader) {
            Some(prev) => Listing { price_per_period, period_secs, active: true, ..prev.clone() },
            None => Listing {
                trader: trader.clone(),
                price_per_period,
                period_secs,
                active: true,
                subscriber_count: 0,
                earned_total: U128(0),
                listed_at_ns: U64(env::block_timestamp()),
            },
        };
        self.listings.insert(trader.clone(), listing.clone());
        emit(
            "key_listed",
            json!({ "trader": trader, "price_per_period": price_per_period, "period_secs": period_secs }),
        );
        listing
    }

    /// Stop selling. Existing subscriptions run until they expire.
    pub fn unlist(&mut self) -> Listing {
        let trader = env::predecessor_account_id();
        let mut listing =
            self.listings.get(&trader).cloned().unwrap_or_else(|| env::panic_str("NOT_LISTED"));
        listing.active = false;
        self.listings.insert(trader.clone(), listing.clone());
        emit("key_unlisted", json!({ "trader": trader }));
        listing
    }

    // ---------- follower ----------

    /// Pay `price_per_period * periods` to subscribe (or extend) to `trader`'s feed.
    /// The deposit is forwarded to the trader in full.
    #[payable]
    pub fn subscribe(&mut self, trader: AccountId, periods: u32, x25519_pub: String) -> Subscription {
        let follower = env::predecessor_account_id();
        require!(follower != trader, "SELF_SUBSCRIBE");
        require!((1..=MAX_PERIODS).contains(&periods), "INVALID_PERIODS");
        require!(valid_x25519_pub(&x25519_pub), "INVALID_X25519_PUB");

        let mut listing =
            self.listings.get(&trader).cloned().unwrap_or_else(|| env::panic_str("NOT_LISTED"));
        require!(listing.active, "NOT_LISTED");

        let due = listing
            .price_per_period
            .0
            .checked_mul(periods as u128)
            .unwrap_or_else(|| env::panic_str("OVERFLOW"));
        let paid = env::attached_deposit().as_yoctonear();
        require!(paid == due, "WRONG_DEPOSIT");

        let now = env::block_timestamp();
        let add_ns = listing.period_secs * NS_PER_SEC * periods as u64;
        let key = sub_key(&trader, &follower);
        let sub = match self.subs.get(&key).cloned() {
            // Still running: extend from the current expiry.
            Some(prev) if prev.expires_at_ns.0 > now => Subscription {
                x25519_pub,
                expires_at_ns: U64(prev.expires_at_ns.0 + add_ns),
                paid_total: U128(prev.paid_total.0 + paid),
                ..prev
            },
            // Lapsed: restart from now.
            Some(prev) => Subscription {
                x25519_pub,
                starts_at_ns: U64(now),
                expires_at_ns: U64(now + add_ns),
                paid_total: U128(prev.paid_total.0 + paid),
                ..prev
            },
            None => {
                listing.subscriber_count += 1;
                Subscription {
                    trader: trader.clone(),
                    follower: follower.clone(),
                    x25519_pub,
                    starts_at_ns: U64(now),
                    expires_at_ns: U64(now + add_ns),
                    paid_total: U128(paid),
                }
            }
        };
        listing.earned_total = U128(listing.earned_total.0 + paid);
        self.listings.insert(trader.clone(), listing);
        self.subs.insert(key, sub.clone());

        emit(
            "key_purchased",
            json!({
                "trader": trader,
                "follower": follower,
                "periods": periods,
                "amount": U128(paid),
                "starts_at_ns": sub.starts_at_ns,
                "expires_at_ns": sub.expires_at_ns,
            }),
        );
        // Dropping a Promise schedules it (near-sdk 5): the payout is fire-and-forget.
        let _ = Promise::new(trader).transfer(NearToken::from_yoctonear(paid));
        sub
    }

    // ---------- views ----------

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn get_listing(&self, trader: AccountId) -> Option<Listing> {
        self.listings.get(&trader).cloned()
    }

    pub fn list_listings(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Listing> {
        self.listings
            .values()
            .filter(|l| l.active)
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(200) as usize)
            .cloned()
            .collect()
    }

    pub fn get_subscription(&self, trader: AccountId, follower: AccountId) -> Option<Subscription> {
        self.subs.get(&sub_key(&trader, &follower)).cloned()
    }

    pub fn is_active(&self, trader: AccountId, follower: AccountId) -> bool {
        let now = env::block_timestamp();
        self.subs
            .get(&sub_key(&trader, &follower))
            .is_some_and(|s| s.starts_at_ns.0 <= now && now < s.expires_at_ns.0)
    }

    pub fn subscribers_of(&self, trader: AccountId) -> Vec<Subscription> {
        self.subs.values().filter(|s| s.trader == trader).cloned().collect()
    }

    pub fn subscriptions_of(&self, follower: AccountId) -> Vec<Subscription> {
        self.subs.values().filter(|s| s.follower == follower).cloned().collect()
    }
}

#[cfg(test)]
mod tests;
