import type { CertificateView } from "@/lib/nixo-sdk";
import { nsToDate } from "@/lib/nixo-sdk";

/** Reasons that mean "we couldn't check", not "funds look dirty". */
const INCONCLUSIVE = new Set(["history_unavailable", "history_incomplete", "malformed_input", "list_unavailable"]);

const INCONCLUSIVE_COPY: Record<string, string> = {
  history_unavailable: "Can't be processed — no history was available for this account.",
  history_incomplete: "Can't be processed — part of the money trail could not be loaded.",
  malformed_input: "Can't be processed — the history payload could not be read.",
  list_unavailable: "Can't be processed — screening lists failed to load.",
};

export function CertificateCard({ view }: { view: CertificateView }) {
  const c = view.certificate;
  const clean = c.verdict === "clean" && view.valid;
  const inconclusive = !clean && !!c.reason && INCONCLUSIVE.has(c.reason);
  const tone = clean ? "clean" : inconclusive ? "warn" : "reject";

  const title = clean
    ? "✅ Clean"
    : c.verdict === "clean"
      ? "⚠️ Clean but no longer valid"
      : inconclusive
        ? "⚠️ Can't be processed"
        : "❌ Rejected";

  return (
    <div
      className={`rounded-xl border border-border p-5 ${
        tone === "clean" ? "bg-clean-bg" : tone === "warn" ? "bg-warn-bg" : "bg-reject-bg"
      }`}
    >
      <div className={`text-2xl font-semibold ${tone === "clean" ? "text-clean" : tone === "warn" ? "text-warn" : "text-reject"}`}>
        {title}
      </div>
      {inconclusive && c.reason ? (
        <div className="mt-1 text-sm text-muted">{INCONCLUSIVE_COPY[c.reason] ?? "Can't be processed due to lack of information."}</div>
      ) : c.reason ? (
        <div className="mt-1 text-sm">
          Reason: <code className="font-mono">{c.reason}</code>{" "}
          <span className="text-muted">(no address or amount is revealed)</span>
        </div>
      ) : null}
      {inconclusive && (
        <p className="mt-2 text-xs text-muted">
          This is not a finding that funds are tainted — NIXO fails closed when it lacks enough information. In the MVP, only Alice/Mallory have fixture
          histories inside the enclave.
        </p>
      )}
      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Account</dt>
        <dd className="font-mono">{c.account}</dd>
        <dt className="text-muted">Issued</dt>
        <dd>{nsToDate(c.issued_at_ns).toLocaleString()}</dd>
        <dt className="text-muted">Expires</dt>
        <dd>{nsToDate(c.expires_at_ns).toLocaleString()}</dd>
        <dt className="text-muted">Lists</dt>
        <dd className="font-mono">{c.list_snapshot}</dd>
        <dt className="text-muted">Trace depth</dt>
        <dd>{c.trace_depth} hop</dd>
        {c.reason && (
          <>
            <dt className="text-muted">Code</dt>
            <dd className="font-mono text-xs">{c.reason}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
