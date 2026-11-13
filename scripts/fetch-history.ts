// Fetch a NEAR mainnet account's backward money trail and cache it for the checker.
//
//   pnpm fetch-history farstreet4572.near [--max-hops 6] [--max-calls 120]
//
// Writes fixtures/mainnet/<account>.json (normalized edges) and caches every
// raw NearBlocks response under fixtures/mainnet/cache/, so tests and the demo
// run offline afterwards. Set NEARBLOCKS_API_KEY for higher rate limits.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fetchHistory, seedsFromLists } from "../web/lib/history/fetcher";

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const account = args.find((a) => !a.startsWith("--"));
const flag = (name: string, dflt: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
if (!account) {
  console.error("usage: fetch-history <account> [--max-hops 6] [--max-calls 120]");
  process.exit(2);
}

async function main() {
  const lists = await Promise.all(
    ["hackers.txt", "us-ofac.txt", "eu.txt", "uk.txt", "un.txt", "ch-seco.txt"].map((f) => readFile(path.join(root, "checker/lists", f), "utf8")),
  );
  const history = await fetchHistory(account!.toLowerCase(), {
    maxHops: flag("max-hops", 6),
    maxCalls: flag("max-calls", 120),
    cacheDir: path.join(root, "fixtures/mainnet/cache"),
    apiKey: process.env.NEARBLOCKS_API_KEY || undefined,
    seeds: seedsFromLists(lists),
    log: (m) => console.log(m),
  });
  await mkdir(path.join(root, "fixtures/mainnet"), { recursive: true });
  const out = path.join(root, "fixtures/mainnet", `${history.subject}.json`);
  await writeFile(out, JSON.stringify(history, null, 1) + "\n");
  console.log(`wrote ${path.relative(root, out)}: ${history.edges.length} edges, complete=${history.incomplete.length === 0}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
