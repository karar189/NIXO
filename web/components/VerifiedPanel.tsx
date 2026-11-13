"use client";
import { useEffect, useState } from "react";
import type { CertificateView, Config } from "@/lib/nixo-sdk";
import { getConfig, isRevoked, nsToDate } from "@/lib/nixo-sdk";
import { EXPLORER, KANI_RUN_URL, LISTS_URL, NIXO_CONTRACT, OUTLAYER_APP, REPO_URL } from "@/lib/config";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-t border-border py-3 sm:grid-cols-[160px_1fr]">
      <div className="text-sm text-muted">{label}</div>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

const Hash = ({ v }: { v: string }) => <code className="break-all font-mono text-xs">{v}</code>;

export function VerifiedPanel({ view, txHash }: { view: CertificateView; txHash?: string }) {
  const c = view.certificate;
  const [config, setConfig] = useState<Config | null>(null);
  const [revoked, setRevoked] = useState<boolean | null>(null);

  useEffect(() => {
    getConfig().then(setConfig).catch(() => setConfig(null));
    isRevoked(c.checker_hash).then(setRevoked).catch(() => setRevoked(null));
  }, [c.checker_hash]);

  const pinned = config?.checker.hash === c.checker_hash;

  return (
    <details className="rounded-xl border border-border bg-surface p-5" open>
      <summary className="cursor-pointer font-medium">Verified panel: why you can trust this verdict</summary>
      <div className="mt-3">
        <Row label="Checker WASM hash">
          <Hash v={c.checker_hash} />
          <div className="mt-1 text-xs text-muted">
            {config == null ? "checking…" : pinned ? "✔ matches the hash currently pinned on-chain" : "⚠ differs from the currently pinned hash (checker was upgraded)"}
            {revoked === true && <span className="text-reject"> · revoked</span>}
            {" · "}
            <a className="underline" href={`${REPO_URL}/tree/main/checker`} target="_blank" rel="noreferrer">
              source
            </a>{" "}
            (rebuild with <code className="font-mono">cargo build --release --target wasm32-wasip2</code> and compare)
          </div>
        </Row>
        <Row label="TEE execution">
          Run by OutLayer on an Intel TDX worker, which returned the verdict to the contract via yield/resume.{" "}
          {txHash ? (
            <a className="underline" href={`${EXPLORER}/txns/${txHash}`} target="_blank" rel="noreferrer">
              request transaction
            </a>
          ) : (
            <a className="underline" href={`${EXPLORER}/address/${NIXO_CONTRACT}`} target="_blank" rel="noreferrer">
              contract activity
            </a>
          )}
          {" · "}
          <a className="underline" href={`${OUTLAYER_APP}/executions`} target="_blank" rel="noreferrer">
            OutLayer attestations
          </a>
        </Row>
        <Row label="Screening lists">
          <a className="underline" href={`${LISTS_URL}${c.list_snapshot}`} target="_blank" rel="noreferrer">
            OFAC · EU · UK · UN · SECO @ {c.list_snapshot}
          </a>{" "}
          + NIXO hacker list
          <div className="mt-1">
            list hash <Hash v={c.list_hash} />
          </div>
        </Row>
        <Row label="Formal proof (Kani)">
          <code className="font-mono text-xs">tainted_is_never_clean</code>, <code className="font-mono text-xs">empty_list_is_never_clean</code>,{" "}
          <code className="font-mono text-xs">disjoint_is_clean</code> ·{" "}
          <a className="underline" href={KANI_RUN_URL} target="_blank" rel="noreferrer">
            CI run
          </a>
        </Row>
        <Row label="Input hash">
          <Hash v={c.input_hash} />
          <div className="mt-1 text-xs text-muted">
            Re-run locally: <code className="font-mono">{`echo -n '{"account":"${c.account}"}' | wasmtime nixo_checker.wasm`}</code>
          </div>
        </Row>
        <Row label="Governance">
          {config ? (
            <>
              Checker changes are timelocked {Number(BigInt(config.timelock_ns) / 3_600_000_000_000n)}h; certificates last{" "}
              {Number(BigInt(config.cert_ttl_ns) / 86_400_000_000_000n)} days.
              {config.pending && (
                <div className="mt-1 text-mock">
                  Pending checker <Hash v={config.pending.checker.hash} /> activates {nsToDate(config.pending.activates_at_ns).toLocaleString()}
                </div>
              )}
            </>
          ) : (
            "…"
          )}
        </Row>
      </div>
    </details>
  );
}
