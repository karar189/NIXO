"use client";
import { useState } from "react";
import { CACHED_EXAMPLES } from "@/lib/config";
import { TaintPath, type Hop } from "@/components/TaintPath";
import { MockTag } from "@/components/MockTag";

type Response = {
  result: {
    account: string;
    verdict: "clean" | "warn" | "rejected";
    reason: string | null;
    hops?: number;
    trace_depth: number;
    list_snapshot: string;
    history_source: string;
    path?: Hop[];
    incomplete?: string[];
  };
  history: { origin: "cached" | "live"; source: string; fetched_at: string; edges: number; accounts_fully_listed: number; incomplete: number; api_calls: number };
  checker: { build: string; sha256: string };
};

const REASON: Record<string, (hops?: number, depth?: number) => string> = {
  list_hit: () => "A listed address is this account or one of its direct counterparties.",
  taint_path: (h) => `Funds reach this account from a listed address in ${h} hop${h === 1 ? "" : "s"}.`,
  history_incomplete: (_, d) => `Part of the money trail within ${d} hops could not be fetched, so NIXO will not call it clean.`,
  history_unavailable: () => "No history could be loaded for this account.",
  malformed_input: () => "The history could not be read.",
  list_unavailable: () => "The sanctions/hack lists failed to load.",
};

export function CheckAnyWallet() {
  const [account, setAccount] = useState<string>(CACHED_EXAMPLES[0]);
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function trace(acct: string) {
    setAccount(acct);
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account: acct }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as Response);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const r = data?.result;
  const tone = r?.verdict === "clean" ? "text-clean" : r?.verdict === "warn" ? "text-mock" : "text-reject";
  const label = r?.verdict === "clean" ? "✅ Clean" : r?.verdict === "warn" ? "⚠️ Warn" : "❌ Rejected";

  return (
    <section className="space-y-4 border-t border-border pt-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Check any NEAR wallet</h2>
        <p className="mt-1 text-sm text-muted">
          Paste a NEAR <strong>mainnet</strong> account. NIXO fetches its money trail (transfers and Ref Finance pool hops, up to 6 hops back) and
          runs the same checker code on it. <MockTag>preview, not a certificate</MockTag>
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          trace(account.trim());
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm"
          placeholder="account.near"
          aria-label="NEAR mainnet account"
        />
        <button className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-50" disabled={loading}>
          {loading ? "Tracing…" : "Trace"}
        </button>
      </form>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="text-muted">Cached examples:</span>
        {CACHED_EXAMPLES.map((a) => (
          <button key={a} onClick={() => trace(a)} className="rounded border border-border px-2 py-0.5 font-mono hover:bg-surface" disabled={loading}>
            {a}
          </button>
        ))}
      </div>
      {loading && <p className="text-sm text-muted">Cached accounts answer instantly. A new account is fetched live from NearBlocks and can take up to ~2 minutes on the free tier.</p>}
      {error && <p className="text-sm text-reject">{error}</p>}
      {r && data && (
        <div className="space-y-4">
          <div>
            <div className={`text-3xl font-semibold ${tone}`}>{label}</div>
            <p className="mt-1 text-sm">{r.reason ? REASON[r.reason]?.(r.hops, r.trace_depth) ?? r.reason : "No path to a listed address within 6 hops, and the whole trail was fetched."}</p>
            {r.verdict === "warn" && <p className="mt-1 text-sm text-muted">The only evidence is a weak pool link (amounts at the edge of the ±15% tolerance). A human should look.</p>}
          </div>
          {r.path && r.path.length > 0 && <TaintPath path={r.path} />}
          {r.incomplete && r.incomplete.length > 0 && (
            <details className="text-xs text-muted">
              <summary>What could not be fetched ({data.history.incomplete})</summary>
              <ul className="mt-1 list-disc pl-5">
                {r.incomplete.map((n) => (
                  <li key={n} className="font-mono">{n}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="rounded-lg border border-border bg-surface p-3 text-xs text-muted">
            <div>
              History: {data.history.origin === "cached" ? "cached mainnet fixture" : `fetched live (${data.history.api_calls} API calls)`} from {data.history.source},{" "}
              {data.history.fetched_at.slice(0, 19).replace("T", " ")} UTC · {data.history.edges} edges · lists {r.list_snapshot}
            </div>
            <div className="mt-1">
              Checker: {data.checker.build}, sha256 <span className="font-mono">{data.checker.sha256.slice(0, 16)}…</span>. The history was fetched outside the enclave and passed
              in, so this is a preview (history_source = &quot;{r.history_source}&quot;) and nixo.testnet will not certify it.
            </div>
            <div className="mt-1">
              Mainnet histories are replayed into the testnet demo: <span className="font-mono">nixo-mallory.testnet</span>&apos;s certificate comes from{" "}
              <span className="font-mono">farstreet4572.near</span>&apos;s real trail, compiled into the pinned checker.
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
