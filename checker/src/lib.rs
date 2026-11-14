//! NIXO checker.
//!
//! The trusted core is [`verdict`]: a pure function with no I/O, proven with Kani
//! (see `proofs/verdict.rs`). Everything that touches bytes (parsing, hashing,
//! list loading, encoding) lives in [`shell`] and can only *feed* the core; it
//! has no path to `Verdict::Clean` except through `verdict()`.
//!
//! Multi-hop tracing lives in [`trace`], also pure and Kani-proven. The shell
//! runs `verdict()` first (list hits on the account and its direct
//! counterparties), then `trace::search()` for paths up to `trace::MAX_HOPS`.

pub mod http_get;
pub mod live;
pub mod shell;
pub mod trace;

/// A normalized address: SHA-256 of the canonical address string.
pub type Addr = [u8; 32];

/// Why a check did not pass. Never carries the offending address.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    /// A traced address is on a banned list.
    ListHit,
    /// The banned list is empty or failed to load: fail closed.
    ListUnavailable,
    /// The input could not be parsed.
    MalformedInput,
    /// No confidential history could be loaded for the account.
    HistoryUnavailable,
    /// A listed address reaches the account through a chain of transfers
    /// and/or pool hops within the hop limit.
    TaintPath,
    /// Part of the history needed within the hop limit could not be listed.
    HistoryIncomplete,
}

impl Reason {
    pub fn code(self) -> &'static str {
        match self {
            Reason::ListHit => "list_hit",
            Reason::ListUnavailable => "list_unavailable",
            Reason::MalformedInput => "malformed_input",
            Reason::HistoryUnavailable => "history_unavailable",
            Reason::TaintPath => "taint_path",
            Reason::HistoryIncomplete => "history_incomplete",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Clean,
    /// Not Clean, but the only evidence is a weak link (a pool hop at the edge
    /// of tolerance). `is_clean` stays false; a human should look.
    Warn(Reason),
    Rejected(Reason),
}

/// The proven core. Pure, no I/O, no allocation.
///
/// `Clean` iff `banned` is non-empty and no element of `traced` is in `banned`.
pub fn verdict<A: PartialEq>(traced: &[A], banned: &[A]) -> Verdict {
    if banned.is_empty() {
        return Verdict::Rejected(Reason::ListUnavailable);
    }
    for a in traced {
        if banned.contains(a) {
            return Verdict::Rejected(Reason::ListHit);
        }
    }
    Verdict::Clean
}

#[cfg(kani)]
#[path = "../proofs/verdict.rs"]
mod proofs;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_list_fails_closed() {
        assert_eq!(verdict::<u32>(&[1], &[]), Verdict::Rejected(Reason::ListUnavailable));
    }

    #[test]
    fn hit_and_miss() {
        assert_eq!(verdict(&[1, 2, 3], &[9, 3]), Verdict::Rejected(Reason::ListHit));
        assert_eq!(verdict(&[1, 2, 3], &[9, 8]), Verdict::Clean);
        assert_eq!(verdict::<u32>(&[], &[9]), Verdict::Clean);
    }
}
