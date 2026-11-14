export type NearNetwork = "testnet" | "mainnet";

export const DEFAULT_NETWORK: NearNetwork =
  process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

const NETWORK_STORAGE_KEY = "neararc:network";

export const NETWORKS = {
  testnet: {
    rpcUrl: "https://test.rpc.fastnear.com",
    explorerUrl: "https://testnet.nearblocks.io",
  },
  mainnet: {
    rpcUrl: "https://free.rpc.fastnear.com",
    explorerUrl: "https://nearblocks.io",
  },
} as const;

export const rpcUrl = (network: NearNetwork) =>
  (network === DEFAULT_NETWORK && process.env.NEXT_PUBLIC_NEAR_RPC_URL) || NETWORKS[network].rpcUrl;

export const accountExplorerUrl = (network: NearNetwork, accountId: string) =>
  `${NETWORKS[network].explorerUrl}/address/${accountId}`;

export const txExplorerUrl = (network: NearNetwork, hash: string) =>
  `${NETWORKS[network].explorerUrl}/txns/${hash}`;

export const intentsExplorerUrl = (depositAddress: string) =>
  `https://explorer.near-intents.org/transactions/${depositAddress}`;

/** The network chosen in Settings, or the build default. Browser only. */
export function readStoredNetwork(): NearNetwork {
  try {
    const v = window.localStorage.getItem(NETWORK_STORAGE_KEY);
    return v === "mainnet" || v === "testnet" ? v : DEFAULT_NETWORK;
  } catch {
    return DEFAULT_NETWORK;
  }
}

export function storeNetwork(network: NearNetwork) {
  try {
    window.localStorage.setItem(NETWORK_STORAGE_KEY, network);
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
}

export const METEOR_WALLET_ID = "meteor-wallet";
