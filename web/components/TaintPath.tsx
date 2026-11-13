import { MAINNET_EXPLORER, SEED_LABELS } from "@/lib/config";

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

const short = (a: string) => (/^[0-9a-f]{64}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const tokenName = (t: string) => (t === "wrap.near" || t === "NEAR" ? "NEAR" : t.split(".")[0].split("-")[0].toUpperCase());
const date = (ns: string) => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString().replace("T", " ").slice(0, 19) + " UTC";

/** yocto (24 decimals) to a readable NEAR amount. */
function near(yocto: string) {
  const v = BigInt(yocto);
  const whole = v / 10n ** 24n;
  const frac = (v % 10n ** 24n) / 10n ** 22n; // 2 decimals
  return `${whole.toLocaleString("en-US")}.${frac.toString().padStart(2, "0")}`;
}

function Node({ account, kind }: { account: string; kind: "seed" | "mid" | "subject" }) {
  const seed = kind === "seed" ? SEED_LABELS[account] : undefined;
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${kind === "seed" ? "border-reject bg-reject-bg" : kind === "subject" ? "border-foreground/30 bg-surface" : "border-border bg-surface"}`}
    >
      <a href={`${MAINNET_EXPLORER}/address/${account}`} target="_blank" rel="noreferrer" className="font-mono text-sm hover:underline" title={account}>
        {short(account)}
      </a>
      {kind === "seed" && <span className="ml-2 rounded bg-reject px-1.5 py-0.5 text-[11px] font-medium text-white dark:text-black">listed</span>}
      {kind === "subject" && <span className="ml-2 text-xs text-muted">checked account</span>}
      {seed && (
        <div className="mt-1 text-xs">
          <div className="font-medium text-reject">{seed.label}</div>
          <div className="text-muted">{seed.caveat}</div>
        </div>
      )}
    </div>
  );
}

function Link({ hop, i }: { hop: Hop; i: number }) {
  const tx = (h: string, label: string) => (
    <a key={h} href={`${MAINNET_EXPLORER}/txns/${h}`} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline" title={h}>
      {label} {h.slice(0, 8)}…
    </a>
  );
  return (
    <div className="ml-4 border-l-2 border-dashed border-border py-2 pl-4 text-sm">
      <div className="text-xs text-muted">hop {i + 1}</div>
      {hop.kind === "transfer" ? (
        <div>
          sent <span className="font-semibold">{near(hop.amount)} {tokenName(hop.token)}</span> · {tx(hop.tx_hashes[0], "tx")}
        </div>
      ) : (
        <div className="space-y-1">
          <div>
            linked through <span className="font-semibold">{tokenName(hop.pool_token ?? "")} pool {hop.pool_id}</span> (swap in, swap out{" "}
            {hop.seconds_apart} s apart)
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {tx(hop.tx_hashes[0], "swap in")}
            {tx(hop.tx_hashes[1], "swap out")}
            <span className="text-muted">
              {near(hop.amount)} NEAR out · amounts within {((hop.amount_diff_bps ?? 0) / 100).toFixed(2)}%
            </span>
            {hop.fresh_token && <span className="rounded bg-mock-bg px-1.5 text-mock">fresh token (&lt; 7 days old)</span>}
            {hop.weak && <span className="rounded bg-mock-bg px-1.5 text-mock">weak link (amounts at edge of ±15%)</span>}
          </div>
        </div>
      )}
      <div className="text-xs text-muted">{date(hop.timestamp)}</div>
    </div>
  );
}

/** A taint path, listed address first, checked account last. */
export function TaintPath({ path }: { path: Hop[] }) {
  if (!path.length) return null;
  return (
    <div>
      <Node account={path[0].from} kind="seed" />
      {path.map((hop, i) => (
        <div key={i}>
          <Link hop={hop} i={i} />
          <Node account={hop.to} kind={i === path.length - 1 ? "subject" : "mid"} />
        </div>
      ))}
    </div>
  );
}
