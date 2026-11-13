"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { NIXO_CONTRACT } from "@/lib/config";
import { getCertificate, isClean, type CertificateView } from "@/lib/nixo-sdk";
import { CertificateCard } from "@/components/CertificateCard";
import { VerifiedPanel } from "@/components/VerifiedPanel";

function Verify() {
  const params = useSearchParams();
  const [account, setAccount] = useState(params.get("account") ?? "nixo-alice.testnet");
  const [result, setResult] = useState<{ clean: boolean; view: CertificateView | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Only sets state after the network round-trip, so it is safe to call from an effect.
  const fetchResult = useCallback(async (acct: string) => {
    try {
      const [clean, view] = await Promise.all([isClean(acct.trim()), getCertificate(acct.trim())]);
      setResult({ clean, view });
      setError(null);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const check = (acct: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    fetchResult(acct);
  };

  useEffect(() => {
    const a = params.get("account");
    if (!a) return;
    let live = true;
    Promise.all([isClean(a.trim()), getCertificate(a.trim())])
      .then(([clean, view]) => live && setResult({ clean, view }))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [params]);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Exchange view</h1>
        <p className="mt-2 text-muted">
          One view call to <code className="font-mono">{NIXO_CONTRACT}</code>. You learn the verdict and how it was produced, never balances or counterparties.
        </p>
      </section>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          check(account);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm"
          placeholder="account.testnet"
        />
        <button className="rounded-lg bg-accent px-4 py-2 font-medium text-white disabled:opacity-50 dark:text-black" disabled={loading}>
          {loading ? "Checking…" : "is_clean"}
        </button>
      </form>
      <pre className="overflow-x-auto rounded-lg border border-border bg-surface p-3 font-mono text-xs">
        {`near view ${NIXO_CONTRACT} is_clean '{"account":"${account}"}'`}
      </pre>
      {error && <p className="text-sm text-reject">{error}</p>}
      {result && (
        <div className="space-y-4">
          <div className={`text-4xl font-semibold ${result.clean ? "text-clean" : "text-reject"}`}>
            {result.clean ? "✅ is_clean = true" : "❌ is_clean = false"}
          </div>
          {result.view ? (
            <>
              <CertificateCard view={result.view} />
              <VerifiedPanel view={result.view} />
            </>
          ) : (
            <p className="text-muted">No certificate on-chain for this account.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
