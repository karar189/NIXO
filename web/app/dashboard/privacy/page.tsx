"use client";

import { useCallback, useState } from "react";
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
import { mockSolve, type MockFillResult } from "@/lib/solver/mock-solver";
import type { AttestationCheck } from "@/lib/nearai";

type Phase = "idle" | "sending" | "waiting" | "done" | "error";
type SampleId = "alice" | "mallory" | "expense";

const POLL_MS = 2000;
const TIMEOUT_MS = 240_000;

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

type ExplainState = {
  text?: string;
  error?: string;
  model?: string;
  nonce?: string;
  completion_id?: string;
  checks?: AttestationCheck[];
  attestation?: { fetched: boolean; nonce_echoed: boolean };
};

type PrivateAiResult = {
  text: string;
  model: string;
  nonce: string;
  verified: boolean;
  checks: AttestationCheck[];
  completion_id: string;
  ephemeral: boolean;
  error?: string;
};

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
  const last = outcomes[outcomes.length - 1] as
    | { transaction_outcome?: { id?: string }; transaction?: { hash?: string } }
    | undefined;
  return last?.transaction_outcome?.id ?? last?.transaction?.hash ?? null;
}

export default function PrivacyPage() {
  const { accountId, network, ready, connect, signAndSend } = useWallet();

  const [who, setWho] = useState<DemoId>("alice");
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<"wallet" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [view, setView] = useState<CertificateView | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [explain, setExplain] = useState<ExplainState | null>(null);

  const [sample, setSample] = useState<SampleId>("alice");
  const [paiBusy, setPaiBusy] = useState(false);
  const [paiResult, setPaiResult] = useState<PrivateAiResult | null>(null);
  const [paiError, setPaiError] = useState<string | null>(null);

  const [solverWho, setSolverWho] = useState<DemoId>("alice");
  const [solverBusy, setSolverBusy] = useState(false);
  const [solverResult, setSolverResult] = useState<MockFillResult | null>(null);
  const [solverError, setSolverError] = useState<string | null>(null);

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

  async function runMockSolver() {
    const account = DEMO_ACCOUNTS.find((a) => a.id === solverWho)!;
    setSolverBusy(true);
    setSolverError(null);
    setSolverResult(null);
    try {
      const r = await mockSolve({
        origin: account.label,
        assetIn: "NEAR",
        assetOut: "USDC",
        amount: "1",
      });
      setSolverResult(r);
    } catch (e) {
      setSolverError(e instanceof Error ? e.message : String(e));
    } finally {
      setSolverBusy(false);
    }
  }

  const runPrivateAi = useCallback(async () => {
    setPaiBusy(true);
    setPaiError(null);
    setPaiResult(null);
    try {
      const res = await fetch("/api/private-ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ sample }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPaiError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setPaiResult(data as PrivateAiResult);
    } catch (e) {
      setPaiError(e instanceof Error ? e.message : String(e));
    } finally {
      setPaiBusy(false);
    }
  }, [sample]);

  const walletButtonLabel = !accountId
    ? "Connect wallet to prove"
    : busy && mode === "wallet"
      ? phase === "sending"
        ? "Confirm in wallet…"
        : `Checking in sealed enclave… ${elapsed}s`
      : "Prove my funds with this wallet";

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-8 sm:px-6">
      <header>
        <p className="kicker">Privacy · certificate · Private AI · solver gate</p>
        <h1 className="display mt-3 text-[clamp(1.3rem,2.6vw,1.9rem)] leading-snug">Privacy</h1>
        <p className="mt-3 text-muted">
          Clean-funds certificates, TEE compliance notes on NEAR AI Cloud, and a fail-closed mock solver that only fills
          when <span className="font-mono text-xs">is_clean</span> is true — without retaining prompts or history on our
          servers.
        </p>
      </header>

      {/* —— Clean funds —— */}
      <div id="clean-funds" className="scroll-mt-24 space-y-8">
        <section>
          <p className="kicker">Clean funds · NIXO certificate</p>
          <h2 className="display mt-3 text-xl leading-snug sm:text-2xl">
            Prove your money is clean without proving where it&apos;s been.
          </h2>
          <p className="mt-3 text-muted">
            A sealed Intel TDX enclave screens history against sanctions and hacker lists and outputs only a verdict.
            NEAR records it as a 7-day certificate any exchange can check with one call.
          </p>
        </section>

        <section id="wallet" className="scroll-mt-24 rounded-xl border border-accent/40 bg-surface p-5">
          <div className="text-sm font-medium">Your wallet</div>
          <p className="mt-1 text-sm text-muted">
            This opens your NEAR wallet to sign <span className="font-mono">request_nixo</span> on {NIXO_CONTRACT} (~
            {NIXO_REQUEST_DEPOSIT_NEAR} NEAR deposit for the TEE run).
          </p>
          {accountId ? (
            <p className="mt-3 font-mono text-sm text-accent-2">{accountId}</p>
          ) : (
            <p className="mt-3 text-sm text-muted">No wallet connected yet.</p>
          )}
          <p className="mt-3 text-xs text-muted">
            <MockTag>MVP</MockTag> The enclave only has fixture histories for Alice and Mallory. A random wallet usually
            can&apos;t be processed (lack of history) — that still proves the real sign → TEE → certificate path.
          </p>
          <button
            type="button"
            onClick={runWallet}
            disabled={busy}
            className="mt-4 w-full rounded-lg bg-accent px-4 py-3 font-medium text-accent-ink disabled:opacity-50"
          >
            {walletButtonLabel}
          </button>
          {mode === "wallet" && txHash && (
            <a
              className="mt-2 block text-xs text-muted underline"
              href={`${EXPLORER}/txns/${txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              transaction {txHash.slice(0, 10)}…
            </a>
          )}
          {mode === "wallet" && error && <p className="mt-3 text-sm text-reject">{error}</p>}
        </section>

        <section id="demo" className="scroll-mt-24 rounded-xl border border-border bg-surface p-5">
          <div className="text-sm font-medium">Judge demo (no wallet)</div>
          <p className="mt-1 text-sm text-muted">
            Server-signs as a pre-seeded account so judges can get a Clean or Rejected certificate without connecting.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.id}
                type="button"
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
            <MockTag>simulated</MockTag> History for these two accounts is compiled into the checker WASM, not a live
            1Click read.
          </p>
          <button
            type="button"
            onClick={runDemo}
            disabled={busy}
            className="mt-4 w-full rounded-lg border border-border bg-background px-4 py-3 font-medium hover:border-accent disabled:opacity-50"
          >
            {busy && mode === "demo"
              ? phase === "sending"
                ? "Sending request…"
                : `Checking in sealed enclave… ${elapsed}s`
              : `Run demo as ${who === "alice" ? "Alice" : "Mallory"}`}
          </button>
          {mode === "demo" && txHash && (
            <a
              className="mt-2 block text-xs text-muted underline"
              href={`${EXPLORER}/txns/${txHash}`}
              target="_blank"
              rel="noreferrer"
            >
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
                  Model saw only the public certificate. Attestation{" "}
                  {explain.attestation.fetched ? "fetched" : "unavailable"}
                  {explain.attestation.fetched &&
                    (explain.attestation.nonce_echoed ? ", bound to a fresh nonce" : ", nonce not found in report")}
                  . Nothing retained server-side after this response.
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
            <a href="#private-ai" className="ml-4 inline-block text-sm underline">
              Private AI samples →
            </a>
          </section>
        )}
      </div>

      {/* —— Private AI —— */}
      <div id="private-ai" className="scroll-mt-24 space-y-6 border-t border-border pt-10">
        <header className="space-y-3">
          <p className="kicker">Private AI · NEAR AI Cloud</p>
          <h2 className="display text-xl leading-snug sm:text-2xl">Private compliance note</h2>
          <p className="max-w-2xl text-muted">
            Pick a fictional sample. A TEE-hosted model on{" "}
            <code className="font-mono text-xs">cloud-api.near.ai</code> categorizes / explains it. We fetch an
            attestation report with a fresh random nonce and show what was checked. Nothing is kept server-side after
            the response.
          </p>
        </header>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-muted">Sample documents (no real data)</h3>
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
            onClick={runPrivateAi}
            disabled={paiBusy}
            className="mt-2 w-full rounded-lg bg-accent px-4 py-3 font-medium text-accent-ink disabled:opacity-50 sm:w-auto"
          >
            {paiBusy ? "Running in TEE…" : "Analyze in NEAR AI Cloud"}
          </button>
          {paiError && <p className="text-sm text-reject">{paiError}</p>}
        </section>

        {paiResult && (
          <section className="space-y-4">
            <div className="rounded-xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">Model note</h3>
                {paiResult.ephemeral && (
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                    ephemeral · no retention
                  </span>
                )}
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{paiResult.text}</p>
            </div>
            <NearAiVerifiedPanel
              model={paiResult.model}
              nonce={paiResult.nonce}
              verified={paiResult.verified}
              checks={paiResult.checks}
              completionId={paiResult.completion_id}
            />
          </section>
        )}

        <p className="border-t border-border pt-6 text-sm text-muted">
          Full Intel TDX + GPU verification: <code className="font-mono text-xs">scripts/nearai_smoke.py</code>. Checker
          TEE (OutLayer) is separate — see{" "}
          <Link className="underline" href="/verify">
            Exchange view
          </Link>
          .
        </p>
      </div>

      {/* —— Mock solver —— */}
      <div id="solver" className="scroll-mt-24 space-y-6 border-t border-border pt-10">
        <header className="space-y-2">
          <p className="kicker">Layer 3 · mock solver</p>
          <h2 className="display text-xl leading-snug sm:text-2xl">Mock solver</h2>
          <p className="text-sm text-muted">
            Fail-closed gate before fill: only a currently valid Clean certificate is allowed. Missing, expired, warn,
            rejected, and RPC failures all refuse.
          </p>
          <p>
            <MockTag>mock solver · not a live Intents network</MockTag>
          </p>
        </header>

        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="text-sm font-medium">Paper intent</div>
          <p className="mt-1 text-xs text-muted">Origin account · 1 NEAR → USDC (no settlement, no 1Click).</p>

          <div className="mt-4 flex flex-wrap gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setSolverWho(a.id);
                  setSolverResult(null);
                  setSolverError(null);
                }}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  solverWho === a.id
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
            onClick={runMockSolver}
            disabled={solverBusy}
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity disabled:opacity-50"
          >
            {solverBusy
              ? "Checking certificate…"
              : `Run mock fill as ${solverWho === "alice" ? "Alice" : "Mallory"}`}
          </button>

          {solverError && <p className="mt-3 text-sm text-reject">{solverError}</p>}

          {solverResult?.status === "filled" && (
            <div className="mt-4 rounded-lg border border-clean/40 bg-clean/5 p-4 text-sm">
              <p className="font-medium text-clean">Filled (mock)</p>
              <p className="mt-1 font-mono text-xs text-muted">
                {solverResult.origin} · {solverResult.amount ?? "?"} {solverResult.assetIn ?? "?"} →{" "}
                {solverResult.assetOut ?? "?"}
              </p>
              <p className="mt-2 text-xs text-muted">at {solverResult.filledAt}</p>
            </div>
          )}

          {solverResult?.status === "refused" && (
            <div className="mt-4 rounded-lg border border-reject/40 bg-reject/5 p-4 text-sm">
              <p className="font-medium text-reject">Refused</p>
              <p className="mt-1 font-mono text-xs">
                {solverResult.decision.code}: {solverResult.decision.reason}
              </p>
              <p className="mt-2 text-xs text-muted">
                origin {solverResult.origin} · {solverResult.refusedAt}
              </p>
            </div>
          )}
        </section>

        <p className="text-xs text-muted">
          CLI: <code className="font-mono">pnpm demo:solver</code> · unit tests:{" "}
          <code className="font-mono">pnpm test:solver</code>
        </p>
      </div>
    </div>
  );
}
