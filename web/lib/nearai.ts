/**
 * NEAR AI Cloud helpers for the Privacy track.
 *
 * Ephemeral by design: callers must not persist prompts, completions, or
 * attestation blobs after the HTTP response is sent. Full Intel TDX / GPU
 * quote verification (DCAP + NRAS) is done by `scripts/nearai_smoke.py`
 * (nearai-inference-sdk). The web path fetches a fresh-nonce report, checks
 * binding fields the gateway returns, and lists every check in the Verified panel.
 */

export const NEARAI_BASE = process.env.NEARAI_BASE_URL ?? "https://cloud-api.near.ai/v1";

/** Prefer an attested / nearai-owned model; overridable via env. */
export const NEARAI_MODEL = process.env.NEARAI_MODEL ?? "deepseek-ai/DeepSeek-V3.1";

export type AttestationCheck = {
  id: string;
  label: string;
  status: "pass" | "fail" | "skip";
  detail?: string;
};

export function freshNonce(): string {
  // 64 hex chars — matches the smoke script / verification docs binding size.
  const a = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function authHeaders(apiKey: string): HeadersInit {
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "x-no-aliasing": "true",
  };
}

/** Walk a JSON value for a hex nonce echo (report_data / client binding). */
export function nonceAppearsIn(report: unknown, nonce: string): boolean {
  if (!nonce) return false;
  return JSON.stringify(report ?? {}).toLowerCase().includes(nonce.toLowerCase());
}

export function summarizeAttestation(report: unknown, nonce: string): AttestationCheck[] {
  const checks: AttestationCheck[] = [];
  const obj = (report && typeof report === "object" ? report : {}) as Record<string, unknown>;
  const err = typeof obj.error === "string" ? obj.error : null;

  checks.push({
    id: "report_fetched",
    label: "Attestation report fetched with fresh client nonce",
    status: err ? "fail" : "pass",
    detail: err ?? `nonce=${nonce.slice(0, 12)}…`,
  });

  const echoed = !err && nonceAppearsIn(report, nonce);
  checks.push({
    id: "nonce_bound",
    label: "Fresh nonce echoed in attestation report (client binding)",
    status: err ? "skip" : echoed ? "pass" : "fail",
    detail: echoed ? "nonce present in report JSON" : "nonce not found in report",
  });

  const blob = JSON.stringify(report ?? {}).toLowerCase();
  const hasQuote = /quote|tdx|dcap|mrtd|rtmr/.test(blob);
  checks.push({
    id: "tee_fields",
    label: "TEE evidence fields present (TDX / quote / measurements)",
    status: err ? "skip" : hasQuote ? "pass" : "fail",
    detail: hasQuote ? "quote/measurement keys observed" : "no TDX/quote fields in report body",
  });

  const hasSigner = /signing_address|signer|public_key|signing_algo/.test(blob);
  checks.push({
    id: "signer",
    label: "Signing identity present on report",
    status: err ? "skip" : hasSigner ? "pass" : "fail",
  });

  checks.push({
    id: "full_dcap",
    label: "Full DCAP + GPU (NRAS) quote verify",
    status: "skip",
    detail: "Run scripts/nearai_smoke.py with nearai-inference-sdk for end-to-end DCAP/NRAS",
  });

  return checks;
}

export async function fetchAttestationReport(opts: {
  apiKey: string;
  model: string;
  nonce: string;
}): Promise<unknown> {
  const url = `${NEARAI_BASE}/attestation/report?model=${encodeURIComponent(opts.model)}&nonce=${opts.nonce}`;
  const res = await fetch(url, { headers: authHeaders(opts.apiKey), cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { error: `HTTP ${res.status}`, body: body.slice(0, 200) };
  }
  return res.json();
}

export async function chatCompletion(opts: {
  apiKey: string;
  model: string;
  messages: { role: string; content: string }[];
  max_tokens?: number;
}): Promise<{ ok: true; id: string; text: string; raw: unknown } | { ok: false; error: string; raw?: unknown }> {
  const res = await fetch(`${NEARAI_BASE}/chat/completions`, {
    method: "POST",
    headers: authHeaders(opts.apiKey),
    cache: "no-store",
    body: JSON.stringify({
      model: opts.model,
      temperature: 0,
      max_tokens: opts.max_tokens ?? 320,
      stream: false,
      messages: opts.messages,
    }),
  });
  const raw = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, error: `chat HTTP ${res.status}`, raw };
  }
  const text = raw?.choices?.[0]?.message?.content;
  const id = raw?.id;
  if (!text || !id) return { ok: false, error: "empty completion", raw };
  return { ok: true, id, text, raw };
}
