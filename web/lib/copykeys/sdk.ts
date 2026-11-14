/** Wallet call builders for the copy-keys contract (copykeys/), plus NEAR helpers. */
import type { TxRequest } from "@/components/wallet/WalletProvider";
import { nearToYocto } from "@/lib/vault-sdk";

export { nearToYocto };

export type Listing = {
  trader: string;
  price_per_period: string; // yoctoNEAR
  period_secs: number;
  active: boolean;
  subscriber_count: number;
  earned_total: string;
  listed_at_ns: string;
};

export type Subscription = {
  trader: string;
  follower: string;
  x25519_pub: string;
  starts_at_ns: string;
  expires_at_ns: string;
  paid_total: string;
  active?: boolean;
};

export const PERIOD_OPTIONS = [
  { secs: 300, label: "5 minutes (demo)" },
  { secs: 3600, label: "1 hour" },
  { secs: 86400, label: "1 day" },
  { secs: 7 * 86400, label: "7 days" },
  { secs: 30 * 86400, label: "30 days" },
] as const;

export function periodLabel(secs: number): string {
  const hit = PERIOD_OPTIONS.find((p) => p.secs === secs);
  if (hit) return hit.label.replace(" (demo)", "");
  if (secs % 86400 === 0) return `${secs / 86400} days`;
  if (secs % 3600 === 0) return `${secs / 3600} hours`;
  return `${Math.round(secs / 60)} minutes`;
}

export function yoctoToNear(yocto: string | bigint, digits = 4): string {
  const v = BigInt(yocto);
  const whole = v / 10n ** 24n;
  const frac = (v % 10n ** 24n).toString().padStart(24, "0").slice(0, digits).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

const TGAS = 10n ** 12n;

function call(contract: string, methodName: string, args: Record<string, unknown>, gasT: bigint, deposit = "0"): TxRequest {
  return { receiverId: contract, actions: [{ methodName, args, gas: (gasT * TGAS).toString(), deposit }] };
}

export function buildListKeyCall(contract: string, priceNear: string, periodSecs: number): TxRequest {
  return call(contract, "list_key", { price_per_period: nearToYocto(priceNear), period_secs: periodSecs }, 30n);
}

export function buildUnlistCall(contract: string): TxRequest {
  return call(contract, "unlist", {}, 30n);
}

export function buildSubscribeCall(
  contract: string,
  args: { trader: string; periods: number; x25519Pub: string; pricePerPeriodYocto: string },
): TxRequest {
  const deposit = (BigInt(args.pricePerPeriodYocto) * BigInt(args.periods)).toString();
  return call(contract, "subscribe", { trader: args.trader, periods: args.periods, x25519_pub: args.x25519Pub }, 50n, deposit);
}
