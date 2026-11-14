// Client for the NIXO v0.1 two-agent run API (agents service, /nixo/*).
// Amounts are decimal strings: the service uses exact decimals, not floats.
import { ApiError, type LlmChoice } from "@/lib/trading/api";

const BASE = "/api/agents/nixo";

export type AgentId = "agent_a" | "agent_b";

/** SYMBOL@chain code from the NEAR Intents (1Click) catalogue, e.g. "ETH@eth", "USDC@near". */
export type AssetCode = string;
export const ALLOCATION_CODE = "USDC@near";

export type AssetInfo = {
  code: AssetCode;
  asset_id: string;
  symbol: string;
  chain: string;
  decimals: number;
  price: number | null;
  has_history: boolean;
};

export type Catalogue = {
  source: "1click" | "fallback";
  allocation: AssetCode;
  count: number;
  chains: { chain: string; assets: AssetInfo[] }[];
};

export type TargetLeg = { asset: AssetCode; usdc: string };

export type RunConfig = {
  allocation_usdc: string;
  task_targets: TargetLeg[];
  steps: number;
  max_trade_amount: string;
  max_total_spend: string;
  allowed_assets: AssetCode[];
  allowed_chains: string[];
  /** chain -> owner's pinned address; output to any other address is refused */
  recipients: Record<string, string>;
  market: "recorded" | "synthetic";
  llm_provider: LlmChoice;
  llm_model: string | null;
  fee_bps: number;
  run_adversarial: boolean;
  revoke_at_end: boolean;
};

export type DepositRecord = {
  deposit_id: string;
  owner: string;
  asset: string;
  amount: string;
  source_reference: string;
  deposited_at: number;
  verification_status: string;
  verification_method: string;
  record_version: number;
  allocated: string;
  is_stub: boolean;
};

export type Policy = {
  policy_id: string;
  agent_id: string;
  allowed_actions: string[];
  allowed_assets: string[];
  allowed_chains: string[];
  recipients: Record<string, string>;
  max_trade_amount: string;
  max_total_spend: string;
  withdrawals_allowed: boolean;
  enabled: boolean;
};

export type AssignmentView = {
  assignment_id: string;
  agent_id: string;
  deposit_id: string;
  allocated_amount: string;
  asset: string;
  status: "active" | "revoked";
  assigned_at: number;
  revoked_at: number | null;
  frozen_reason: string | null;
  policy: Policy;
  accounting: {
    reserved_amount: string;
    settled_spend: string;
    released_amount: string;
    held_amount: string;
    remaining: string;
  };
  holdings: Record<string, string>;
  delivered: Delivery[];
};

export type Delivery = { asset: AssetCode; amount: string; recipient: string; chain?: string | null; request_id: string };

export type WalletView = {
  agent_id: string;
  allocation_id: string;
  deposit_id: string;
  balances: Record<string, string>;
  withdrawn: { asset: string; amount: string; destination: string | null; request_id: string }[];
  delivered: Delivery[];
};

export type StepOutcome = {
  status: "executed" | "rejected" | "failed" | "held" | "held_by_agent";
  reason: string | null;
  message?: string | null;
  amount_in: string;
  amount_out: string;
  asset_out?: AssetCode | null;
  execution_reference?: string | null;
  price?: string | null;
  request_id?: string;
  event_ids?: string[];
  would_violate?: string | null;
};

export type AgentStep = {
  step: number;
  proposal: {
    action: "swap" | "hold";
    asset_in: string;
    amount_in: string;
    asset_out: string;
    rationale: string;
    source: string;
    latency_ms: number | null;
    note: string | null;
  };
  outcome: StepOutcome;
};

export type AgentMetrics = {
  task_completed: boolean;
  spent_usdc: string;
  target_usdc: string;
  starting_allocation: string;
  ending_balances: Record<string, string>;
  ending_value_usdc: string;
  trades_executed: number;
  rejected: number;
  failed: number;
  holds: number;
  would_violate_executed: number;
  per_asset: { asset: AssetCode; target_usdc: string; spent_usdc: string; done: boolean }[];
};

export type TradeRequest = {
  request_id: string;
  assignment_id: string;
  agent_id: string;
  action: string;
  asset_in: string;
  amount_in: string;
  asset_out: string | null;
  destination: string | null;
  recipient: string | null;
};

export type AdversarialTest = {
  id: string;
  name: string;
  plan_ref: string;
  expected: string;
  actual: string;
  passed: boolean;
  reason_code: string | null;
  requests: TradeRequest[];
  event_ids: string[];
  baseline: (StepOutcome & { request: TradeRequest }) | null;
  detail: string | null;
};

export type AuditEvent = {
  event_id: string;
  run_id: string;
  agent_id: string | null;
  assignment_id: string | null;
  deposit_id: string | null;
  event_type: string;
  request_id: string | null;
  action: string | null;
  asset_in: string | null;
  amount_in: string | null;
  asset_out: string | null;
  amount_out: string | null;
  recipient?: string | null;
  decision: string | null;
  reason_code: string | null;
  timestamp: number;
  execution_reference: string | null;
  source: string;
  phase: string | null;
  evidence: "service_log";
  detail: Record<string, unknown> | null;
};

export type RunSummary = {
  run_id: string;
  status: "pending" | "running" | "done" | "error";
  phase: "setup" | "task" | "adversarial" | "revocation" | "done";
  step: number;
  steps: number;
  started_at: number;
  finished_at: number | null;
  llm: { provider?: string; model?: string | null; label?: string; note?: string | null };
  adversarial_passed: number;
  adversarial_total: number;
};

export type ManualAttempt = {
  agent: AgentId;
  request: TradeRequest;
  outcome: StepOutcome;
  event_ids: string[];
  at: number;
};

export type RunReport = RunSummary & {
  owner: string;
  error: string | null;
  config: RunConfig;
  labels: Record<"execution" | "provenance" | "enforcement", string>;
  task: string;
  task_targets: TargetLeg[];
  allocation_asset: AssetCode;
  assets: Record<AssetCode, AssetInfo>;
  catalogue_source: "1click" | "fallback" | null;
  attack_assets: { unapproved: AssetCode | null; forbidden_chain: AssetCode | null };
  market: null | {
    source: "recorded" | "synthetic";
    timeframe: string;
    captured_at: number;
    history: number;
    note: string | null;
    prices: Record<AssetCode, string[]>;
    sources: Record<AssetCode, "binance_recorded" | "flat_1click" | "synthetic">;
    costs_bps: Record<AssetCode, string>;
    quotes: Record<AssetCode, { routable: boolean; amount_out?: number; cost_bps?: number | null; error?: string }>;
  };
  agents: {
    agent_a: {
      role: "baseline";
      deposit: DepositRecord | null;
      wallet: WalletView | null;
      mirror_wallet: WalletView | null;
      policy: null;
      steps: AgentStep[];
      metrics: AgentMetrics | null;
    };
    agent_b: {
      role: "constrained";
      deposit: DepositRecord | null;
      assignment: AssignmentView | null;
      policy: Policy | null;
      steps: AgentStep[];
      metrics: AgentMetrics | null;
    };
  };
  adversarial: AdversarialTest[];
  revocation: null | {
    assignment_id: string;
    revoked_at: number | null;
    post_revoke_request: TradeRequest;
    agent_b: { status: string; reason: string | null; event_ids: string[] };
    agent_a: StepOutcome & { request: TradeRequest };
    passed: boolean;
  };
  manual_attempts: ManualAttempt[];
  comparison: { metric: string; agent_a: string; agent_b: string }[];
  success_criteria: { criterion: string; met: boolean | null; detail?: string[] | null }[];
  audit_count: number;
};

async function call<T>(path: string, account: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", "X-Near-Account": account },
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Can't reach the web server's agents proxy.", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (body as { detail?: unknown } | null)?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? (detail as { msg?: string }[]).map((d) => d.msg).filter(Boolean).join("; ")
          : `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export const nixoApi = {
  assets: (account: string) => call<Catalogue>("/assets", account),
  defaults: (account: string) => call<{ config: RunConfig; labels: Record<string, string> }>("/defaults", account),
  start: (account: string, cfg: RunConfig) =>
    call<RunReport>("/runs", account, { method: "POST", body: JSON.stringify(cfg) }),
  list: (account: string) => call<{ runs: RunSummary[] }>("/runs", account),
  get: (account: string, runId: string) => call<RunReport>(`/runs/${runId}`, account),
  audit: (account: string, runId: string) =>
    call<{ run_id: string; labels: Record<string, string>; events: AuditEvent[] }>(`/runs/${runId}/audit`, account),
  revoke: (account: string, runId: string) => call<RunReport>(`/runs/${runId}/revoke`, account, { method: "POST" }),
  attempt: (
    account: string,
    runId: string,
    body: {
      agent: AgentId;
      action: "swap" | "withdraw";
      amount_in: string;
      asset_out: AssetCode | null;
      destination?: string | null;
      recipient?: string | null;
    },
  ) =>
    call<{ attempt: ManualAttempt; report: RunReport }>(`/runs/${runId}/attempt`, account, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
