"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { getCertificate, nsToDate, type CertificateView } from "@/lib/nixo-sdk";
import { nixoContract } from "@/lib/config";
import { Card } from "./Card";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "done"; view: CertificateView | null };

/** The connected account's NIXO certificate, read live from the contract. */
export function CleanFundsCard() {
  const { accountId, network } = useWallet();
  const contract = nixoContract(network);
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!accountId) return;
    let live = true;
    setState({ status: "loading" });
    getCertificate(accountId, network)
      .then((view) => live && setState({ status: "done", view }))
      .catch((e) => live && setState({ status: "error", message: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [accountId, network]);
  const cert = state.status === "done" ? state.view : null;
  const clean = !!cert?.valid && cert.certificate.verdict === "clean";
  const inconclusive =
    !!cert &&
    !clean &&
    !!cert.certificate.reason &&
    ["history_unavailable", "history_incomplete", "malformed_input", "list_unavailable"].includes(cert.certificate.reason);
  const tone = !cert
    ? "text-muted"
    : clean
      ? "text-clean"
      : inconclusive || cert.certificate.verdict === "warn"
        ? "text-warn"
        : "text-reject";
  const label = !cert
    ? "No certificate"
    : !cert.valid
      ? "Expired"
      : clean
        ? "Clean"
        : inconclusive
          ? "Can't process"
          : cert.certificate.verdict === "warn"
            ? "Warn"
            : "Rejected";

  return (
    <Card title="Clean funds" action={<ShieldCheck className="size-4 text-accent" strokeWidth={1.6} />} className="relative overflow-hidden">
      <div className="hatch pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
      <div className="relative">
        {state.status === "loading" ? (
          <p className="text-sm text-muted">Reading {contract}…</p>
        ) : state.status === "error" ? (
          <p className="text-sm text-danger">{state.message}</p>
        ) : (
          <>
            <p className={`display text-2xl ${tone}`}>{label}</p>
            {cert ? (
              <p className="mt-2 text-sm text-muted">
                {inconclusive
                  ? "Not enough history to screen this account. "
                  : cert.certificate.reason
                    ? `Reason: ${cert.certificate.reason}. `
                    : ""}
                {cert.valid ? "Valid until" : "Expired"} {nsToDate(cert.certificate.expires_at_ns).toLocaleString()}.
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted">
                Status for <span className="font-mono text-accent-2">{accountId}</span>. Prove with your wallet, or try the Alice/Mallory demo.
              </p>
            )}
            <div className="mt-4 border border-line bg-background/70 px-3 py-2 font-mono text-[11px] text-accent-2">
              is_clean(&quot;{accountId}&quot;) → <span className={clean ? "text-clean" : "text-reject"}>{String(clean)}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Link
                href="/dashboard/privacy#wallet"
                className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.14em] text-accent uppercase hover:text-foreground"
              >
                {cert ? "Re-check with wallet" : "Prove with my wallet"} <ArrowUpRight className="size-3.5" />
              </Link>
              <Link
                href="/dashboard/privacy#demo"
                className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.14em] text-muted uppercase hover:text-foreground"
              >
                Try Alice / Mallory demo <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
