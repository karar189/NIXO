export const NIXO_CONTRACT = process.env.NEXT_PUBLIC_NIXO_CONTRACT ?? "nixo.testnet";
export const NEAR_RPC = process.env.NEXT_PUBLIC_NEAR_RPC ?? "https://test.rpc.fastnear.com";
export const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER ?? "https://testnet.nearblocks.io";
export const OUTLAYER_APP = process.env.NEXT_PUBLIC_OUTLAYER_APP ?? "https://app.outlayer.ai";
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/<your-org>/nixo";
export const KANI_RUN_URL = process.env.NEXT_PUBLIC_KANI_RUN_URL ?? `${REPO_URL}/actions/workflows/ci.yml`;
export const LISTS_URL = "https://github.com/safe-fndn/sanctions-address-lists/releases/tag/";

export const DEMO_ACCOUNTS = [
  { id: "alice", label: "nixo-alice.testnet", note: "pre-seeded clean history" },
  { id: "mallory", label: "nixo-mallory.testnet", note: "received funds from a demo-flagged address" },
] as const;
export type DemoId = (typeof DEMO_ACCOUNTS)[number]["id"];
