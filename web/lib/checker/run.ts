// Runs the NIXO checker WASM in-process for the "check any wallet" preview.
//
// Same Rust source as the certified checker, built for wasm32-wasip1 (Node's
// WASI only speaks preview1); the certified build OutLayer runs is
// wasm32-wasip2. Different target => different hash, so preview results are
// labelled "not certified" and the contract refuses to store them anyway
// (history_source = "caller_supplied").
import "server-only";
import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WASI } from "node:wasi";

export const PREVIEW_WASM = path.join(process.cwd(), "lib/checker/nixo_checker_preview.wasm");

export type Hop = {
  kind: "transfer" | "pool";
  from: string;
  to: string;
  amount: string;
  token: string;
  tx_hashes: string[];
  timestamp: string;
  pool_id?: number;
  pool_token?: string;
  seconds_apart?: number;
  amount_diff_bps?: number;
  fresh_token?: boolean;
  weak: boolean;
};

export type CheckerOutput = {
  account: string;
  verdict: "clean" | "warn" | "rejected";
  reason: string | null;
  hops?: number;
  checker_version: string;
  list_snapshot: string;
  list_hash: string;
  trace_depth: number;
  history_source: string;
  input_hash: string;
  path?: Hop[];
  incomplete?: string[];
};

let compiled: { module: WebAssembly.Module; sha256: string } | null = null;

async function load() {
  if (!compiled) {
    const bytes = await readFile(PREVIEW_WASM);
    compiled = { module: await WebAssembly.compile(bytes), sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  return compiled;
}

export async function runChecker(input: unknown): Promise<{ output: CheckerOutput; wasmSha256: string }> {
  const { module, sha256 } = await load();
  const dir = await mkdtemp(path.join(os.tmpdir(), "nixo-check-"));
  const inPath = path.join(dir, "in.json");
  const outPath = path.join(dir, "out.json");
  await writeFile(inPath, JSON.stringify(input));
  const stdin = await open(inPath, "r");
  const stdout = await open(outPath, "w");
  try {
    const wasi = new WASI({ version: "preview1", args: ["nixo_checker"], env: {}, stdin: stdin.fd, stdout: stdout.fd, returnOnExit: true });
    const instance = await WebAssembly.instantiate(module, wasi.getImportObject() as WebAssembly.Imports);
    const code = wasi.start(instance);
    if (code !== 0) throw new Error(`checker exited with ${code}`);
  } finally {
    await stdin.close();
    await stdout.close();
  }
  const text = await readFile(outPath, "utf8");
  await rm(dir, { recursive: true, force: true });
  return { output: JSON.parse(text) as CheckerOutput, wasmSha256: sha256 };
}
