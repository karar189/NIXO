// Unit tests for the fail-closed solver gate (mocked certificate lookup).
//
//   pnpm test:solver
import assert from "node:assert/strict";
import { checkIntent, type CertificateLookup } from "../web/lib/solver-gate";
import { mockSolve } from "../web/lib/solver/mock-solver";
import type { Certificate, CertificateView } from "../web/lib/nixo-sdk";

function cert(
  account: string,
  verdict: Certificate["verdict"],
  opts: { valid?: boolean; reason?: string | null } = {},
): CertificateView {
  return {
    valid: opts.valid ?? true,
    certificate: {
      account,
      verdict,
      reason: opts.reason ?? null,
      checker_hash: "a".repeat(64),
      checker_version: "0.2.0",
      list_snapshot: "data-2026-10-29",
      list_hash: "b".repeat(64),
      trace_depth: 6,
      history_source: "fixture",
      input_hash: "c".repeat(64),
      issued_at_ns: "0",
      expires_at_ns: "9999999999999999999",
    },
  };
}

function lookupFrom(map: Record<string, CertificateView | null | "throw">): CertificateLookup {
  return async (account) => {
    const v = map[account];
    if (v === "throw") throw new Error("rpc down");
    if (v === undefined) return null;
    return v;
  };
}

async function run() {
  // clean allow
  {
    const d = await checkIntent(
      { origin: "nixo-alice.testnet" },
      lookupFrom({ "nixo-alice.testnet": cert("nixo-alice.testnet", "clean") }),
    );
    assert.equal(d.ok, true);
  }

  // missing → refuse
  {
    const d = await checkIntent({ origin: "nobody.testnet" }, lookupFrom({}));
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.code, "missing");
  }

  // expired / invalid flag → refuse
  {
    const d = await checkIntent(
      { origin: "old.testnet" },
      lookupFrom({ "old.testnet": cert("old.testnet", "clean", { valid: false, reason: "expired" }) }),
    );
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.code, "expired");
  }

  // warn → refuse
  {
    const d = await checkIntent(
      { origin: "warn.testnet" },
      lookupFrom({ "warn.testnet": cert("warn.testnet", "warn", { reason: "list proximity" }) }),
    );
    assert.equal(d.ok, false);
    if (!d.ok) {
      assert.equal(d.code, "warn");
      assert.match(d.reason, /list proximity/);
    }
  }

  // rejected → refuse
  {
    const d = await checkIntent(
      { origin: "nixo-mallory.testnet" },
      lookupFrom({
        "nixo-mallory.testnet": cert("nixo-mallory.testnet", "rejected", { reason: "taint_path" }),
      }),
    );
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.code, "rejected");
  }

  // rpc error → refuse (never throw-as-allow)
  {
    const d = await checkIntent(
      { origin: "flaky.testnet" },
      lookupFrom({ "flaky.testnet": "throw" }),
    );
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.code, "rpc_error");
  }

  // empty origin → invalid
  {
    const d = await checkIntent({ origin: "  " }, lookupFrom({}));
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.code, "invalid");
  }

  // destination must also be clean
  {
    const d = await checkIntent(
      { origin: "nixo-alice.testnet", destination: "dirty.testnet" },
      lookupFrom({
        "nixo-alice.testnet": cert("nixo-alice.testnet", "clean"),
        "dirty.testnet": cert("dirty.testnet", "rejected", { reason: "listed" }),
      }),
    );
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.code, "rejected");
  }

  // mock solver: Alice fill / Mallory refuse
  {
    const lookup = lookupFrom({
      "nixo-alice.testnet": cert("nixo-alice.testnet", "clean"),
      "nixo-mallory.testnet": cert("nixo-mallory.testnet", "rejected", { reason: "taint_path" }),
    });
    const alice = await mockSolve({ origin: "nixo-alice.testnet", amount: "1" }, lookup);
    const mallory = await mockSolve({ origin: "nixo-mallory.testnet", amount: "1" }, lookup);
    assert.equal(alice.status, "filled");
    assert.equal(mallory.status, "refused");
    if (mallory.status === "refused") assert.equal(mallory.decision.code, "rejected");
  }

  console.log("OK: solver-gate + mock-solver unit tests passed.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
