"use client";
import { useState } from "react";
import Link from "next/link";
import { DEMO_ACCOUNTS, EXPLORER, type DemoId } from "@/lib/config";
import { getCertificate, nsToDate, type CertificateView } from "@/lib/nixo-sdk";
import { CertificateCard } from "@/components/CertificateCard";
import { MockTag } from "@/components/MockTag";

type Phase = "idle" | "sending" | "waiting" | "done" | "error";
const POLL_MS = 2000;
const TIMEOUT_MS = 240_000;

export default function Home() {
  const [who, setWho] = useState<DemoId>("alice");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [view, setView] = useState<CertificateView | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [explain, setExplain] = useState<{ text?: string; error?: string; attestation?: { fetched: boolean; nonce_echoed: boolean } } | null>(null);

  async function run() {
    setPhase("sending");
    setError(null);
    setView(null);
    setTxHash(null);
    setExplain(null);
    const res = await fetch("/api/request", { method: "POST", body: JSON.stringify({ id: who }) });
    const body = await res.json();
    if (!res.ok) {
      setPhase("error");
      setError(body.error ?? "request failed");
      return;
    }
    setTxHash(body.txHash ?? null);
    setPhase("waiting");
    const started = Date.now();
    // Allow for clock skew between this browser and block time.
    const since = body.requestedAtMs - 30_000;
    while (Date.now() - started < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      setElapsed(Math.round((Date.now() - started) / 1000));
      const v = await getCertificate(body.account).catch(() => null);
      if (v && nsToDate(v.certificate.issued_at_ns).getTime() >= since) {
        setView(v);
        setPhase("done");
        fetch("/api/explain", { method: "POST", body: JSON.stringify({ account: body.account }) })
          .then((r) => r.json())
          .then(setExplain)
          .catch((e) => setExplain({ error: String(e) }));
        return;
      }
    }
    setPhase("error");
    setError("Timed out waiting for the TEE result. Check the transaction for a nixo_failed event.");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-6">
      <section>
        <p className="kicker">Clean funds · NIXO certificate</p>
        <h1 className="display mt-3 text-[clamp(1.3rem,2.6vw,1.9rem)] leading-snug">Prove your money is clean without proving where it&apos;s been.</h1>
        <p className="mt-3 text-muted">
          A sealed Intel TDX enclave screens your confidential history against sanctions and hacker lists and outputs only a verdict. NEAR records it as a
          7-day certificate any exchange can check with one call.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="text-sm font-medium">Demo wallet</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {DEMO_ACCOUNTS.map((a) => (
            <button
              key={a.id}
              onClick={() => setWho(a.id)}
              disabled={phase === "sending" || phase === "waiting"}
              className={`rounded-lg border p-3 text-left ${who === a.id ? "border-accent ring-1 ring-accent" : "border-border"}`}
            >
              <div className="font-mono text-sm">{a.label}</div>
              <div className="text-xs text-muted">{a.note}</div>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          <MockTag>simulated</MockTag> In the MVP the confidential history comes from fixtures compiled into the checker, not a live 1Click read.
        </p>
        <button
          onClick={run}
          disabled={phase === "sending" || phase === "waiting"}
          className="mt-4 w-full rounded-lg bg-accent px-4 py-3 font-medium text-white disabled:opacity-50 dark:text-black"
        >
          {phase === "sending" ? "Sending request…" : phase === "waiting" ? `Checking in sealed enclave… ${elapsed}s` : "Prove my funds are clean"}
        </button>
        {txHash && (
          <a className="mt-2 block text-xs text-muted underline" href={`${EXPLORER}/txns/${txHash}`} target="_blank" rel="noreferrer">
            transaction {txHash.slice(0, 10)}…
          </a>
        )}
        {error && <p className="mt-3 text-sm text-reject">{error}</p>}
      </section>

      {view && (
        <section className="space-y-4">
          <CertificateCard view={view} />
          <div className="rounded-xl border border-border bg-surface p-5 text-sm">
            <div className="font-medium">Compliance note</div>
            {!explain && <p className="mt-2 text-muted">Generating with NEAR AI Cloud…</p>}
            {explain?.text && <p className="mt-2 whitespace-pre-wrap">{explain.text}</p>}
            {explain?.error && <p className="mt-2 text-muted">{explain.error}</p>}
            {explain?.attestation && (
              <p className="mt-2 text-xs text-muted">
                Model saw only the public certificate. Attestation {explain.attestation.fetched ? "fetched" : "unavailable"}
                {explain.attestation.fetched && (explain.attestation.nonce_echoed ? ", bound to a fresh nonce" : ", nonce not found in report")}.
              </p>
            )}
          </div>
          <Link href={`/verify?account=${view.certificate.account}`} className="inline-block text-sm underline">
            Verify as an exchange →
          </Link>
        </section>
      )}
    </div>
  );
}
