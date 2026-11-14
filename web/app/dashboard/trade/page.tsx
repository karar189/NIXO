"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Settings2, Square } from "lucide-react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { TradingViewChart } from "@/components/trade/TradingViewChart";
import { AgentPanel } from "@/components/trade/AgentPanel";
import { PaperOrderForm } from "@/components/trade/PaperOrderForm";
import { LiveSwap } from "@/components/trade/LiveSwap";
import { AgentSetupModal, DEFAULT_CONFIG } from "@/components/trade/AgentSetupModal";
import { tradingApi, type Market, type SessionConfig, type Ticker } from "@/lib/trading/api";
import { useTradingSession } from "@/lib/trading/useTradingSession";
import { fmtPct, fmtPrice, fmtUsd, humanize, pnlTone } from "@/lib/trading/format";

export default function TradePage() {
  const { accountId, network } = useWallet();
  const account = accountId ?? "";
  const { status, logs, stats, error, refresh, running } = useTradingSession(accountId);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("NEAR");
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [config, setConfig] = useState<SessionConfig>(DEFAULT_CONFIG);
  const [setupOpen, setSetupOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"agent" | "order">("agent");
  const [orderMode, setOrderMode] = useState<"paper" | "live">("paper");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    tradingApi.markets().then(setMarkets).catch((e: Error) => setMarketsError(e.message));
  }, []);

  const session = status?.session ?? null;
  // While a session runs, the page follows its market.
  const activeSymbol = running && session ? session.symbol : symbol;
  const market = markets.find((m) => m.symbol === activeSymbol) ?? null;

  useEffect(() => {
    let stop = false;
    const load = () => tradingApi.ticker(activeSymbol).then((t) => !stop && setTicker(t)).catch(() => {});
    void load();
    const id = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [activeSymbol]);

  const price = (running && session?.last_price) || (ticker?.symbol === activeSymbol ? ticker.price : null);
  const position = running ? session?.position : null;

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setActionError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!accountId) return null;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-5 sm:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="display mr-1 text-lg">AI Trading</h1>
          {running && session ? (
            <>
              <span className="rounded-full border border-accent-2/40 bg-accent-2/10 px-2 py-0.5 font-mono text-[11px] text-accent-2">PAPER</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 px-2 py-0.5 text-[11px] text-accent">
                <span className={`h-1.5 w-1.5 rounded-full bg-accent ${session.paused ? "" : "animate-pulse"}`} />
                {session.paused ? "Paused" : session.mode === "agent" ? "Agent running" : "Position open"}
              </span>
              {session.strategy && (
                <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
                  {humanize(session.strategy.strategy)} · {session.planner === "claude" ? "Claude" : "rules"}
                </span>
              )}
            </>
          ) : (
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">Idle</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {running && session?.mode === "agent" && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => act(session.paused ? "Resuming…" : "Pausing…", () => (session.paused ? tradingApi.resume(account) : tradingApi.pause(account)))}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {session.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {session.paused ? "Resume" : "Pause"}
            </button>
          )}
          {running && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => act("Closing…", () => tradingApi.stop(account, true))}
              className="inline-flex items-center gap-1.5 rounded-full border border-danger/40 px-3 py-1.5 text-sm text-danger disabled:opacity-50"
            >
              <Square className="size-3.5" /> {session?.position ? "Close & stop" : "Stop"}
            </button>
          )}
          <button
            type="button"
            disabled={running || markets.length === 0}
            onClick={() => {
              setConfig((c) => ({ ...c, symbol: activeSymbol }));
              setSetupOpen(true);
            }}
            title={running ? "Stop the current session first" : undefined}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-background disabled:opacity-50"
          >
            <Settings2 className="size-3.5" /> Configure agent
          </button>
        </div>
      </div>

      {(error || marketsError || actionError) && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          {actionError ?? marketsError ?? error}
        </p>
      )}

      {/* Market strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-line bg-surface px-4 py-3">
        <label className="sr-only" htmlFor="market">Market</label>
        <select
          id="market"
          value={activeSymbol}
          disabled={running}
          onChange={(e) => setSymbol(e.target.value)}
          className="rounded-lg border border-line bg-background px-3 py-1.5 text-sm font-medium disabled:opacity-70"
        >
          {markets.map((m) => (
            <option key={m.symbol} value={m.symbol}>{m.pair}</option>
          ))}
        </select>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted">Price</p>
          <p className="font-mono text-lg">{fmtPrice(price)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted">24h</p>
          <p className={`font-mono text-sm ${pnlTone(ticker?.change_pct)}`}>{ticker?.symbol === activeSymbol ? fmtPct(ticker.change_pct) : "—"}</p>
        </div>
        <div className="hidden sm:block">
          <p className="text-[10px] uppercase tracking-wider text-muted">24h range</p>
          <p className="font-mono text-sm">{ticker?.symbol === activeSymbol ? `${fmtPrice(ticker.low)} – ${fmtPrice(ticker.high)}` : "—"}</p>
        </div>
        {position && (
          <>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted">Position</p>
              <p className={`font-mono text-sm ${position.side === "LONG" ? "text-accent" : "text-danger"}`}>
                {position.side} {position.leverage}x
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted">Unrealized P&amp;L</p>
              <p className={`font-mono text-sm ${pnlTone(position.unrealized_pnl)}`}>{fmtUsd(position.unrealized_pnl, true)}</p>
            </div>
          </>
        )}
        <span className="ml-auto hidden rounded-full border border-line px-2.5 py-1 text-[11px] text-muted md:inline">
          Fills priced by NEAR Intents · {network}
        </span>
      </div>

      {/* Chart + panel */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="h-[520px] xl:h-auto xl:min-h-[640px]">
          {market && (
            <TradingViewChart
              key={market.tvSymbol}
              symbol={market.tvSymbol}
              timeframe={running && session ? session.config.timeframe : config.timeframe}
              indicators={running && session ? session.config.indicators : config.indicators}
            />
          )}
        </div>

        <aside className="rounded-2xl border border-line bg-surface p-4">
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-line bg-background p-1" role="tablist">
            {(["agent", "order"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={rightTab === t}
                onClick={() => setRightTab(t)}
                className={`rounded-lg py-1.5 text-sm ${rightTab === t ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}
              >
                {t === "agent" ? "Agent" : "Order"}
              </button>
            ))}
          </div>

          {rightTab === "agent" ? (
            <AgentPanel account={account} status={status} logs={logs} stats={stats} />
          ) : (
            <div className="space-y-4">
              <div className="flex rounded-lg border border-line p-0.5 text-xs">
                {(["paper", "live"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={orderMode === m}
                    onClick={() => setOrderMode(m)}
                    className={`flex-1 rounded-md py-1.5 ${orderMode === m ? "bg-surface-2 text-foreground" : "text-muted"}`}
                  >
                    {m === "paper" ? "Paper (leverage)" : "Live (spot, mainnet)"}
                  </button>
                ))}
              </div>
              {!market ? (
                <p className="text-sm text-muted">Loading markets…</p>
              ) : orderMode === "paper" ? (
                running ? (
                  <p className="rounded-xl border border-line bg-background/50 p-4 text-sm text-muted">
                    A {session?.mode === "agent" ? "paper agent" : "paper position"} is running on {session?.pair}. Stop it to place a new paper order.
                  </p>
                ) : (
                  <PaperOrderForm
                    account={account}
                    market={market}
                    markPrice={price || null}
                    busy={busy}
                    onOpened={() => {
                      void refresh();
                      setRightTab("agent");
                    }}
                  />
                )
              ) : (
                <LiveSwap market={market} markPrice={price || null} />
              )}
            </div>
          )}
        </aside>
      </div>

      {setupOpen && (
        <AgentSetupModal
          open
          onClose={() => setSetupOpen(false)}
          account={account}
          markets={markets}
          initial={config}
          onStarted={(cfg) => {
            setConfig(cfg);
            setSymbol(cfg.symbol);
            setRightTab("agent");
            void refresh();
          }}
        />
      )}
    </div>
  );
}
