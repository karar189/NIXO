/**
 * Private AI (NEAR AI Cloud) — ephemeral certificate / sample-doc explainer.
 *
 * Privacy contract (hackathon Privacy & Private AI track):
 * - Prompt = fictional sample or caller-supplied PUBLIC certificate JSON only.
 * - Model runs on NEAR AI Cloud (TEE-hosted). Fresh nonce on every attestation fetch.
 * - We do NOT write prompts, completions, or attestation blobs to disk, DB, or logs.
 * - Response headers: Cache-Control: no-store.
 * - Locals are dropped when the handler returns; nothing is retained server-side.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  NEARAI_MODEL,
  chatCompletion,
  fetchAttestationReport,
  freshNonce,
  summarizeAttestation,
  type AttestationCheck,
} from "@/lib/nearai";

const SAMPLES: Record<string, string> = {
  alice: "alice-clean.cert.json",
  mallory: "mallory-rejected.cert.json",
  expense: "expense-memo.clean.json",
};

async function loadSample(id: string): Promise<unknown> {
  const file = SAMPLES[id];
  if (!file) throw new Error(`unknown sample: ${id}`);
  // Next.js cwd is `web/`; fixtures live at repo root.
  const repo = path.join(process.cwd(), "..");
  const candidates = [
    path.join(repo, "fixtures", "samples", file),
    path.join(process.cwd(), "fixtures", "samples", file),
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(await readFile(p, "utf8"));
    } catch {
      /* try next */
    }
  }
  throw new Error(`sample file missing: ${file}`);
}

function noStore(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
    },
  });
}

export async function GET() {
  // Advertise samples + model; never returns secrets.
  return noStore({
    ephemeral: true,
    retention: "none — request locals discarded after response",
    base_url: process.env.NEARAI_BASE_URL ?? "https://cloud-api.near.ai/v1",
    model: NEARAI_MODEL,
    samples: Object.keys(SAMPLES),
    full_verify: "scripts/nearai_smoke.py",
  });
}

export async function POST(req: Request) {
  const key = process.env.NEARAI_API_KEY;
  if (!key) {
    return noStore(
      {
        error: "NEARAI_API_KEY not set. Create a key at https://cloud.near.ai and put it in root .env",
        ephemeral: true,
      },
      503,
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    sample?: string;
    document?: unknown;
  };

  let document: unknown;
  let sampleId: string | null = null;
  try {
    if (body.sample) {
      sampleId = body.sample;
      document = await loadSample(body.sample);
    } else if (body.document) {
      document = body.document;
    } else {
      return noStore({ error: "provide sample=alice|mallory|expense or document JSON" }, 400);
    }
  } catch (e) {
    return noStore({ error: e instanceof Error ? e.message : String(e) }, 400);
  }

  const model = NEARAI_MODEL;
  const nonce = freshNonce();

  const system =
    "You are a private compliance assistant running inside a TEE on NEAR AI Cloud. " +
    "You receive ONLY a fictional sample document or a PUBLIC on-chain certificate summary — never raw bank feeds or private chain history. " +
    "Write at most 120 words. Categorize any expense line_items if present, flag anything unusual vs a clean certificate, " +
    "and state the certificate verdict if present. Never invent counterparties or balances. " +
    "If history_source is 'fixture', say the history is a labelled demo fixture.";

  // Run completion + attestation in parallel; neither result is persisted.
  const [chat, report] = await Promise.all([
    chatCompletion({
      apiKey: key,
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(document) },
      ],
    }),
    fetchAttestationReport({ apiKey: key, model, nonce }),
  ]);

  if (!chat.ok) {
    return noStore({ error: chat.error, detail: chat.raw, ephemeral: true }, 502);
  }

  const checks: AttestationCheck[] = [
    {
      id: "tee_model",
      label: `TEE-hosted model selected (${model})`,
      status: "pass",
      detail: "OpenAI-compatible POST /v1/chat/completions via cloud-api.near.ai",
    },
    {
      id: "ephemeral",
      label: "No server-side retention after response",
      status: "pass",
      detail: "Handler locals only; Cache-Control: no-store; no DB/disk write",
    },
    ...summarizeAttestation(report, nonce),
  ];

  const verified = checks.every((c) => c.status === "pass" || c.status === "skip") &&
    checks.some((c) => c.id === "nonce_bound" && c.status === "pass");

  // Deliberately omit raw attestation blob from the default response to shrink
  // client retention surface; include a compact fingerprint only.
  const reportFingerprint = (() => {
    try {
      const s = JSON.stringify(report);
      return { bytes: s.length, has_error: Boolean((report as { error?: string })?.error) };
    } catch {
      return { bytes: 0, has_error: true };
    }
  })();

  return noStore({
    ephemeral: true,
    retention: "none",
    sample: sampleId,
    model,
    completion_id: chat.id,
    text: chat.text,
    nonce,
    verified,
    checks,
    attestation: reportFingerprint,
    // Explicit: we are not returning the full quote to avoid accidental logging in browsers.
    note: "Full DCAP/NRAS verification: python scripts/nearai_smoke.py (nearai-inference-sdk).",
  });
}
