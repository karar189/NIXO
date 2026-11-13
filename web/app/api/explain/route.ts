// Explainer: turns the PUBLIC on-chain certificate into a plain-English note
// using NEAR AI Cloud. The model never sees any history: the server re-reads the
// certificate from chain itself and sends only that.
import { getCertificate } from "@/lib/nixo-sdk";

const BASE = process.env.NEARAI_BASE_URL ?? "https://cloud-api.near.ai/v1";
const MODEL = process.env.NEARAI_MODEL ?? "deepseek-ai/DeepSeek-V3.1";

export async function POST(req: Request) {
  const { account } = (await req.json().catch(() => ({}))) as { account?: string };
  if (!account) return Response.json({ error: "account required" }, { status: 400 });
  const key = process.env.NEARAI_API_KEY;
  if (!key) return Response.json({ error: "explainer disabled: NEARAI_API_KEY not set" }, { status: 503 });

  const view = await getCertificate(account).catch(() => null);
  if (!view) return Response.json({ error: "no certificate on-chain" }, { status: 404 });

  const nonce = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };

  const [chat, attestation] = await Promise.all([
    fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content:
              "You write short compliance notes (max 120 words) about a NIXO clean-funds certificate for a user or a compliance officer. " +
              "Use only the certificate fields given. Never speculate about the user's transactions; you have not seen them. " +
              "State: verdict, what was checked (lists snapshot, trace depth), when it expires, whether it is currently valid, and that the history source is simulated if history_source is 'fixture'.",
          },
          { role: "user", content: JSON.stringify(view) },
        ],
      }),
    }).then((r) => r.json()),
    fetch(`${BASE}/attestation/report?model=${encodeURIComponent(MODEL)}&nonce=${nonce}`, { headers })
      .then(async (r) => (r.ok ? r.json() : { error: `HTTP ${r.status}` }))
      .catch((e) => ({ error: String(e) })),
  ]);

  const text = chat?.choices?.[0]?.message?.content ?? null;
  if (!text) return Response.json({ error: "explainer failed", detail: chat }, { status: 502 });
  return Response.json({
    text,
    model: MODEL,
    nonce,
    attestation: {
      fetched: !attestation?.error,
      // Echo check only; full TDX/GPU quote verification is listed as future work.
      nonce_echoed: JSON.stringify(attestation ?? {}).includes(nonce),
      error: attestation?.error ?? null,
    },
  });
}
