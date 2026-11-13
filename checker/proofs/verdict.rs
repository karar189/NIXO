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
