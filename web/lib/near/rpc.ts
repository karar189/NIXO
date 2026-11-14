import { rpcUrl, type NearNetwork } from "./config";

/** 1 NEAR = 10^24 yoctoNEAR. */
const YOCTO_PER_NEAR = 10n ** 24n;
/** Storage staking cost: 10^19 yoctoNEAR per byte (0.00001 NEAR). */
const YOCTO_PER_STORAGE_BYTE = 10n ** 19n;

export type AccountView = {
  amount: string;
  locked: string;
  code_hash: string;
  storage_usage: number;
  block_height: number;
};

export type AccountBalance = {
  total: bigint;
  available: bigint;
  staked: bigint;
  storageReserved: bigint;
  storageBytes: number;
  hasContract: boolean;
};

async function rpc<T>(network: NearNetwork, method: string, params: unknown): Promise<T> {
  const res = await fetch(rpcUrl(network), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "neararc", method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} failed: HTTP ${res.status}`);
  const body = (await res.json()) as {
    result?: T & { error?: string };
    error?: { cause?: { name?: string }; message?: string };
  };
  if (body.error) {
    throw new Error(body.error.cause?.name ?? body.error.message ?? "RPC error");
  }
  if (body.result?.error) throw new Error(body.result.error);
  return body.result as T;
}

export async function viewAccount(network: NearNetwork, accountId: string): Promise<AccountView> {
  return rpc<AccountView>(network, "query", {
    request_type: "view_account",
    finality: "final",
    account_id: accountId,
  });
}

export async function latestBlockHeight(network: NearNetwork): Promise<number> {
  const block = await rpc<{ header: { height: number } }>(network, "block", { finality: "final" });
  return block.header.height;
}

/** Call a read-only contract method and JSON-decode its result. */
export async function viewFunction<T>(
  network: NearNetwork,
  contractId: string,
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const argsBase64 = btoa(JSON.stringify(args));
  const result = await rpc<{ result: number[] }>(network, "query", {
    request_type: "call_function",
    finality: "final",
    account_id: contractId,
    method_name: method,
    args_base64: argsBase64,
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result))) as T;
}

const EMPTY_CODE_HASH = "11111111111111111111111111111111";

export function toBalance(view: AccountView): AccountBalance {
  const amount = BigInt(view.amount);
  const staked = BigInt(view.locked);
  const storageReserved = BigInt(view.storage_usage) * YOCTO_PER_STORAGE_BYTE;
  // Staked tokens count toward storage, so only the shortfall comes out of `amount`.
  const shortfall = storageReserved > staked ? storageReserved - staked : 0n;
  const available = amount > shortfall ? amount - shortfall : 0n;
  return {
    total: amount + staked,
    available,
    staked,
    storageReserved: shortfall,
    storageBytes: view.storage_usage,
    hasContract: view.code_hash !== EMPTY_CODE_HASH,
  };
}

/** Smallest units → decimal number (display only). */
export function fromUnits(units: bigint | string, decimals: number): number {
  const v = typeof units === "string" ? BigInt(units) : units;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  const fracDigits = Math.min(decimals, 8);
  return Number(whole) + Number(frac / 10n ** BigInt(decimals - fracDigits)) / 10 ** fracDigits;
}

/** Decimal string → smallest units, rounding down. Throws on bad input. */
export function toUnits(amount: string, decimals: number): bigint {
  const clean = amount.trim();
  if (!/^\d*\.?\d*$/.test(clean) || clean === "" || clean === ".") throw new Error("Enter a valid amount");
  const [whole, frac = ""] = clean.split(".");
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function yoctoToNear(yocto: bigint): number {
  return fromUnits(yocto, 24);
}

export function formatNear(yocto: bigint, digits = 4): string {
  return yoctoToNear(yocto).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  });
}

export { YOCTO_PER_NEAR };
