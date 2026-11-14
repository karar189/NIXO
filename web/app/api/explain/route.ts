/**
 * Certificate explainer via NEAR AI Cloud (TEE-hosted model).
 *
 * Ephemeral: re-reads the PUBLIC on-chain certificate, sends only that to the
 * model, fetches a fresh-nonce attestation, returns the note + checks.
 * Does not persist prompts, completions, or attestation blobs.
 */
import { getCertificate } from "@/lib/nixo-sdk";
import {
  NEARAI_MODEL,
  chatCompletion,
  fetchAttestationReport,
  freshNonce,
  summarizeAttestation,
} from "@/lib/nearai";

export async function POST(req: Request) {
  const { account } = (await req.json().catch(() => ({}))) as { account?: string };
  if (!account) return Response.json({ error: "account required" }, { status: 400 });
  const key = process.env.NEARAI_API_KEY;
  if (!key) return Response.json({ error: "explainer disabled: NEARAI_API_KEY not set" }, { status: 503 });

  const view = await getCertificate(account).catch(() => null);
  if (!view) return Response.json({ error: "no certificate on-chain" }, { status: 404 });

  const model = NEARAI_MODEL;
  const nonce = freshNonce();

  const [chat, report] = await Promise.all([
    chatCompletion({
      apiKey: key,
      model,
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
    fetchAttestationReport({ apiKey: key, model, nonce }),
  ]);

  if (!chat.ok) {
    return Response.json(
      { error: "explainer failed", detail: chat.error },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const checks = [
    {
      id: "public_cert_only",
      label: "Model received only the public on-chain certificate",
      status: "pass" as const,
      detail: `account=${account}`,
    },
    {
      id: "ephemeral",
      label: "No server-side retention after response",
      status: "pass" as const,
    },
    ...summarizeAttestation(report, nonce),
  ];

  return Response.json(
    {
      text: chat.text,
      model,
      nonce,
      completion_id: chat.id,
      ephemeral: true,
      checks,
      attestation: {
        fetched: !Boolean((report as { error?: string })?.error),
        nonce_echoed: checks.some((c) => c.id === "nonce_bound" && c.status === "pass"),
        error: (report as { error?: string })?.error ?? null,
      },
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, private" } },
  );
}
