/**
 * Fail-closed solver gate for NIXO (PRD Layer 3).
 *
 * Solvers and routers call `checkIntent` before fill. Only a currently valid
 * Clean certificate allows; missing / expired / warn / rejected / RPC failure
 * all refuse. Never treats "certificate not found" as clean.
 */
import { getCertificate, type CertificateView } from "./nixo-sdk";

export type GateRefuseCode =
  | "not_clean"
  | "missing"
  | "expired"
  | "warn"
  | "rejected"
  | "rpc_error"
  | "invalid";

export type GateDecision =
  | { ok: true }
  | { ok: false; reason: string; code: GateRefuseCode };

export type CheckIntentInput = {
  origin: string;
  /** Optional; when set, must also pass the same clean gate. */
  destination?: string;
};

/** Injected in unit tests; defaults to on-chain `get_certificate`. */
export type CertificateLookup = (account: string) => Promise<CertificateView | null>;

function refuse(code: GateRefuseCode, reason: string): GateDecision {
  return { ok: false, code, reason };
}

/** Evaluate one account's certificate. Fail-closed on any lookup error. */
export async function checkAccount(
  account: string,
  lookup: CertificateLookup = getCertificate,
): Promise<GateDecision> {
  const id = account.trim().toLowerCase();
  if (!id) return refuse("invalid", "account required");

  let view: CertificateView | null;
  try {
    view = await lookup(id);
  } catch (e) {
    return refuse("rpc_error", e instanceof Error ? e.message : String(e));
  }

  if (view == null) {
    return refuse("missing", "certificate not found");
  }

  if (!view.valid) {
    return refuse("expired", view.certificate.reason ?? "certificate expired or revoked");
  }

  const verdict = view.certificate.verdict;
  if (verdict === "warn") {
    return refuse("warn", view.certificate.reason ?? "certificate is warn");
  }
  if (verdict === "rejected") {
    return refuse("rejected", view.certificate.reason ?? "certificate rejected");
  }
  if (verdict !== "clean") {
    return refuse("not_clean", `unexpected verdict: ${verdict}`);
  }

  return { ok: true };
}

/**
 * Single fail-closed return: allow or refuse with a reason.
 * Origin is required; destination is checked the same way when provided.
 */
export async function checkIntent(
  input: CheckIntentInput,
  lookup: CertificateLookup = getCertificate,
): Promise<GateDecision> {
  const origin = input.origin?.trim() ?? "";
  if (!origin) return refuse("invalid", "origin required");

  const originDecision = await checkAccount(origin, lookup);
  if (!originDecision.ok) return originDecision;

  if (input.destination !== undefined) {
    const destination = input.destination.trim();
    if (!destination) return refuse("invalid", "destination empty");
    const destDecision = await checkAccount(destination, lookup);
    if (!destDecision.ok) return destDecision;
  }

  return { ok: true };
}
