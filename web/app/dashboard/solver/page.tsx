"use client";

import { useState } from "react";
import { DEMO_ACCOUNTS, type DemoId } from "@/lib/config";
import { mockSolve, type MockFillResult } from "@/lib/solver/mock-solver";
import { MockTag } from "@/components/MockTag";

export default function SolverPage() {
  const [who, setWho] = useState<DemoId>("alice");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MockFillResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const account = DEMO_ACCOUNTS.find((a) => a.id === who)!;

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await mockSolve({
        origin: account.label,
        assetIn: "NEAR",
        assetOut: "USDC",
        amount: "1",
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <header>
        <p className="kicker">Layer 3</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Mock solver</h1>
        <p className="mt-2 text-sm text-muted">
          Fail-closed gate before fill: only a currently valid Clean certificate is allowed.
          Missing, expired, warn, rejected, and RPC failures all refuse.
        </p>
        <p className="mt-2">
          <MockTag>mock solver · not a live Intents network</MockTag>
        </p>
      </header>

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="text-sm font-medium">Paper intent</div>
        <p className="mt-1 text-xs text-muted">
          Origin account · 1 NEAR → USDC (no settlement, no 1Click).
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {DEMO_ACCOUNTS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setWho(a.id);
                setResult(null);
                setError(null);
              }}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                who === a.id
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-line text-muted hover:border-border hover:text-foreground"
              }`}
            >
              {a.id === "alice" ? "Alice" : "Mallory"}
              <span className="ml-2 font-mono text-[11px] text-muted">{a.label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity disabled:opacity-50"
        >
          {busy ? "Checking certificate…" : `Run mock fill as ${who === "alice" ? "Alice" : "Mallory"}`}
        </button>

        {error && <p className="mt-3 text-sm text-reject">{error}</p>}

        {result?.status === "filled" && (
          <div className="mt-4 rounded-lg border border-clean/40 bg-clean/5 p-4 text-sm">
            <p className="font-medium text-clean">Filled (mock)</p>
            <p className="mt-1 font-mono text-xs text-muted">
              {result.origin} · {result.amount ?? "?"} {result.assetIn ?? "?"} → {result.assetOut ?? "?"}
            </p>
            <p className="mt-2 text-xs text-muted">at {result.filledAt}</p>
          </div>
        )}

        {result?.status === "refused" && (
          <div className="mt-4 rounded-lg border border-reject/40 bg-reject/5 p-4 text-sm">
            <p className="font-medium text-reject">Refused</p>
            <p className="mt-1 font-mono text-xs">
              {result.decision.code}: {result.decision.reason}
            </p>
            <p className="mt-2 text-xs text-muted">origin {result.origin} · {result.refusedAt}</p>
          </div>
        )}
      </section>

      <p className="text-xs text-muted">
        CLI: <code className="font-mono">pnpm demo:solver</code> · unit tests:{" "}
        <code className="font-mono">pnpm test:solver</code>
      </p>
    </div>
  );
}
