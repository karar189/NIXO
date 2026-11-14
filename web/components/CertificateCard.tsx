import type { CertificateView } from "@/lib/nixo-sdk";
import { nsToDate } from "@/lib/nixo-sdk";
import { MockTag } from "./MockTag";

export function CertificateCard({ view }: { view: CertificateView }) {
  const c = view.certificate;
  const clean = c.verdict === "clean" && view.valid;
  return (
    <div className={`rounded-xl border border-border p-5 ${clean ? "bg-clean-bg" : "bg-reject-bg"}`}>
      <div className={`text-2xl font-semibold ${clean ? "text-clean" : "text-reject"}`}>
        {clean ? "✅ Clean" : c.verdict === "clean" ? "⚠️ Clean but no longer valid" : "❌ Rejected"}
      </div>
      {c.reason && (
        <div className="mt-1 text-sm">
          Reason: <code className="font-mono">{c.reason}</code>{" "}
          <span className="text-muted">(no address or amount is revealed)</span>
        </div>
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
        <dt className="text-muted">History</dt>
        <dd>
          {c.history_source} {c.history_source === "fixture" && <MockTag>simulated in MVP</MockTag>}
        </dd>
      </dl>
    </div>
  );
}
