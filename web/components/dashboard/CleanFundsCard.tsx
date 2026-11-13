"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { getCertificate, nsToDate, type CertificateView } from "@/lib/nixo-sdk";
import { NIXO_CONTRACT } from "@/lib/config";
import { Card } from "./Card";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "done"; view: CertificateView | null };

/** The connected account's NIXO certificate, read live from the contract. */
export function CleanFundsCard() {
  const { accountId, network } = useWallet();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!accountId || network !== "testnet") return;
    let live = true;
    getCertificate(accountId)
      .then((view) => live && setState({ status: "done", view }))
      .catch((e) => live && setState({ status: "error", message: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [accountId, network]);

  const cert = state.status === "done" ? state.view : null;
  const clean = !!cert?.valid && cert.certificate.verdict === "clean";
  const tone = !cert ? "text-muted" : clean ? "text-clean" : cert.certificate.verdict === "warn" ? "text-warn" : "text-reject";
  const label = !cert ? "No certificate" : !cert.valid ? "Expired" : clean ? "Clean" : cert.certificate.verdict === "warn" ? "Warn" : "Rejected";

  return (
    <Card title="Clean funds" action={<ShieldCheck className="size-4 text-accent" strokeWidth={1.6} />} className="relative overflow-hidden">
      <div className="hatch pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
      <div className="relative">
        {network !== "testnet" ? (
          <p className="text-sm text-muted">Certificates live on NEAR testnet ({NIXO_CONTRACT}). Switch the network in Settings to see yours.</p>
        ) : state.status === "loading" ? (
          <p className="text-sm text-muted">Reading {NIXO_CONTRACT}…</p>
        ) : state.status === "error" ? (
          <p className="text-sm text-danger">{state.message}</p>
        ) : (
          <>
            <p className={`display text-2xl ${tone}`}>{label}</p>
            {cert ? (
              <p className="mt-2 text-sm text-muted">
                {cert.certificate.reason ? `Reason: ${cert.certificate.reason}. ` : ""}
                {cert.valid ? "Valid until" : "Expired"} {nsToDate(cert.certificate.expires_at_ns).toLocaleString()}.
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted">Prove your funds once and any exchange can check them with one call.</p>
            )}
            <div className="mt-4 border border-line bg-background/70 px-3 py-2 font-mono text-[11px] text-accent-2">
              is_clean(&quot;{accountId}&quot;) → <span className={clean ? "text-clean" : "text-reject"}>{String(clean)}</span>
            </div>
            <Link href="/dashboard/clean-funds" className="mt-4 inline-flex items-center gap-1.5 text-[11px] tracking-[0.14em] text-accent uppercase hover:text-foreground">
              {cert ? "Re-check" : "Prove my funds"} <ArrowUpRight className="size-3.5" />
            </Link>
          </>
        )}
      </div>
    </Card>
  );
}
