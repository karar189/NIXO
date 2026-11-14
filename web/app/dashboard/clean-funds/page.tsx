"use client";
import { useState } from "react";
import Link from "next/link";
import {
  DEMO_ACCOUNTS,
  EXPLORER,
  NIXO_CONTRACT,
  NIXO_REQUEST_DEPOSIT_NEAR,
  NIXO_REQUEST_DEPOSIT_YOCTO,
  NIXO_REQUEST_GAS,
  type DemoId,
} from "@/lib/config";
import { getCertificate, nsToDate, type CertificateView } from "@/lib/nixo-sdk";
import { CertificateCard } from "@/components/CertificateCard";
import { NearAiVerifiedPanel } from "@/components/NearAiVerifiedPanel";
import { MockTag } from "@/components/MockTag";
import { useWallet } from "@/components/wallet/WalletProvider";
import type { AttestationCheck } from "@/lib/nearai";

type Phase = "idle" | "sending" | "waiting" | "done" | "error";
const POLL_MS = 2000;
const TIMEOUT_MS = 240_000;

async function waitForCertificate(account: string, sinceMs: number): Promise<CertificateView> {
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const v = await getCertificate(account).catch(() => null);
    if (v && nsToDate(v.certificate.issued_at_ns).getTime() >= sinceMs) return v;
  }
  throw new Error("Timed out waiting for the TEE result. Check the transaction for a nixo_failed event.");
}

function txHashFromOutcomes(outcomes: unknown[]): string | null {
  const last = outcomes[outcomes.length - 1] as { transaction_outcome?: { id?: string }; transaction?: { hash?: string } } | undefined;
  return last?.transaction_outcome?.id ?? last?.transaction?.hash ?? null;
}

export default function CleanFundsPage() {
  const { accountId, network, ready, connect, signAndSend } = useWallet();

  const [who, setWho] = useState<DemoId>("alice");
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<"wallet" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [view, setView] = useState<CertificateView | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [explain, setExplain] = useState<{
    text?: string;
    error?: string;
    model?: string;
    nonce?: string;
    completion_id?: string;
    checks?: AttestationCheck[];
    attestation?: { fetched: boolean; nonce_echoed: boolean };
  } | null>(null);

  const busy = phase === "sending" || phase === "waiting";

  async function finish(account: string, requestedAtMs: number, hash: string | null) {
    setTxHash(hash);
    setPhase("waiting");
    const since = requestedAtMs - 30_000;
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - requestedAtMs) / 1000)), 500);
    try {
      const v = await waitForCertificate(account, since);
      setView(v);
      setPhase("done");
      fetch("/api/explain", { method: "POST", body: JSON.stringify({ account }) })
        .then((r) => r.json())
        .then(setExplain)
        .catch((e) => setExplain({ error: String(e) }));
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      clearInterval(tick);
    }
  }

  async function runWallet() {
    setMode("wallet");
    setPhase("sending");
    setError(null);
    setView(null);
    setTxHash(null);
    setExplain(null);
    setElapsed(0);

    if (!ready) {
      setPhase("error");
      setError("Wallet selector is still loading.");
      return;
    }
    if (!accountId) {
      setPhase("idle");
      await connect();
      return;
    }
    if (network !== "testnet") {
      setPhase("error");
      setError("Switch to testnet in Settings — NIXO certificates are on testnet.");
      return;
    }

    const requestedAtMs = Date.now();
    try {
      const outcomes = await signAndSend([
        {
          receiverId: NIXO_CONTRACT,
          actions: [
            {
              methodName: "request_nixo",
              args: {},
              gas: NIXO_REQUEST_GAS,
              deposit: NIXO_REQUEST_DEPOSIT_YOCTO,
            },
          ],
        },
      ]);
      await finish(accountId, requestedAtMs, txHashFromOutcomes(outcomes));
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runDemo() {
    setMode("demo");
    setPhase("sending");
    setError(null);
    setView(null);
    setTxHash(null);
    setExplain(null);
    setElapsed(0);

    const res = await fetch("/api/request", { method: "POST", body: JSON.stringify({ id: who }) });
    const body = await res.json();
    if (!res.ok) {
      setPhase("error");
      setError(body.error ?? "request failed");
      return;
    }
    await finish(body.account as string, body.requestedAtMs as number, (body.txHash as string | null) ?? null);
  }

  const walletButtonLabel = !accountId
    ? "Connect wallet to prove"
    : busy && mode === "wallet"
      ? phase === "sending"
        ? "Confirm in wallet…"
        : `Checking in sealed enclave… ${elapsed}s`
      : "Prove my funds with this wallet";

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-6">
      <section>
        <p className="kicker">Clean funds · NIXO certificate</p>
        <h1 className="display mt-3 text-[clamp(1.3rem,2.6vw,1.9rem)] leading-snug">Prove your money is clean without proving where it&apos;s been.</h1>
        <p className="mt-3 text-muted">
          A sealed Intel TDX enclave screens history against sanctions and hacker lists and outputs only a verdict. NEAR records it as a 7-day certificate
          any exchange can check with one call.
        </p>
      </section>

      <section id="wallet" className="scroll-mt-24 rounded-xl border border-accent/40 bg-surface p-5">
        <div className="text-sm font-medium">Your wallet</div>
        <p className="mt-1 text-sm text-muted">
          This opens your NEAR wallet to sign <span className="font-mono">request_nixo</span> on {NIXO_CONTRACT} (~{NIXO_REQUEST_DEPOSIT_NEAR} NEAR deposit for
          the TEE run).
        </p>
        {accountId ? (
          <p className="mt-3 font-mono text-sm text-accent-2">{accountId}</p>
        ) : (
          <p className="mt-3 text-sm text-muted">No wallet connected yet.</p>
        )}
        <p className="mt-3 text-xs text-muted">
          <MockTag>MVP</MockTag> The enclave only has fixture histories for Alice and Mallory. A random wallet usually can&apos;t be
          processed (lack of history) — that still proves the real sign → TEE → certificate path.
        </p>
        <button onClick={runWallet} disabled={busy} className="mt-4 w-full rounded-lg bg-accent px-4 py-3 font-medium text-accent-ink disabled:opacity-50">
          {walletButtonLabel}
        </button>
        {mode === "wallet" && txHash && (
          <a className="mt-2 block text-xs text-muted underline" href={`${EXPLORER}/txns/${txHash}`} target="_blank" rel="noreferrer">
            transaction {txHash.slice(0, 10)}…
          </a>
        )}
        {mode === "wallet" && error && <p className="mt-3 text-sm text-reject">{error}</p>}
      </section>

      <section id="demo" className="scroll-mt-24 rounded-xl border border-border bg-surface p-5">
        <div className="text-sm font-medium">Judge demo (no wallet)</div>
        <p className="mt-1 text-sm text-muted">Server-signs as a pre-seeded account so judges can get a Clean or Rejected certificate without connecting.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {DEMO_ACCOUNTS.map((a) => (
            <button
              key={a.id}
              onClick={() => setWho(a.id)}
              disabled={busy}
              className={`rounded-lg border p-3 text-left ${who === a.id ? "border-accent ring-1 ring-accent" : "border-border"}`}
            >
              <div className="font-mono text-sm">{a.label}</div>
              <div className="text-xs text-muted">{a.note}</div>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          <MockTag>simulated</MockTag> History for these two accounts is compiled into the checker WASM, not a live 1Click read.
        </p>
        <button
          onClick={runDemo}
          disabled={busy}
          className="mt-4 w-full rounded-lg border border-border bg-background px-4 py-3 font-medium disabled:opacity-50 hover:border-accent"
        >
          {busy && mode === "demo"
            ? phase === "sending"
              ? "Sending request…"
              : `Checking in sealed enclave… ${elapsed}s`
            : `Run demo as ${who === "alice" ? "Alice" : "Mallory"}`}
        </button>
        {mode === "demo" && txHash && (
          <a className="mt-2 block text-xs text-muted underline" href={`${EXPLORER}/txns/${txHash}`} target="_blank" rel="noreferrer">
            transaction {txHash.slice(0, 10)}…
          </a>
        )}
        {mode === "demo" && error && <p className="mt-3 text-sm text-reject">{error}</p>}
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
                Nothing retained server-side after this response.
              </p>
            )}
          </div>
          {explain?.checks && explain.model && explain.nonce && (
            <NearAiVerifiedPanel
              model={explain.model}
              nonce={explain.nonce}
              verified={Boolean(explain.attestation?.nonce_echoed)}
              checks={explain.checks}
              completionId={explain.completion_id}
            />
          )}
          <Link href={`/verify?account=${view.certificate.account}`} className="inline-block text-sm underline">
            Verify as an exchange →
          </Link>
          <Link href="/private-ai" className="ml-4 inline-block text-sm underline">
            Private AI samples →
          </Link>
        </section>
      )}
    </div>
  );
}
