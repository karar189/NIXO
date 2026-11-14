/** Client for the agents service's /copy API (through the same-origin /api/agents proxy). */
import type { FeedEntry, WrappedKey } from "./crypto";
import type { Listing, Subscription } from "./sdk";

const BASE = "/api/agents/copy";

export type PublicStats = {
  total_pnl: number;
  total_margin: number;
  roe_pct: number;
  trades: number;
  wins: number;
  win_rate: number;
  avg_win: number;
  avg_loss: number;
  max_drawdown: number;
  first_trade_at: number | null;
  last_trade_at: number | null;
  equity: [number, number][];
};

export type TraderCard = {
  trader: string;
  demo: boolean;
  profile: { label: string; style: string } | null;
  listing: Listing | null;
  stats: PublicStats | null;
  listed?: boolean;
  chain_head: string;
  entry_count: number;
};

export type CopyConfig = { contract: string | null; epoch_secs: number; demo: boolean; scope: string };

export type MirrorConfig = {
  follower: string;
  trader: string;
  enabled: boolean;
  scale: number;
  max_margin_usdc: number;
  max_leverage: number;
  max_total_loss_usdc: number;
  realized_pnl: number;
  copies_opened: number;
  copies_closed: number;
  paused_reason: string | null;
  created_at: number;
};

export type MirrorLog = { ts: number; trader: string; level: string; message: string };

async function req<T>(path: string, init: RequestInit & { account?: string | null } = {}): Promise<T> {
  const { account, ...rest } = init;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    cache: "no-store",
    headers: { "content-type": "application/json", ...(account ? { "X-Near-Account": account } : {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (body as { detail?: unknown } | null)?.detail;
    throw new Error(typeof detail === "string" ? detail : `Request failed (${res.status})`);
  }
  return body as T;
}

export const copyApi = {
  config: () => req<CopyConfig>("/config"),
  leaderboard: () => req<{ contract: string | null; traders: TraderCard[] }>("/leaderboard"),
  trader: (trader: string) => req<TraderCard>(`/traders/${encodeURIComponent(trader)}`),
  entries: (trader: string) =>
    req<{ trader: string; chain_head: string; entry_count: number; entries: FeedEntry[] }>(
      `/traders/${encodeURIComponent(trader)}/entries?limit=500`,
    ),
  keys: (trader: string, follower: string) =>
    req<{ active: boolean; starts_at: number; expires_at: number; x25519_pub: string; keys: WrappedKey[] }>(
      `/keys/${encodeURIComponent(trader)}?follower=${encodeURIComponent(follower)}`,
    ),
  me: (account: string) => req<TraderCard & { subscribers: Subscription[] }>("/me", { account }),
  following: (account: string) => req<{ follower: string; subscriptions: Subscription[] }>("/following", { account }),
  mirror: (account: string) =>
    req<{ configs: MirrorConfig[]; log: MirrorLog[]; copying: [string, string] | null }>("/mirror", { account }),
  setMirror: (
    account: string,
    body: { trader: string; enabled: boolean; scale: number; max_margin_usdc: number; max_leverage: number; max_total_loss_usdc: number },
  ) => req<{ config: MirrorConfig }>("/mirror", { method: "POST", account, body: JSON.stringify(body) }),
};
