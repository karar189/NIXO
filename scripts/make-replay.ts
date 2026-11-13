// Replay a fetched mainnet trail as a testnet demo account's certified history.
//
//   pnpm make-replay farstreet4572.near nixo-mallory.testnet
//
// Reads fixtures/mainnet/<source>.json and writes fixtures/<name>.json with the
// subject renamed. Every other account, amount and tx hash is kept exactly as
// fetched from chain. The checker compiles fixtures/mallory.json in, so the
// certified result for the testnet account is the real mainnet trail's result.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const [source, target, outName] = process.argv.slice(2);
if (!source || !target) {
  console.error("usage: make-replay <mainnet-account> <testnet-account> [fixture-name]");
  process.exit(2);
}

async function main() {
  const doc = JSON.parse(await readFile(path.join(root, "fixtures/mainnet", `${source}.json`), "utf8"));
  const rename = (a: string) => (a === source ? target : a);
  const replay = {
    ...doc,
    subject: target,
    network: "testnet-replay",
    replay_of: source,
    note: `Replay of NEAR mainnet account ${source}'s real money trail (fetched ${doc.fetched_at} from ${doc.source}). Only the subject's name is changed; all other accounts, amounts and tx hashes are as on chain.`,
    expanded: doc.expanded.map(rename),
    incomplete: doc.incomplete.map((i: { account: string; reason: string }) => ({ ...i, account: rename(i.account) })),
    edges: doc.edges.map((e: Record<string, string>) =>
      e.kind === "transfer" ? { ...e, from: rename(e.from), to: rename(e.to) } : { ...e, account: rename(e.account) },
    ),
  };
  const name = outName ?? target.split(".")[0].replace(/^nixo-/, "");
  const out = path.join(root, "fixtures", `${name}.json`);
  await writeFile(out, JSON.stringify(replay, null, 1) + "\n");
  console.log(`wrote ${path.relative(root, out)} (replay of ${source}, ${replay.edges.length} edges)`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
