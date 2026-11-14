"use client";

import type { AttestationCheck } from "@/lib/nearai";

function Status({ s }: { s: AttestationCheck["status"] }) {
  const cls =
    s === "pass" ? "text-clean" : s === "fail" ? "text-reject" : "text-muted";
  const mark = s === "pass" ? "✔" : s === "fail" ? "✗" : "–";
  return (
    <span className={`font-mono text-xs uppercase ${cls}`}>
      {mark} {s}
    </span>
  );
}

export function NearAiVerifiedPanel({
  model,
  nonce,
  verified,
  checks,
  completionId,
}: {
  model: string;
  nonce: string;
  verified: boolean;
  checks: AttestationCheck[];
  completionId?: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Verified panel — NEAR AI Cloud</h2>
        <span className={`font-mono text-xs ${verified ? "text-clean" : "text-reject"}`}>
          {verified ? "verified (gateway checks)" : "not verified"}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted">
        Fresh-nonce attestation for TEE-hosted model <code className="font-mono text-xs">{model}</code>.
        Prompt and completion are not stored after this response.
      </p>
      <ul className="mt-4 space-y-3">
        {checks.map((c) => (
          <li key={c.id} className="grid grid-cols-1 gap-1 border-t border-border pt-3 sm:grid-cols-[7rem_1fr]">
            <Status s={c.status} />
            <div className="min-w-0 text-sm">
              <div>{c.label}</div>
              {c.detail && <div className="mt-0.5 text-xs text-muted">{c.detail}</div>}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 space-y-1 border-t border-border pt-3 font-mono text-[11px] text-muted">
        <div>nonce {nonce.slice(0, 16)}…{nonce.slice(-8)}</div>
        {completionId && <div>completion_id {completionId}</div>}
        <div>
          full DCAP/NRAS:{" "}
          <code>NEARAI_API_KEY=… python3.12 scripts/nearai_smoke.py</code>
        </div>
      </div>
    </section>
  );
}
