/** View-only client + wallet call builders for the Layer 2 vault (testnet + mainnet). */
import { nixoVaultContract } from "./config";
import { rpcUrl, type NearNetwork } from "@/lib/near/config";
import type { TxRequest } from "@/components/wallet/WalletProvider";

export type VaultDeposit = {
  deposit_id: string;
  owner: string;
  amount: string;
  remaining: string;
  clean_at_deposit: boolean;
  checked_at_ns: string;
  status: string;
  assignment_id: string | null;
};

export type VaultAssignment = {
  assignment_id: string;
  deposit_id: string;
  agent_id: string;
  max_per_tx: string;
  max_per_window: string;
  window_ns: number;
  window_started_at_ns: string;
  window_spent: string;
  expires_at_ns: string;
  allowlist: string[];
  status: string;
  revoked_at_ns: string | null;
};

export type VaultConfig = {
  owner: string;
  nixo_contract: string;
  next_deposit_id: string;
  next_assignment_id: string;
};

async function view<T>(network: NearNetwork, method: string, args: object = {}): Promise<T> {
  const contract = nixoVaultContract(network);
  if (!contract) throw new Error(`Vault contract is not set for ${network}`);
  const res = await fetch(rpcUrl(network), {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "nixo-vault",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contract,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const json = await res.json();
  if (json.error || json.result?.error) {
    throw new Error(JSON.stringify(json.error ?? json.result.error));
  }
  const bytes = new Uint8Array(json.result.result as number[]);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export const getVaultConfig = (network: NearNetwork) => view<VaultConfig>(network, "get_config");
export const getDeposit = (network: NearNetwork, deposit_id: string | number) =>
  view<VaultDeposit | null>(network, "get_deposit", { deposit_id: String(deposit_id) });
export const getAssignment = (network: NearNetwork, assignment_id: string | number) =>
  view<VaultAssignment | null>(network, "get_assignment", { assignment_id: String(assignment_id) });
export const listDepositsByOwner = (network: NearNetwork, owner: string) =>
  view<VaultDeposit[]>(network, "list_deposits_by_owner", { owner });

export function nearToYocto(amountNear: string): string {
  const [whole = "0", frac = ""] = amountNear.split(".");
  const frac24 = (frac + "0".repeat(24)).slice(0, 24);
  return (BigInt(whole || "0") * 10n ** 24n + BigInt(frac24 || "0")).toString();
}

function tx(
  network: NearNetwork,
  methodName: string,
  args: Record<string, unknown>,
  gasT: bigint,
  deposit: string,
): TxRequest {
  const receiverId = nixoVaultContract(network);
  if (!receiverId) throw new Error(`Vault contract is not set for ${network}`);
  return {
    receiverId,
    actions: [{ methodName, args, gas: (gasT * 10n ** 12n).toString(), deposit }],
  };
}

export function buildDepositCall(network: NearNetwork, amountNear: string): TxRequest {
  return tx(network, "deposit", {}, 80n, nearToYocto(amountNear));
}

export function buildAssignCall(
  network: NearNetwork,
  args: {
    deposit_id: string | number;
    agent_id: string;
    max_per_tx_near: string;
    max_per_window_near: string;
    window_ns: string | number;
    expires_at_ns: string | number;
    allowlist: string[];
  },
): TxRequest {
  return tx(
    network,
    "assign",
    {
      deposit_id: String(args.deposit_id),
      agent_id: args.agent_id,
      max_per_tx: nearToYocto(args.max_per_tx_near),
      max_per_window: nearToYocto(args.max_per_window_near),
      window_ns: String(args.window_ns),
      expires_at_ns: String(args.expires_at_ns),
      allowlist: args.allowlist,
    },
    30n,
    "0",
  );
}

export function buildExecuteCall(
  network: NearNetwork,
  args: {
    assignment_id: string | number;
    amount_near: string;
    target: string;
    dry_run?: boolean;
  },
): TxRequest {
  return tx(
    network,
    "execute",
    {
      assignment_id: String(args.assignment_id),
      amount: nearToYocto(args.amount_near),
      target: args.target,
      dry_run: args.dry_run ?? true,
    },
    80n,
    "0",
  );
}

export function buildRevokeCall(network: NearNetwork, assignment_id: string | number): TxRequest {
  return tx(network, "revoke", { assignment_id: String(assignment_id) }, 20n, "0");
}

export function buildWithdrawCall(
  network: NearNetwork,
  deposit_id: string | number,
  amountNear: string,
): TxRequest {
  return tx(network, "withdraw", { deposit_id: String(deposit_id), amount: nearToYocto(amountNear) }, 30n, "0");
}
