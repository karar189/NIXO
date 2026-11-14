// Mainnet history fetcher for NIXO's multi-hop trace.
//
// Runs OUTSIDE the TEE. It only collects public chain data and normalizes it;
// every tracing decision (which links count, hop limits, verdicts) is made by
// the Rust checker. Used by scripts/fetch-history.ts (to build the cached
// fixtures) and by the web /api/check route (live preview).
//
// Source: NearBlocks API v3 (works without a key at ~10 req/min; set
// NEARBLOCKS_API_KEY for higher limits). Every response is cached on disk, so
// tests and the demo run offline once fetched.
//
// What is traced: incoming NEAR value (receipts with a Transfer action from a
// non-system predecessor) and Ref Finance v2 swaps. Swaps through DEX
// contracts are parsed from the receipt that executed on v2.ref-finance.near
// (pool_id from its ft_on_transfer args, amounts from its "Swapped" log).
// For a swap that took NEAR out of a pool whose other token is fresh
// (< FRESH_TOKEN_DAYS old), the opposite-direction swaps into the same pool in
// the preceding POOL_WINDOW_S are fetched as candidate counterparties.
//
// Fail closed: anything the fetcher could not fully list is reported in
// `incomplete`, and the checker refuses to call such an account Clean.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const NEARBLOCKS = "https://api.nearblocks.io/v3";
export const REF = "v2.ref-finance.near";
export const WNEAR = "wrap.near";
/** Contracts whose payouts are not "a person sending NEAR": never traversed. */
export const HUBS = new Set(["system", WNEAR, REF, "aggregatedex.near", "intents.near"]);
/** DEX contracts whose payouts are swap proceeds (parsed as swaps). */
const DEX_PAYERS = new Set([REF, "aggregatedex.near", WNEAR]);

export const DEFAULT_MAX_HOPS = 6;
/** Must match checker/src/trace.rs POOL_WINDOW_S. */
export const POOL_WINDOW_S = 120;
export const FRESH_TOKEN_DAYS = 7;
const DUST_YOCTO = 10n ** 21n; // 0.001 NEAR: ignore dust and gas refunds
const RECEIPT_PAGE = 100;
const MAX_RECEIPT_PAGES = 12; // per account (each swap adds ~15 gas-refund rows); more means "too busy to list fully"
const NS = 1_000_000_000n;

export type TransferEdge = {
  kind: "transfer";
  from: string;
  to: string;
  amount: string; // yoctoNEAR
  token: "NEAR";
  tx_hash: string;
  timestamp: string; // ns, block timestamp of the receipt
};

export type SwapEdge = {
  kind: "swap";
  account: string; // the transaction signer
  venue: typeof REF;
  pool_id: number;
  token_in: string;
  amount_in: string;
  token_out: string;
  amount_out: string;
  tx_hash: string;
  timestamp: string; // ns, block timestamp of the Ref receipt
  token_created_at?: string; // ns, creation of the non-wNEAR token
};

export type Edge = TransferEdge | SwapEdge;

export type History = {
  version: 1;
  subject: string;
  network: "mainnet";
  source: string;
  fetched_at: string;
  max_hops: number;
  /** Accounts whose inflows (before their bound) were listed completely. */
  expanded: string[];
  /** Why something could not be listed fully. Non-empty means not complete. */
  incomplete: { account: string; reason: string }[];
  edges: Edge[];
};

export type FetchOptions = {
  maxHops?: number;
  /** Max uncached API calls for this run. */
  maxCalls?: number;
  cacheDir: string;
  apiKey?: string;
  /** Listed accounts: reaching one stops the search early (taint found). */
  seeds?: Set<string>;
  /** Min spacing between uncached calls (ms). */
  spacingMs?: number;
  log?: (msg: string) => void;
};

class BudgetExceeded extends Error {}

/** Cached, throttled, retrying NearBlocks client. */
export class NearBlocks {
  calls = 0;
  cacheHits = 0;
  private last = 0;
  constructor(private opts: Required<Pick<FetchOptions, "cacheDir" | "maxCalls" | "spacingMs">> & { apiKey?: string; log: (m: string) => void }) {}

  async get<T = unknown>(pathAndQuery: string): Promise<T> {
    const key = createHash("sha256").update(pathAndQuery).digest("hex").slice(0, 32);
    const file = path.join(this.opts.cacheDir, `${key}.json`);
    try {
      const cached = JSON.parse(await readFile(file, "utf8")) as { url: string; body: T };
      this.cacheHits++;
      return cached.body;
    } catch {
      // not cached
    }
    if (this.calls >= this.opts.maxCalls) throw new BudgetExceeded(`API budget of ${this.opts.maxCalls} calls used`);
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + this.opts.spacingMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      this.calls++;
      const res = await fetch(NEARBLOCKS + pathAndQuery, {
        headers: this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {},
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
      const limited = res.status === 429 || (body && typeof body.message === "string" && /request limit/i.test(body.message));
      if (limited && attempt < 4) {
        const backoff = 15_000 * 2 ** attempt;
        this.opts.log(`  rate limited; retrying in ${backoff / 1000}s`);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      if (!res.ok || limited || body === null) throw new Error(`NearBlocks ${res.status} for ${pathAndQuery}: ${JSON.stringify(body)?.slice(0, 200)}`);
      try {
        await mkdir(this.opts.cacheDir, { recursive: true });
        await writeFile(file, JSON.stringify({ url: pathAndQuery, fetched_at: new Date().toISOString(), body }));
      } catch {
        // read-only filesystem (e.g. serverless): run uncached
      }
      return body;
    }
  }
}

type Receipt = {
  predecessor_account_id: string;
  receiver_account_id: string;
  transaction_hash: string;
  receipt_id: string;
  included_in_block_timestamp?: string;
  block?: { block_timestamp?: string };
  actions?: { action: string; method: string | null; args?: unknown }[];
  actions_agg?: { deposit?: string };
  outcome?: { status?: boolean; logs?: string[] };
  receipts?: Receipt[];
};
type Page<T> = { data: T[] | null; meta?: { next_page?: string | null } };

const ts = (r: Receipt) => r.included_in_block_timestamp ?? r.block?.block_timestamp ?? "0";

/** Parse every Ref v2 swap executed in a transaction's receipt tree. */
export function parseRefSwaps(root: Receipt, txHash: string): Omit<SwapEdge, "account">[] {
  const out: Omit<SwapEdge, "account">[] = [];
  const walk = (r: Receipt) => {
    if (r.receiver_account_id === REF && r.outcome?.status !== false) {
      const logs = r.outcome?.logs ?? [];
      const swaps = logs
        .map((l) => /^Swapped (\d+) (\S+) for (\d+) (\S+)$/.exec(l))
        .filter((m): m is RegExpExecArray => m !== null);
      if (swaps.length) {
        // pool ids appear in the actions msg of this same receipt, in order
        const argText = JSON.stringify(r.actions ?? []).replace(/\\/g, "");
        const pools = [...argText.matchAll(/"pool_id":(\d+)/g)].map((m) => Number(m[1]));
        swaps.forEach((m, i) => {
          if (pools[i] === undefined) return; // can't attribute a pool: skip, never guess
          out.push({
            kind: "swap",
            venue: REF,
            pool_id: pools[i],
            token_in: m[2],
            amount_in: m[1],
            token_out: m[4],
            amount_out: m[3],
            tx_hash: txHash,
            timestamp: ts(r),
          });
        });
      }
    }
    for (const c of r.receipts ?? []) walk(c);
  };
  walk(root);
  return out;
}

/**
 * Breadth-first backward fetch from `subject`, up to `maxHops` links.
 * Each account is listed only before the time its funds moved on (so a
 * laundering hop's later activity is not fetched).
 */
export async function fetchHistory(subject: string, opts: FetchOptions): Promise<History> {
  const maxHops = opts.maxHops ?? DEFAULT_MAX_HOPS;
  const log = opts.log ?? (() => {});
  const nb = new NearBlocks({
    cacheDir: opts.cacheDir,
    maxCalls: opts.maxCalls ?? 120,
    spacingMs: opts.spacingMs ?? (opts.apiKey ? 1000 : 6500),
    apiKey: opts.apiKey,
    log,
  });
  const seeds = opts.seeds ?? new Set<string>();
  const edges = new Map<string, Edge>(); // de-duplicated by a stable key
  const expanded = new Set<string>();
  const incomplete: History["incomplete"] = [];
  const signers = new Map<string, string>(); // tx_hash -> signer
  const tokenCreated = new Map<string, string | null>();

  const addEdge = (e: Edge) => {
    const k = e.kind === "transfer" ? `t:${e.tx_hash}:${e.from}:${e.to}:${e.amount}` : `s:${e.tx_hash}:${e.pool_id}:${e.token_in}:${e.amount_in}`;
    edges.set(k, e);
  };

  async function swapsOf(tx: string): Promise<SwapEdge[]> {
    const r = await nb.get<{ data: Receipt }>(`/txns/${tx}/receipts`);
    signers.set(tx, r.data.predecessor_account_id);
    return parseRefSwaps(r.data, tx).map((s) => ({ ...s, account: r.data.predecessor_account_id }));
  }
  async function createdAt(token: string): Promise<string | null> {
    if (!tokenCreated.has(token)) {
      const r = await nb.get<{ data: { created?: { block_timestamp?: string } } }>(`/accounts/${token}`);
      tokenCreated.set(token, r.data?.created?.block_timestamp ?? null);
    }
    return tokenCreated.get(token)!;
  }

  // queue entries: account, depth, and the time bound (only inflows before it matter)
  type Item = { account: string; depth: number; before: bigint | null };
  const queue: Item[] = [{ account: subject, depth: 0, before: null }];
  const seen = new Map<string, bigint | null>(); // account -> widest bound already fetched

  try {
    while (queue.length) {
      const { account, depth, before } = queue.shift()!;
      const prev = seen.get(account);
      if (prev !== undefined && (prev === null || (before !== null && before <= prev))) continue;
      seen.set(account, before);

      if (seeds.has(account)) {
        log(`  reached listed account ${account} at depth ${depth}; stopping`);
        expanded.add(account);
        break; // taint found: the checker rejects regardless of what else is unlisted
      }
      if (HUBS.has(account) || depth >= maxHops) continue;
      log(`  [hop ${depth}] listing inflows of ${account}${before ? ` before ${new Date(Number(before / 1_000_000n)).toISOString()}` : ""}`);

      let cursor: string | undefined;
      let pages = 0;
      let complete = true;
      for (;;) {
        const q = new URLSearchParams({ limit: String(RECEIPT_PAGE) });
        if (before !== null) q.set("before_ts", before.toString());
        if (cursor) q.set("next", cursor);
        const page = await nb.get<Page<Receipt>>(`/accounts/${account}/receipts?${q}`);
        pages++;
        for (const r of page.data ?? []) {
          const deposit = BigInt(r.actions_agg?.deposit ?? "0");
          const isTransfer = (r.actions ?? []).some((a) => a.action === "TRANSFER");
          if (!isTransfer || deposit < DUST_YOCTO || r.outcome?.status === false) continue;
          const t = BigInt(ts(r));
          if (before !== null && t >= before) continue;
          const from = r.predecessor_account_id;
          const to = r.receiver_account_id;

          if (from === account && depth === 0 && to !== account) {
            // the subject's own outflows: direct counterparties (list_hit check)
            addEdge({ kind: "transfer", from, to, amount: deposit.toString(), token: "NEAR", tx_hash: r.transaction_hash, timestamp: t.toString() });
            continue;
          }
          if (to !== account || from === account || from === "system") continue;

          if (DEX_PAYERS.has(from)) {
            // swap proceeds: parse the swap(s) this account made in that tx
            const swaps = (await swapsOf(r.transaction_hash)).filter((s) => s.account === account && s.token_out === WNEAR);
            if (!swaps.length) {
              incomplete.push({ account, reason: `unparsed DEX payout from ${from} in ${r.transaction_hash}` });
              complete = false;
              continue;
            }
            for (const s of swaps) {
              const created = await createdAt(s.token_in);
              const swap: SwapEdge = created ? { ...s, token_created_at: created } : s;
              addEdge(swap);
              const fresh = created !== null && BigInt(s.timestamp) - BigInt(created) < BigInt(FRESH_TOKEN_DAYS * 86400) * NS;
              if (!fresh) continue; // established pool: no counterparty search (documented)
              for (const cp of await poolWindow(swap)) {
                addEdge(cp);
                queue.push({ account: cp.account, depth: depth + 1, before: BigInt(cp.timestamp) });
              }
            }
            continue;
          }
          if (HUBS.has(from)) {
            incomplete.push({ account, reason: `inflow from ${from} cannot be attributed (tx ${r.transaction_hash})` });
            complete = false;
            continue;
          }
          addEdge({ kind: "transfer", from, to, amount: deposit.toString(), token: "NEAR", tx_hash: r.transaction_hash, timestamp: t.toString() });
          queue.push({ account: from, depth: depth + 1, before: t });
        }
        cursor = page.meta?.next_page ?? undefined;
        if (!cursor) break;
        if (pages >= MAX_RECEIPT_PAGES) {
          incomplete.push({ account, reason: `more than ${MAX_RECEIPT_PAGES * RECEIPT_PAGE} receipts` });
          complete = false;
          break;
        }
      }
      if (complete) expanded.add(account);
    }
  } catch (err) {
    if (!(err instanceof BudgetExceeded)) throw err;
    incomplete.push({ account: subject, reason: err.message });
    log(`  ${err.message}; stopping (result is incomplete)`);
  }
  // anything still queued was never listed
  for (const q of queue) if (!expanded.has(q.account) && !HUBS.has(q.account) && q.depth < maxHops && !seeds.has(q.account)) {
    incomplete.push({ account: q.account, reason: "not fetched (search stopped)" });
  }

  /** Swaps INTO the same pool (opposite direction) shortly before `out`. */
  async function poolWindow(out: SwapEdge): Promise<SwapEdge[]> {
    const token = out.token_in; // the memecoin the seller deposited
    const end = BigInt(out.timestamp);
    const start = end - BigInt(POOL_WINDOW_S) * NS;
    const q = new URLSearchParams({ limit: "50", before_ts: end.toString() });
    const page = await nb.get<Page<{ affected_account_id: string; involved_account_id: string; delta_amount: string; block_timestamp: string; transaction_hash: string }>>(`/fts/${token}/txns?${q}`);
    const rows = page.data ?? [];
    if (rows.length === 50 && BigInt(rows[rows.length - 1].block_timestamp) > start) {
      incomplete.push({ account: out.account, reason: `pool ${out.pool_id} window has more than 50 events` });
    }
    const txs = new Set(
      rows
        // This endpoint lists the receiving side of each transfer: token that
        // left the pool shows up as a row whose sender (`involved`) is the pool.
        .filter((e) => e.involved_account_id === REF && e.affected_account_id !== REF && BigInt(e.block_timestamp) >= start && e.transaction_hash !== out.tx_hash)
        .map((e) => e.transaction_hash),
    );
    const found: SwapEdge[] = [];
    for (const tx of [...txs].sort()) {
      for (const s of await swapsOf(tx)) {
        if (s.pool_id === out.pool_id && s.token_in === out.token_out && s.token_out === out.token_in && BigInt(s.timestamp) <= end) {
          found.push(out.token_created_at ? { ...s, token_created_at: out.token_created_at } : s);
        }
      }
    }
    return found;
  }

  const list = [...edges.values()].sort((a, b) => (a.timestamp === b.timestamp ? a.tx_hash.localeCompare(b.tx_hash) : BigInt(a.timestamp) < BigInt(b.timestamp) ? -1 : 1));
  log(`  done: ${list.length} edges, ${expanded.size} accounts fully listed, ${incomplete.length} incomplete notes, ${nb.calls} API calls, ${nb.cacheHits} cache hits`);
  return {
    version: 1,
    subject,
    network: "mainnet",
    source: "nearblocks-v3",
    fetched_at: new Date().toISOString(),
    max_hops: maxHops,
    expanded: [...expanded].sort(),
    incomplete,
    edges: list,
  };
}

/** NEAR account ids from the checker's pinned lists (EVM entries ignored). */
export function seedsFromLists(texts: string[]): Set<string> {
  const s = new Set<string>();
  for (const t of texts)
    for (const raw of t.split("\n")) {
      const line = raw.trim().toLowerCase();
      if (!line || line.startsWith("#")) continue;
      if (/^[0-9a-f]{64}$/.test(line) || /^[a-z0-9._-]+\.(near|testnet)$/.test(line)) s.add(line);
    }
  return s;
}
