"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { NearAiVerifiedPanel } from "@/components/NearAiVerifiedPanel";
import type { AttestationCheck } from "@/lib/nearai";

type SampleId = "alice" | "mallory" | "expense";

const SAMPLES: { id: SampleId; title: string; blurb: string }[] = [
  {
    id: "alice",
    title: "Alice — clean passport",
    blurb: "Fictional public certificate JSON. Model never sees chain history.",
  },
  {
    id: "mallory",
    title: "Mallory — rejected",
    blurb: "Fictional rejected cert (taint_path). Demo trail, not a live upload.",
  },
  {
    id: "expense",
    title: "Expense memo (track sample)",
    blurb: "Synthetic reimbursements + linked clean cert. No real bank data.",
  },
];

type Result = {
  text: string;
  model: string;
  nonce: string;
  verified: boolean;
  checks: AttestationCheck[];
  completion_id: string;
  ephemeral: boolean;
  error?: string;
};

export default function PrivateAiPage() {
  const [sample, setSample] = useState<SampleId>("alice");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/private-ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ sample }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(data as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [sample]);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <header className="space-y-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Privacy &amp; Private AI · NEAR AI Cloud</p>
        <h1 className="font-display text-3xl tracking-tight sm:text-4xl">Private compliance note</h1>
        <p className="max-w-2xl text-muted">
          Pick a fictional sample. A TEE-hosted model on{" "}
          <code className="font-mono text-xs">cloud-api.near.ai</code> categorizes / explains it. We fetch an
          attestation report with a fresh random nonce and show what was checked. Nothing is kept server-side after
          the response.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Sample documents (no real data)</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {SAMPLES.map((s) => {
            const on = sample === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSample(s.id)}
                className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                  on ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-accent/50"
                }`}
              >
                <div className="text-sm font-medium">{s.title}</div>
                <div className="mt-1 text-xs text-muted">{s.blurb}</div>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="mt-2 w-full rounded-lg bg-accent px-4 py-3 font-medium text-accent-ink disabled:opacity-50 sm:w-auto"
        >
          {busy ? "Running in TEE…" : "Analyze in NEAR AI Cloud"}
        </button>
        {error && <p className="text-sm text-reject">{error}</p>}
      </section>

      {result && (
        <section className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium">Model note</h2>
              {result.ephemeral && (
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted">ephemeral · no retention</span>
              )}
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{result.text}</p>
          </div>
          <NearAiVerifiedPanel
            model={result.model}
            nonce={result.nonce}
            verified={result.verified}
            checks={result.checks}
            completionId={result.completion_id}
          />
        </section>
      )}

      <footer className="border-t border-border pt-6 text-sm text-muted">
        <p>
          Full Intel TDX + GPU verification:{" "}
          <code className="font-mono text-xs">scripts/nearai_smoke.py</code>. Checker TEE (OutLayer) is separate — see{" "}
          <Link className="underline" href="/verify">
            Exchange view
          </Link>
          .
        </p>
      </footer>
    </div>
  );
}
