// Derives chart data from a run report + its audit trail. Pure functions, no React.
import type { AgentId, AuditEvent, RunReport } from "@/lib/nixo/experiment";

// ---------------------------------------------------------------- vault gates

/** The vault's checks, in the order it runs them (agents/app/nixo/vault.py check_request). */
export const GATES = [
  { id: "replay", label: "Replay guard", blurb: "Each request id can be used once.", codes: ["REPLAY_DETECTED"] },
  { id: "live", label: "Assignment live", blurb: "Assignment exists and isn't revoked.", codes: ["UNKNOWN_ASSIGNMENT", "ASSIGNMENT_REVOKED", "ASSIGNMENT_INACTIVE"] },
  { id: "frozen", label: "Fail-closed", blurb: "Frozen after an unexpected execution result.", codes: ["FAIL_CLOSED"] },
  { id: "identity", label: "Agent identity", blurb: "Only the assigned agent may use it.", codes: ["AGENT_MISMATCH"] },
  { id: "action", label: "Action allowed", blurb: "Swaps only; withdrawals blocked.", codes: ["WITHDRAWAL_NOT_ALLOWED", "ACTION_NOT_ALLOWED"] },
  { id: "chain", label: "Chain allowed", blurb: "Output only on allow-listed chains (chain read from the catalogue, not the request).", codes: ["CHAIN_NOT_ALLOWED"] },
  { id: "asset", label: "Token allowed", blurb: "Only allow-listed tokens.", codes: ["ASSET_NOT_ALLOWED", "INVALID_REQUEST"] },
  { id: "recipient", label: "Recipient pinned", blurb: "Output stays in the vault or goes to the owner's pinned address.", codes: ["RECIPIENT_NOT_ALLOWED"] },
  { id: "pertrade", label: "Per-trade cap", blurb: "No single trade above the limit.", codes: ["INVALID_AMOUNT", "MAX_TRADE_EXCEEDED"] },
  { id: "total", label: "Total budget", blurb: "Cumulative spend within budget.", codes: ["TOTAL_SPEND_EXCEEDED", "ALLOCATION_EXCEEDED"] },
] as const;

export type GateId = (typeof GATES)[number]["id"];

export function gateFor(reason: string | null): GateId | null {
  if (!reason) return null;
  return GATES.find((g) => (g.codes as readonly string[]).includes(reason))?.id ?? "asset";
}

// ---------------------------------------------------------------- requests through the system

export type FlowRequest = {
  key: string; // unique per decision (a replayed request id appears twice)
  requestId: string;
  agent: AgentId; // whose path it takes: B = through the vault, A = straight to the venue
  claimedBy: string | null;
  phase: string | null;
  ts: number;
  action: string | null;
  amount: string | null;
  assetOut: string | null;
  recipient: string | null;
  /** B only: gate that stopped it (null = passed every gate). */
  stoppedAt: GateId | null;
  reason: string | null;
  outcome: "executed" | "blocked" | "failed" | "held";
};

/** One entry per vault decision (B) and per baseline execution (A), in time order. */
export function flowRequests(events: AuditEvent[]): FlowRequest[] {
  const byReq = new Map<string, AuditEvent[]>();
  for (const e of events) if (e.request_id) byReq.set(e.request_id, [...(byReq.get(e.request_id) ?? []), e]);
  const out: FlowRequest[] = [];

  for (const e of events) {
    const rid = e.request_id;
    if (!rid) continue;
    const later = byReq.get(rid) ?? [];
    if (e.source === "vault" && (e.event_type === "trade_authorized" || e.event_type === "trade_rejected" || e.event_type === "post_revoke_attempt_rejected")) {
      let outcome: FlowRequest["outcome"] = "blocked";
      if (e.event_type === "trade_authorized") {
        const after = later.filter((x) => x.timestamp >= e.timestamp && x.source === "adapter");
        outcome = after.some((x) => x.event_type === "trade_settled")
          ? "executed"
          : after.some((x) => x.event_type === "trade_held")
            ? "held"
            : after.some((x) => x.event_type === "trade_failed")
              ? "failed"
              : "executed";
      }
      out.push({
        key: e.event_id, requestId: rid, agent: "agent_b", claimedBy: e.agent_id, phase: e.phase, ts: e.timestamp,
        action: e.action, amount: e.amount_in, assetOut: e.asset_out, recipient: e.recipient ?? null,
        stoppedAt: e.event_type === "trade_authorized" ? null : gateFor(e.reason_code),
        reason: e.reason_code, outcome,
      });
    } else if (e.source === "adapter" && e.agent_id === "agent_a" && e.event_type === "trade_submitted") {
      const fin = later.find((x) => x.event_type === "trade_settled" || x.event_type === "trade_failed");
      out.push({
        key: e.event_id, requestId: rid, agent: "agent_a", claimedBy: "agent_a", phase: e.phase, ts: e.timestamp,
        action: e.action, amount: e.amount_in, assetOut: e.asset_out, recipient: e.recipient ?? null, stoppedAt: null,
        reason: fin?.reason_code ?? null, outcome: fin?.event_type === "trade_failed" ? "failed" : "executed",
      });
    }
  }
  return out.sort((a, b) => a.ts - b.ts || a.key.localeCompare(b.key));
}

export type GateStat = { id: GateId; label: string; blurb: string; reached: number; stopped: FlowRequest[] };

export function gateFunnel(reqs: FlowRequest[]): { gates: GateStat[]; passed: number; total: number } {
  const b = reqs.filter((r) => r.agent === "agent_b");
  let remaining = b.length;
  const gates = GATES.map((g) => {
    const stopped = b.filter((r) => r.stoppedAt === g.id);
    const stat = { id: g.id, label: g.label, blurb: g.blurb, reached: remaining, stopped };
    remaining -= stopped.length;
    return stat;
  });
  return { gates, passed: remaining, total: b.length };
}

// ---------------------------------------------------------------- task-phase series

export type StepPoint = {
  step: number;
  price: number | null;
  a: AgentStepPoint;
  b: AgentStepPoint;
};

export type AgentStepPoint = {
  asset: string | null; // SYMBOL@chain it tried to buy (null = hold)
  proposed: number; // USDC the agent asked for (0 = hold)
  executed: number; // USDC actually spent
  status: string; // executed | rejected | failed | held | held_by_agent | pending
  reason: string | null;
  cumulative: number;
  source: string | null;
};

/** Per-step series. `price` is the first task asset's price; use `priceOf` for any other asset. */
export function priceOf(r: RunReport, code: string, step: number): number | null {
  const v = r.market?.prices[code]?.[(r.market?.history ?? 0) + step - 1];
  return v !== undefined ? Number(v) : null;
}

export function stepSeries(r: RunReport): StepPoint[] {
  const prices = r.market?.prices[r.task_targets?.[0]?.asset ?? "NEAR@near"] ?? [];
  const hist = r.market?.history ?? 0;
  const n = Math.max(r.agents.agent_a.steps.length, r.agents.agent_b.steps.length);
  const cum = { agent_a: 0, agent_b: 0 };
  const out: StepPoint[] = [];
  for (let i = 0; i < n; i++) {
    const point = (id: AgentId): AgentStepPoint => {
      const s = r.agents[id].steps[i];
      if (!s) return { asset: null, proposed: 0, executed: 0, status: "pending", reason: null, cumulative: cum[id], source: null };
      const executed = s.outcome.status === "executed" ? Number(s.outcome.amount_in) : 0;
      cum[id] += executed;
      return {
        asset: s.proposal.action === "hold" ? null : s.proposal.asset_out,
        proposed: Number(s.proposal.amount_in) || 0, executed, status: s.outcome.status, reason: s.outcome.reason,
        cumulative: cum[id], source: s.proposal.source,
      };
    };
    const a = point("agent_a");
    const b = point("agent_b");
    out.push({ step: i + 1, price: prices[hist + i] !== undefined ? Number(prices[hist + i]) : null, a, b });
  }
  return out;
}

/** Same hostile requests sent to both agents (mirrored adversarial + post-revoke). */
export function mirroredAttacks(r: RunReport): { total: number; aExecuted: number; bExecuted: number } {
  const mirrored = r.adversarial.filter((t) => t.baseline);
  const aExecuted = mirrored.filter((t) => t.baseline?.status === "executed").length + (r.revocation?.agent_a.status === "executed" ? 1 : 0);
  const bExecuted = mirrored.filter((t) => !t.passed).length + (r.revocation && !r.revocation.passed ? 1 : 0);
  return { total: mirrored.length + (r.revocation ? 1 : 0), aExecuted, bExecuted };
}

export function reasonCounts(reqs: FlowRequest[]): { reason: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of reqs) if (r.agent === "agent_b" && r.outcome === "blocked" && r.reason) m.set(r.reason, (m.get(r.reason) ?? 0) + 1);
  return [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export const fmt = (n: number, dp = 2) => n.toLocaleString("en-US", { maximumFractionDigits: dp });

export const symbolOf = (code: string) => code.split("@")[0];
export const chainOf = (code: string) => (code.split("@")[1] ?? "").split(":")[0];
export const assetLabel = (code: string) => `${symbolOf(code)}${chainOf(code) !== "near" ? ` (${chainOf(code)})` : ""}`;
