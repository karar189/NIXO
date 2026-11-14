//! Kani proof harnesses for the core `verdict()` rule. Run: `cargo kani`.
//!
//! Each harness checks all slices up to length N (lengths are symbolic too).
use super::*;

const N: usize = 8;

fn any_slice<const M: usize>(buf: &[u32; M]) -> &[u32] {
    let len: usize = kani::any();
    kani::assume(len <= M);
    &buf[..len]
}

/// Soundness: if any traced address is banned, the verdict is never Clean.
#[kani::proof]
#[kani::unwind(10)]
fn tainted_is_never_clean() {
    let tb: [u32; N] = kani::any();
    let bb: [u32; N] = kani::any();
    let traced = any_slice(&tb);
    let banned = any_slice(&bb);
    let i: usize = kani::any();
    let j: usize = kani::any();
    kani::assume(i < traced.len() && j < banned.len());
    kani::assume(traced[i] == banned[j]);
    assert!(verdict(traced, banned) != Verdict::Clean);
}

/// Fail closed: an empty banned list never yields Clean.
#[kani::proof]
#[kani::unwind(10)]
fn empty_list_is_never_clean() {
    let tb: [u32; N] = kani::any();
    let traced = any_slice(&tb);
    assert!(verdict(traced, &[]) == Verdict::Rejected(Reason::ListUnavailable));
}

/// Completeness: disjoint inputs with a non-empty list are always Clean
/// (no false rejections from the core rule).
#[kani::proof]
#[kani::unwind(10)]
fn disjoint_is_clean() {
    let tb: [u32; N] = kani::any();
    let bb: [u32; N] = kani::any();
    let traced = any_slice(&tb);
    let banned = any_slice(&bb);
    kani::assume(!banned.is_empty());
    kani::assume(traced.iter().all(|a| !banned.contains(a)));
    assert!(verdict(traced, banned) == Verdict::Clean);
}

/// Same soundness property on the production address type (smaller bound).
#[kani::proof]
#[kani::unwind(33)] // 32-byte memcmp in Addr equality
fn tainted_is_never_clean_addr() {
    let traced: [Addr; 3] = kani::any();
    let banned: [Addr; 3] = kani::any();
    let i: usize = kani::any();
    let j: usize = kani::any();
    kani::assume(i < 3 && j < 3);
    kani::assume(traced[i] == banned[j]);
    assert!(verdict(&traced, &banned) != Verdict::Clean);
}

// ---------------------------------------------------------------------------
// Multi-hop search (`trace::search`). Bounded: graphs of up to L = 3 links over
// K = 3 nodes, hop limits up to 3. Node ids, times, weak flags, listed/complete
// flags, the hop limit and the number of links are all symbolic.
// ---------------------------------------------------------------------------
use crate::trace::{search, Link, Outcome};

const K: usize = 3;
const L: usize = 3;

fn any_links(buf: &[Link; L]) -> &[Link] {
    let len: usize = kani::any();
    kani::assume(len <= L);
    for l in &buf[..len] {
        kani::assume((l.from as usize) < K && (l.to as usize) < K);
    }
    &buf[..len]
}

fn any_link() -> Link {
    let t: u64 = kani::any();
    kani::assume(t > 0); // block timestamps; 0 is reserved as \"never queued\"
    Link { from: kani::any(), to: kani::any(), t, weak: kani::any() }
}

/// (a) The search stops within the hop limit: any path it returns has at
/// most `max_hops` links, starts at a listed node, ends at the subject, is a
/// connected chain, and is strictly time-ordered (funds only flow forward).
#[kani::proof]
#[kani::unwind(8)]
#[kani::solver(kissat)]
fn path_respects_hop_limit_and_is_a_real_chain() {
    let buf: [Link; L] = [any_link(), any_link(), any_link()];
    let links = any_links(&buf);
    let listed: [bool; K] = kani::any();
    let complete: [bool; K] = kani::any();
    let subject: u32 = kani::any();
    kani::assume((subject as usize) < K && !listed[subject as usize]);
    let max_hops: u8 = kani::any();
    kani::assume(max_hops <= 3);
    if let Outcome::Tainted { path, .. } = search(links, subject, &listed, &complete, max_hops) {
        assert!(!path.is_empty() && path.len() <= max_hops as usize);
        assert!(listed[links[path[0]].from as usize]);
        assert!(links[path[path.len() - 1]].to == subject);
        for w in path.windows(2) {
            assert!(links[w[0]].to == links[w[1]].from);
            assert!(links[w[0]].t < links[w[1]].t);
        }
    }
}

/// (b) A listed address is always rejected: a listed subject is never Clean.
#[kani::proof]
#[kani::unwind(8)]
#[kani::solver(kissat)]
fn listed_subject_is_never_clean() {
    let buf: [Link; L] = [any_link(), any_link(), any_link()];
    let links = any_links(&buf);
    let mut listed: [bool; K] = kani::any();
    let complete: [bool; K] = kani::any();
    let subject: u32 = kani::any();
    kani::assume((subject as usize) < K);
    listed[subject as usize] = true;
    let max_hops: u8 = kani::any();
    kani::assume(max_hops <= 3);
    assert!(search(links, subject, &listed, &complete, max_hops) != Outcome::Clean);
}

/// Soundness of the search: a listed node that reaches the subject through a
/// time-ordered two-link chain within the hop limit is never Clean (it may be
/// Tainted, weak or strong, or Incomplete, but never Clean).
#[kani::proof]
#[kani::unwind(8)]
#[kani::solver(kissat)]
fn reachable_seed_within_limit_is_never_clean() {
    let mut buf: [Link; L] = [any_link(), any_link(), any_link()];
    let listed_node: u32 = kani::any();
    let mid: u32 = kani::any();
    let subject: u32 = kani::any();
    kani::assume((listed_node as usize) < K && (mid as usize) < K && (subject as usize) < K);
    // the chain listed -> mid -> subject, time-ordered, stored at symbolic slots
    buf[0].from = listed_node;
    buf[0].to = mid;
    buf[1].from = mid;
    buf[1].to = subject;
    kani::assume(buf[0].t < buf[1].t);
    let len: usize = kani::any();
    kani::assume((2..=L).contains(&len));
    for l in &buf[..len] {
        kani::assume((l.from as usize) < K && (l.to as usize) < K);
    }
    let mut listed: [bool; K] = kani::any();
    listed[listed_node as usize] = true;
    let complete: [bool; K] = kani::any();
    let max_hops: u8 = kani::any();
    kani::assume((2..=3).contains(&max_hops));
    assert!(search(&buf[..len], subject, &listed, &complete, max_hops) != Outcome::Clean);
}

/// Monotonic in the hop limit: raising the limit never turns a non-Clean
/// result into Clean.
#[kani::proof]
#[kani::unwind(8)]
#[kani::solver(kissat)]
fn raising_hop_limit_never_cleans() {
    let buf: [Link; L] = [any_link(), any_link(), any_link()];
    let links = any_links(&buf);
    let listed: [bool; K] = kani::any();
    let complete: [bool; K] = kani::any();
    let subject: u32 = kani::any();
    kani::assume((subject as usize) < K);
    let n: u8 = kani::any();
    kani::assume(n <= 2);
    if search(links, subject, &listed, &complete, n) != Outcome::Clean {
        assert!(search(links, subject, &listed, &complete, n + 1) != Outcome::Clean);
    }
}
