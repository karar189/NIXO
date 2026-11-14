// Same-origin proxy (app/api/agents/[...path]); the agents' address is the
// server-side AGENTS_API_URL setting, never baked into the browser bundle.
const AGENTS_URL = "/api/agents";

export type Side = "LONG" | "SHORT";
export type RiskProfile = "conservative" | "moderate" | "aggressive";
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h";

export type Market = {
  symbol: string;
  name: string;
  pair: string;
  tvSymbol: string;
  intentsAsset: string;
  decimals: number;
  liveAsset: string | null;
  liveContract: string | null;
  liveEnabled: boolean;
  maxLeverage: number;
};

export type Ticker = { symbol: string; price: number; change_pct: number; high: number; low: number; quote_volume: number };

export type SessionConfig = {
  symbol: string;
  amount_usdc: number;
  leverage: number;
  timeframe: Timeframe;
  risk_profile: RiskProfile;
  tp_sl_mode: "dynamic" | "fixed";
  tp_pct: number | null;
  sl_pct: number | null;
  risk_sizing_mode: "fixed" | "kelly" | "vol_scaling";
  poll_seconds: number;
  supervisor_interval_seconds: number;
  llm_provider: LlmChoice;
  llm_model?: string | null;
  indicators: string[];
};

export type LlmProviderName = "anthropic" | "openai" | "deepseek" | "nvidia" | "nearai";
export type LlmChoice = "auto" | "rules" | "claude" | LlmProviderName;

export type LlmProvider = {
  name: LlmProviderName;
  label: string;
  configured: boolean;
  default_model: string;
  /** Set while "auto" skips this provider after an auth/quota failure. */
  cooldown: string | null;
};

export type PlannerInfo = {
  llm_available: boolean;
  provider: LlmProviderName | null;
  model: string | null;
  providers: LlmProvider[];
};

export type LlmAttempt = { provider: string; model: string | null; error: string | null; kind: string; latency_ms?: number };

export type PingResult = {
  provider: string;
  model: string | null;
  ok: boolean;
  latency_ms?: number;
  kind?: string;
  error?: string;
};

export const PROVIDER_SHORT: Record<string, string> = {
  anthropic: "Claude",
  claude: "Claude",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  nvidia: "NVIDIA",
  nearai: "NEAR AI",
  rules: "rules",
};

export type StrategyPlan = { strategy: string; lookback: number; threshold: number; max_loss_pct: number };

export type RegimeSummary = {
  symbol: string;
  timeframe: string;
  bar_count: number;
  last_price: number;
  change_24h_pct: number | null;
  atr: number | null;
  atr_pct: number | null;
  realized_vol_recent: number | null;
  realized_vol_medium: number | null;
  vol_ratio: number | null;
  adx: number | null;
  ma_slope: number | null;
  range_compression: boolean;
  range_expansion: boolean;
};

export type Analysis = {
  plan_id: string;
  symbol: string;
  timeframe: string;
  bar_count: number;
  market_regime_summary: RegimeSummary;
  strategy_shortlist: string[];
  strategy_plan: StrategyPlan;
  analysis_paragraph: string;
  quant_algo_description: string;
  /** "rules" or the provider that produced the plan. */
  planner: string;
  planner_model: string | null;
  planner_note: string | null;
  planner_attempts: LlmAttempt[];
};

export type Fill = {
  price: number;
  qty: number;
  usdc: number;
  reference_price: number;
  source: "intents" | "reference";
  slippage_bps: number;
  correlation_id: string | null;
  signature: string | null;
  time_estimate_s: number | null;
  note: string | null;
};

export type Position = {
  side: Side;
  margin: number;
  leverage: number;
  qty: number;
  entry_price: number;
  entry_usdc: number;
  tp_price: number | null;
  sl_price: number | null;
  liq_price: number | null;
  entry_fill: Fill;
  opened_at: number;
  strategy: string | null;
  notional: number;
  mark_price?: number;
  unrealized_pnl?: number;
  roe_pct?: number;
};

export type SessionStatus = {
  running: boolean;
  session: null | {
    id: string;
    mode: "agent" | "manual";
    symbol: string;
    pair: string;
    started_at: number;
    paused: boolean;
    ended_reason: string | null;
    last_price: number | null;
    last_action: string | null;
    last_reason: string | null;
    last_signal: number | null;
    config: SessionConfig;
    strategy: StrategyPlan | null;
    planner: string | null;
    planner_model: string | null;
    position: Position | null;
  };
};

export type LogEntry = { ts: string; level: string; message: string };

export type Statistics = {
  total_pnl: number;
  unrealized_pnl: number;
  total_trades: number;
  win_rate: number;
  avg_profit: number;
  avg_loss: number;
  avg_slippage_bps: number | null;
  intents_fills: number;
  lifetime_pnl: number;
  lifetime_trades: number;
};

export type Decision = {
  id: string;
  ts: string;
  action: string;
  status: "filled" | "rejected";
  reason?: string;
  price?: number;
  fill?: Fill;
  pnl?: number;
  size_usdc?: number;
};

export type Trade = {
  id: string;
  symbol: string;
  side: Side;
  strategy: string | null;
  leverage: number;
  margin: number;
  notional: number;
  entry_price: number;
  exit_price: number;
  pnl: number;
  roe_pct: number;
  close_reason: string;
  opened_at: number;
  closed_at: number;
  entry_fill: Fill;
  exit_fill: Fill;
};

export type ManualOrder = {
  symbol: string;
  side: Side;
  amount_usdc: number;
  leverage: number;
  tp_mode: "price" | "pct" | "none";
  tp: number | null;
  sl_mode: "price" | "pct" | "none";
  sl: number | null;
};

export type IntentsQuote = {
  quote: {
    amountIn: string;
    amountInFormatted: string;
    amountInUsd: string;
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd: string;
    minAmountOut: string;
    timeEstimate: number;
    depositAddress?: string;
    depositMemo?: string;
    deadline?: string;
  };
  quoteRequest: { slippageTolerance: number; deadline: string };
  signature: string;
  correlationId: string;
  timestamp: string;
};

export type SwapStatus =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "INCOMPLETE_DEPOSIT"
  | "REFUNDED"
  | "FAILED";

export type IntentsStatus = {
  status: SwapStatus;
  updatedAt?: string;
  swapDetails?: {
    amountInFormatted?: string;
    amountOutFormatted?: string;
    refundedAmountFormatted?: string;
    nearTxHashes?: string[];
    originChainTxHashes?: { hash: string; explorerUrl: string }[];
    destinationChainTxHashes?: { hash: string; explorerUrl: string }[];
  };
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit & { account?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.account) headers["X-Near-Account"] = init.account;
  let res: Response;
  try {
    res = await fetch(`${AGENTS_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } });
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

const post = <T>(path: string, account: string | undefined, body?: unknown) =>
  call<T>(path, { method: "POST", account, body: body === undefined ? undefined : JSON.stringify(body) });

export const tradingApi = {
  markets: () => call<Market[]>("/trade/markets"),
  ticker: (symbol: string) => call<Ticker>(`/trade/ticker/${symbol}`),
  planner: () => call<PlannerInfo>("/trade/planner"),
  preview: (symbol: string, side: Side, notional_usdc: number) =>
    post<{ mark: number; fill: Fill }>("/trade/preview", undefined, { symbol, side, notional_usdc }),
  analyze: (account: string, cfg: SessionConfig) => post<Analysis>("/trade/analyze", account, cfg),
  start: (account: string, config: SessionConfig, plan_id: string | null) =>
    post<SessionStatus>("/trade/start", account, { config, plan_id }),
  manual: (account: string, order: ManualOrder) => post<SessionStatus>("/trade/manual", account, order),
  stop: (account: string, closePosition = true) =>
    post<SessionStatus>(`/trade/stop?close_position=${closePosition}`, account),
  pause: (account: string) => post<SessionStatus>("/trade/pause", account),
  resume: (account: string) => post<SessionStatus>("/trade/resume", account),
  status: (account: string) => call<SessionStatus>("/trade/status", { account }),
  logs: (account: string) => call<{ logs: LogEntry[] }>("/trade/logs?limit=200", { account }),
  statistics: (account: string) => call<Statistics>("/trade/statistics", { account }),
  history: (account: string) => call<{ decisions: Decision[]; trades: Trade[] }>("/trade/history?limit=100", { account }),
};

export const llmApi = {
  providers: () => call<{ order: string[]; providers: LlmProvider[] }>("/llm/providers"),
  models: (provider: string) =>
    call<{ provider: string; default_model: string; models: string[] }>(`/llm/models/${encodeURIComponent(provider)}`),
  ping: (provider: string, model?: string | null) => post<PingResult>("/llm/ping", undefined, { provider, model: model || null }),
};

export const intentsApi = {
  quote: (body: {
    dry: boolean;
    origin_asset: string;
    destination_asset: string;
    amount: string;
    account_id: string;
    slippage_bps: number;
    confidentiality?: "public" | "basic" | "advanced";
  }) =>
    post<IntentsQuote>("/intents/quote", undefined, {
      confidentiality: "basic",
      ...body,
    }),
  submitDeposit: (deposit_address: string, tx_hash: string, near_sender_account: string) =>
    post<unknown>("/intents/deposit", undefined, { deposit_address, tx_hash, near_sender_account }),
  status: (depositAddress: string) =>
    call<IntentsStatus>(`/intents/status?depositAddress=${encodeURIComponent(depositAddress)}`),
};

export const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const USDC_CONTRACT = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const USDC_DECIMALS = 6;

export const INDICATORS = ["RSI", "MACD", "BB", "EMA", "SMA", "VWAP", "ATR", "OBV"] as const;
