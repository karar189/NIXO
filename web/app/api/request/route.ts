// Demo signer: submits `request_nixo` as one of the two pre-seeded testnet
// accounts so judges need no wallet. Keys live only in server env.
import { Account, JsonRpcProvider, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
import { NEAR_RPC, NIXO_CONTRACT, type DemoId } from "@/lib/config";

const DEMO: Record<DemoId, { account?: string; key?: string }> = {
  alice: { account: process.env.DEMO_ALICE_ACCOUNT ?? "nixo-alice.testnet", key: process.env.DEMO_ALICE_KEY },
  mallory: { account: process.env.DEMO_MALLORY_ACCOUNT ?? "nixo-mallory.testnet", key: process.env.DEMO_MALLORY_KEY },
};

export async function POST(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: DemoId };
  const demo = id && DEMO[id];
  if (!demo) return Response.json({ error: "unknown demo account" }, { status: 400 });
  if (!demo.key || !demo.account) {
    return Response.json({ error: `missing DEMO_${id!.toUpperCase()}_KEY in server env` }, { status: 500 });
  }
  const provider = new JsonRpcProvider({ url: NEAR_RPC });
  const account = new Account(demo.account, provider, demo.key as KeyPairString);
  const requestedAtMs = Date.now();
  try {
    // INCLUDED: return as soon as the tx is in a block; the TEE run resolves
    // asynchronously via yield/resume and the client polls get_certificate.
    const tx = await account.callFunctionRaw({
      contractId: NIXO_CONTRACT,
      methodName: "request_nixo",
      args: {},
      deposit: nearToYocto((process.env.NIXO_REQUEST_DEPOSIT ?? "0.05") as `${number}`),
      gas: teraToGas("300"),
      waitUntil: "INCLUDED",
    });
    const txHash = (tx as { transaction?: { hash?: string } }).transaction?.hash;
    return Response.json({ account: demo.account, txHash, requestedAtMs });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
