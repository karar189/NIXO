/**
 * Wallet-signed spot swaps through NEAR Intents (1Click, ORIGIN_CHAIN deposits).
 *
 * Flow: quote (dry) → quote (real, returns a deposit address) → the user signs
 * NEP-141 transfers to that address in Meteor → 1Click's solvers swap → the
 * output lands back in the user's NEAR account, or the input is refunded.
 */

import type { TxRequest } from "@/components/wallet/WalletProvider";
import type { NearNetwork } from "@/lib/near/config";
import { toBalance, viewAccount, viewFunction } from "@/lib/near/rpc";
import { USDC_CONTRACT, USDC_NEAR, type SwapStatus } from "@/lib/trading/api";

export const WNEAR_CONTRACT = "wrap.near";
export const WNEAR_ASSET = "nep141:wrap.near";

const TGAS = 1_000_000_000_000n;
const GAS_STORAGE = (30n * TGAS).toString();
const GAS_TRANSFER = (30n * TGAS).toString();
const GAS_WRAP = (10n * TGAS).toString();
/** Native NEAR kept back for gas and storage when selling NEAR. */
export const NEAR_GAS_RESERVE = 50_000_000_000_000_000_000_000n; // 0.05 NEAR

export type Direction = "buy" | "sell"; // buy = USDC → NEAR, sell = NEAR → USDC

export type WalletBalances = {
  usdc: bigint;
  wnear: bigint;
  nearAvailable: bigint;
};

export async function loadBalances(network: NearNetwork, account: string): Promise<WalletBalances> {
  const ft = (contract: string) =>
    viewFunction<string>(network, contract, "ft_balance_of", { account_id: account })
      .then(BigInt)
      .catch(() => 0n);
  const [usdc, wnear, acct] = await Promise.all([ft(USDC_CONTRACT), ft(WNEAR_CONTRACT), viewAccount(network, account)]);
  return { usdc, wnear, nearAvailable: toBalance(acct).available };
}

async function isRegistered(network: NearNetwork, contract: string, account: string): Promise<boolean> {
  const bal = await viewFunction<unknown>(network, contract, "storage_balance_of", { account_id: account });
  return bal !== null;
}

async function storageMin(network: NearNetwork, contract: string): Promise<string> {
  const bounds = await viewFunction<{ min: string }>(network, contract, "storage_balance_bounds");
  return bounds.min;
}

async function registerAction(network: NearNetwork, contract: string, account: string) {
  return {
    methodName: "storage_deposit",
    args: { account_id: account, registration_only: true },
    gas: GAS_STORAGE,
    deposit: await storageMin(network, contract),
  };
}

/** Builds the transactions that fund a 1Click deposit address. */
export async function buildDepositTxs({
  network,
  account,
  direction,
  amount,
  depositAddress,
  balances,
}: {
  network: NearNetwork;
  account: string;
  direction: Direction;
  amount: bigint;
  depositAddress: string;
  balances: WalletBalances;
}): Promise<TxRequest[]> {
  const origin = direction === "buy" ? USDC_CONTRACT : WNEAR_CONTRACT;
  const destination = direction === "buy" ? WNEAR_CONTRACT : USDC_CONTRACT;
  const txs: TxRequest[] = [];

  // The user must be registered on the token they receive, or delivery fails.
  if (!(await isRegistered(network, destination, account))) {
    txs.push({ receiverId: destination, actions: [await registerAction(network, destination, account)] });
  }

  const actions: TxRequest["actions"] = [];
  if (direction === "sell") {
    if (!(await isRegistered(network, WNEAR_CONTRACT, account))) {
      actions.push(await registerAction(network, WNEAR_CONTRACT, account));
    }
    const shortfall = amount > balances.wnear ? amount - balances.wnear : 0n;
    if (shortfall > 0n) {
      // Wrap native NEAR into wNEAR so it can be sent as a NEP-141 token.
      actions.push({ methodName: "near_deposit", args: {}, gas: GAS_WRAP, deposit: shortfall.toString() });
    }
  }
  if (!(await isRegistered(network, origin, depositAddress))) {
    actions.push(await registerAction(network, origin, depositAddress));
  }
  actions.push({
    methodName: "ft_transfer",
    args: { receiver_id: depositAddress, amount: amount.toString() },
    gas: GAS_TRANSFER,
    deposit: "1",
  });
  txs.push({ receiverId: origin, actions });
  return txs;
}

export const assetsFor = (direction: Direction) =>
  direction === "buy"
    ? { origin: USDC_NEAR, destination: WNEAR_ASSET, inSymbol: "USDC", outSymbol: "wNEAR", inDecimals: 6, outDecimals: 24 }
    : { origin: WNEAR_ASSET, destination: USDC_NEAR, inSymbol: "NEAR", outSymbol: "USDC", inDecimals: 24, outDecimals: 6 };

// ---------------------------------------------------------------- history

export type LiveSwapRecord = {
  depositAddress: string;
  direction: Direction;
  amountIn: string;
  inSymbol: string;
  expectedOut: string;
  outSymbol: string;
  createdAt: number;
  txHash: string | null;
  status: SwapStatus | "SIGNING" | "CANCELLED";
  updatedAt: number;
  detail?: string;
};

export const FINAL: ReadonlySet<string> = new Set(["SUCCESS", "REFUNDED", "FAILED", "CANCELLED"]);

const key = (account: string) => `neararc:live-swaps:${account}`;

export function readSwaps(account: string): LiveSwapRecord[] {
  try {
    return JSON.parse(window.localStorage.getItem(key(account)) ?? "[]") as LiveSwapRecord[];
  } catch {
    return [];
  }
}

export function saveSwap(account: string, record: LiveSwapRecord) {
  try {
    const rest = readSwaps(account).filter((r) => r.depositAddress !== record.depositAddress);
    window.localStorage.setItem(key(account), JSON.stringify([record, ...rest].slice(0, 20)));
  } catch {
    // Storage blocked: history only lives for this page view.
  }
}
