// "Check any wallet" preview: fetch a NEAR mainnet account's money trail
// (cached fixtures first, then NearBlocks live) and run the checker on it.
//
// This is a PREVIEW, never a certificate: the history is fetched outside the
// TEE and passed in, so the result is labelled history_source =
// "caller_supplied" and nixo.testnet refuses to certify it.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fetchHistory, seedsFromLists, type History } from "@/lib/history/fetcher";
import { runChecker } from "@/lib/checker/run";

const REPO = path.join(process.cwd(), "..");
const MAINNET_FIXTURES = path.join(REPO, "fixtures/mainnet");
const LISTS = ["hackers.txt", "us-ofac.txt", "eu.txt", "uk.txt", "un.txt", "ch-seco.txt"];
/** Live fetch budget: ~6.5 s per call on NearBlocks' free tier. */
const LIVE_MAX_CALLS = Number(process.env.CHECK_LIVE_MAX_CALLS ?? 15);
const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export async function POST(req: Request) {
  const { account: raw } = (await req.json().catch(() => ({}))) as { account?: string };
  const account = (raw ?? "").trim().toLowerCase();
  if (!account || account.length > 64 || !ACCOUNT_RE.test(account)) {
    return Response.json({ error: "Enter a NEAR account id, e.g. farstreet4572.near" }, { status: 400 });
  }
  if (account.endsWith(".testnet")) {
    return Response.json({ error: "Testnet accounts are checked through their on-chain certificate (the is_clean box above). This box traces NEAR mainnet accounts." }, { status: 400 });
  }

  let history: History;
  let origin: "cached" | "live";
  let apiCalls = 0;
  try {
    history = JSON.parse(await readFile(path.join(MAINNET_FIXTURES, `${account}.json`), "utf8")) as History;
    origin = "cached";
  } catch {
    const lists = await Promise.all(LISTS.map((f) => readFile(path.join(REPO, "checker/lists", f), "utf8")));
    try {
      let calls = 0;
      history = await fetchHistory(account, {
        cacheDir: path.join(MAINNET_FIXTURES, "cache"),
        maxCalls: LIVE_MAX_CALLS,
        apiKey: process.env.NEARBLOCKS_API_KEY || undefined,
        seeds: seedsFromLists(lists),
        log: (m) => {
          if (m.includes("API calls")) calls = Number(/(\d+) API calls/.exec(m)?.[1] ?? 0);
        },
      });
      apiCalls = calls;
      origin = "live";
    } catch (e) {
      // Fail closed: no history, no verdict other than "could not check".
      return Response.json({ error: `Could not fetch this account's history: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
    }
  }

  const { output, wasmSha256 } = await runChecker({ account, history });
  return Response.json({
    result: output,
    history: {
      origin,
      source: history.source,
      fetched_at: history.fetched_at,
      edges: history.edges.length,
      accounts_fully_listed: history.expanded.length,
      incomplete: history.incomplete.length,
      api_calls: apiCalls,
    },
    checker: { build: "wasm32-wasip1 (preview)", sha256: wasmSha256 },
  });
}
