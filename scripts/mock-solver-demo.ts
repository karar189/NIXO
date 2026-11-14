// Reproducible Layer 3 demo: mock solver fills Alice, refuses Mallory.
//
//   pnpm demo:solver
//
// Exit 0 only when Alice is filled and Mallory is refused. Requires live
// certificates on nixo.testnet (fail-closed if Alice cert is missing/expired).
import { DEMO_ACCOUNTS } from "../web/lib/config";
import { mockSolve } from "../web/lib/solver/mock-solver";

const alice = DEMO_ACCOUNTS.find((a) => a.id === "alice")!.label;
const mallory = DEMO_ACCOUNTS.find((a) => a.id === "mallory")!.label;

async function main() {
  console.log("NIXO mock solver demo (paper fill · not a live Intents network)\n");

  const aliceResult = await mockSolve({
    origin: alice,
    assetIn: "NEAR",
    assetOut: "USDC",
    amount: "1",
  });
  const malloryResult = await mockSolve({
    origin: mallory,
    assetIn: "NEAR",
    assetOut: "USDC",
    amount: "1",
  });

  console.log("Alice:", JSON.stringify(aliceResult, null, 2));
  console.log("Mallory:", JSON.stringify(malloryResult, null, 2));

  let failed = false;
  if (aliceResult.status !== "filled") {
    console.error("\nFAIL: expected Alice to be filled (need a currently valid Clean certificate).");
    failed = true;
  }
  if (malloryResult.status !== "refused") {
    console.error("\nFAIL: expected Mallory to be refused.");
    failed = true;
  } else {
    console.log(`\nMallory refuse code: ${malloryResult.decision.code} — ${malloryResult.decision.reason}`);
  }

  if (failed) process.exit(1);
  console.log("\nOK: Alice filled, Mallory refused.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
