// View-only NIXO client. No dependencies: one JSON-RPC call per method.
// Exchanges only need `isClean(account)`.
import { NIXO_CONTRACT, nixoContract } from "./config";
import { rpcUrl, type NearNetwork } from "@/lib/near/config";

export type Certificate = {
  account: string;
  verdict: "clean" | "warn" | "rejected";
  reason: string | null;
  checker_hash: string;
  checker_version: string;
  list_snapshot: string;
  list_hash: string;
  trace_depth: number;
  history_source: string;
  input_hash: string;
  issued_at_ns: string;
  expires_at_ns: string;
};
export type CertificateView = { certificate: Certificate; valid: boolean };
export type Config = {
  owner: string;
  outlayer: string;
  checker: { hash: string; url: string };
  pending: { checker: { hash: string; url: string }; activates_at_ns: string } | null;
  timelock_ns: string;
  cert_ttl_ns: string;
};

async function view<T>(
  method: string,
  args: object = {},
  opts: { rpc?: string; contract?: string; network?: NearNetwork } = {},
): Promise<T> {
  const network = opts.network ?? "testnet";
  const res = await fetch(opts.rpc ?? rpcUrl(network), {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "nixo",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: opts.contract ?? (opts.network ? nixoContract(opts.network) : NIXO_CONTRACT),
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

export const isClean = (account: string, network: NearNetwork = "testnet") =>
  view<boolean>("is_clean", { account }, { network });
export const getCertificate = (account: string, network: NearNetwork = "testnet") =>
  view<CertificateView | null>("get_certificate", { account }, { network });
export const getConfig = (network: NearNetwork = "testnet") => view<Config>("get_config", {}, { network });
export const isRevoked = (checker_hash: string, network: NearNetwork = "testnet") =>
  view<boolean>("is_revoked", { checker_hash }, { network });

export const nsToDate = (ns: string) => new Date(Number(BigInt(ns) / 1_000_000n));
