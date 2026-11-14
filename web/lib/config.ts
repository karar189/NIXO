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

/** Attached NEAR for `request_nixo` (must match server `NIXO_REQUEST_DEPOSIT`). */
export const NIXO_REQUEST_DEPOSIT_NEAR = process.env.NEXT_PUBLIC_NIXO_REQUEST_DEPOSIT ?? "0.05";
/** 300 TGas — OutLayer yield needs headroom. */
export const NIXO_REQUEST_GAS = (300n * 10n ** 12n).toString();
export const NIXO_REQUEST_DEPOSIT_YOCTO = (() => {
  const [whole = "0", frac = ""] = NIXO_REQUEST_DEPOSIT_NEAR.split(".");
  const frac24 = (frac + "0".repeat(24)).slice(0, 24);
  return (BigInt(whole) * 10n ** 24n + BigInt(frac24 || "0")).toString();
})();

/** Mainnet explorer for the "check any wallet" preview (taint paths are mainnet data). */
export const MAINNET_EXPLORER = "https://nearblocks.io";

/** Who flagged each listed seed, shown next to it. Mirrors checker/lists/hackers.txt. */
export const SEED_LABELS: Record<string, { label: string; caveat: string }> = {
  efd224256518a7cacd209867963276efed302a8e222c013c43f4b1bd369ae5af: {
    label: "Binance hack (29 Oct 2026): main stolen-funds wallet",
    caveat:
      "Attributed publicly by on-chain analysts AMLBot and Shridlock on X, consistent with Elliptic. Not an official attribution.",
  },
};

/** Mainnet accounts whose trails are cached in fixtures/mainnet (answer instantly). */
export const CACHED_EXAMPLES = ["farstreet4572.near", "hugezest930.near", "normalherb1811.near"] as const;
