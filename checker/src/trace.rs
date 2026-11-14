//! Multi-hop taint search. Pure, deterministic, no I/O: proven with Kani
//! (see `proofs/verdict.rs`).
//!
//! Input is a list of money links `from -> to` at time `t` over small integer
//! node ids. The search walks backwards from the subject: from a node reached
//! through a link at time `t`, only links into it that happened strictly
//! *before* `t` are followed (funds can only flow forward in time). It stops at
//! `max_hops` links or at the first listed node.
//!
//! Outcome precedence (fail closed):
//!   1. a path to a listed node with only strong links  -> `Tainted { weak: false }`
//!   2. a node that had to be expanded was not fully listed -> `Incomplete`
//!   3. only paths that use a weak link                  -> `Tainted { weak: true }`
//!   4. otherwise                                         -> `Clean`

/// Default hop limit.
pub const MAX_HOPS: u8 = 6;
/// Pool-hop rule: the swap out must follow the swap in within this window.
pub const POOL_WINDOW_NS: u64 = 120 * 1_000_000_000;
/// Pool-hop rule: amounts must match within ±15% (basis points of the swap in).
pub const POOL_TOLERANCE_BPS: u128 = 1_500;
/// A pool link whose amounts differ by more than 12% is "weak" (edge of tolerance).
pub const POOL_WEAK_BPS: u128 = 1_200;

/// A directed money link: value moved from `from` to `to` at time `t` (ns).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Link {
    pub from: u32,
    pub to: u32,
    pub t: u64,
    pub weak: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    Clean,
    /// Link indices from the listed node (first) to the subject (last).
    Tainted { path: Vec<usize>, weak: bool },
    Incomplete,
}

#[derive(Clone, Copy)]
struct State {
    node: u32,
    /// Only links strictly before this time can feed this node's funds.
    bound: u64,
    depth: u8,
    weak: bool,
    /// (link used to reach the previous state, index of that state)
    via: Option<(usize, usize)>,
}

fn path_of(states: &[State], mut i: usize, last: usize) -> Vec<usize> {
    // `last` is the link into the listed node's successor; walk back to the subject.
    let mut p = vec![last];
    while let Some((link, prev)) = states[i].via {
        p.push(link);
        i = prev;
    }
    p
}

/// Backward search from `subject`. `listed[n]` / `complete[n]` describe node `n`
/// (missing entries count as not listed / not complete).
pub fn search(links: &[Link], subject: u32, listed: &[bool], complete: &[bool], max_hops: u8) -> Outcome {
    let is = |v: &[bool], n: u32| v.get(n as usize).copied().unwrap_or(false);
    if is(listed, subject) {
        return Outcome::Tainted { path: Vec::new(), weak: false };
    }
    let n = listed.len().max(complete.len()).max(subject as usize + 1);
    // Widest time bound already queued per node, for strong and weak states.
    // 0 means "not queued": real link times are > 0 (block timestamps).
    let mut best_strong = vec![0u64; n];
    let mut best_weak = vec![0u64; n];
    best_strong[subject as usize] = u64::MAX;
    // Every push strictly raises best_strong or best_weak of the pushed node to
    // a link's time, so there are at most 2 * links.len() pushes: the state
    // list never reallocates.
    let mut states: Vec<State> = Vec::with_capacity(2 * links.len() + 1);
    states.push(State { node: subject, bound: u64::MAX, depth: 0, weak: false, via: None });
    let mut incomplete = false;
    let mut weak_hit: Option<Vec<usize>> = None;

    let mut i = 0;
    while i < states.len() {
        let s = states[i];
        if s.depth < max_hops {
            if !is(complete, s.node) {
                incomplete = true;
            }
            for (li, l) in links.iter().enumerate() {
                if l.to != s.node || l.t >= s.bound || l.t == 0 || (l.from as usize) >= n {
                    continue;
                }
                let weak = s.weak || l.weak;
                if is(listed, l.from) {
                    let p = path_of(&states, i, li);
                    if !weak {
                        return Outcome::Tainted { path: p, weak: false };
                    }
                    if weak_hit.is_none() {
                        weak_hit = Some(p);
                    }
                    continue;
                }
                let u = l.from as usize;
                if weak {
                    if l.t > best_weak[u] && l.t > best_strong[u] {
                        best_weak[u] = l.t;
                        states.push(State { node: l.from, bound: l.t, depth: s.depth + 1, weak, via: Some((li, i)) });
                    }
                } else if l.t > best_strong[u] {
                    best_strong[u] = l.t;
                    states.push(State { node: l.from, bound: l.t, depth: s.depth + 1, weak, via: Some((li, i)) });
                }
            }
        }
        i += 1;
    }
    if incomplete {
        return Outcome::Incomplete;
    }
    match weak_hit {
        Some(path) => Outcome::Tainted { path, weak: true },
        None => Outcome::Clean,
    }
}

/// Pool-hop rule, in basis points of the swap in. `None` if outside tolerance.
pub fn pool_match_bps(amount_in: u128, amount_out: u128) -> Option<u128> {
    if amount_in == 0 {
        return None;
    }
    let diff = amount_in.abs_diff(amount_out);
    // diff / amount_in <= 15%  <=>  diff * 10_000 <= 1_500 * amount_in (no overflow for yocto amounts < 2^114)
    let bps = diff.checked_mul(10_000)? / amount_in;
    (bps <= POOL_TOLERANCE_BPS).then_some(bps)
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn l(from: u32, to: u32, t: u64) -> Link {
        Link { from, to, t, weak: false }
    }

    #[test]
    fn finds_shortest_time_ordered_path() {
        // 3 -> 2 -> 1 -> 0 (subject), 3 listed
        let links = [l(3, 2, 10), l(2, 1, 20), l(1, 0, 30)];
        let o = search(&links, 0, &[false, false, false, true], &[true; 4], 6);
        assert_eq!(o, Outcome::Tainted { path: vec![0, 1, 2], weak: false });
    }

    #[test]
    fn funds_cannot_flow_backwards_in_time() {
        // 3 -> 2 happens AFTER 2 -> 1: those funds never reached 1
        let links = [l(3, 2, 25), l(2, 1, 20), l(1, 0, 30)];
        let o = search(&links, 0, &[false, false, false, true], &[true; 4], 6);
        assert_eq!(o, Outcome::Clean);
    }

    #[test]
    fn hop_limit_is_respected() {
        let links = [l(3, 2, 10), l(2, 1, 20), l(1, 0, 30)];
        let listed = [false, false, false, true];
        assert!(matches!(search(&links, 0, &listed, &[true; 4], 3), Outcome::Tainted { .. }));
        assert_eq!(search(&links, 0, &listed, &[true; 4], 2), Outcome::Clean);
    }

    #[test]
    fn incomplete_beats_clean_but_not_taint() {
        let links = [l(2, 1, 10), l(1, 0, 20)];
        // node 1 not fully listed, nothing tainted -> Incomplete
        assert_eq!(search(&links, 0, &[false; 3], &[true, false, true], 6), Outcome::Incomplete);
        // ... but a taint path still rejects
        assert!(matches!(search(&links, 0, &[false, false, true], &[true, false, true], 6), Outcome::Tainted { weak: false, .. }));
    }

    #[test]
    fn weak_only_path_is_weak_and_strong_wins() {
        let mut weak = l(2, 1, 10);
        weak.weak = true;
        let o = search(&[weak, l(1, 0, 20)], 0, &[false, false, true], &[true; 3], 6);
        assert!(matches!(o, Outcome::Tainted { weak: true, .. }));
        // a strong path to another listed node takes precedence
        let o = search(&[weak, l(1, 0, 20), l(3, 0, 5)], 0, &[false, false, true, true], &[true; 4], 6);
        assert_eq!(o, Outcome::Tainted { path: vec![2], weak: false });
    }

    #[test]
    fn listed_subject_is_tainted() {
        assert_eq!(search(&[], 0, &[true], &[true], 6), Outcome::Tainted { path: vec![], weak: false });
    }

    #[test]
    fn pool_tolerance() {
        assert_eq!(pool_match_bps(1000, 1000), Some(0));
        assert_eq!(pool_match_bps(1000, 1150), Some(1500));
        assert_eq!(pool_match_bps(1000, 850), Some(1500));
        assert_eq!(pool_match_bps(1000, 1151), None);
        assert_eq!(pool_match_bps(0, 0), None);
    }
}
