"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeftRight, CandlestickChart } from "lucide-react";
import { LiveSwap } from "@/components/trade/LiveSwap";
import { tradingApi, type Market, type Ticker } from "@/lib/trading/api";
import { fmtPct, fmtPrice } from "@/lib/trading/format";

type Counter = "NEAR" | "USDC";

/**
 * Swap the selected market asset against NEAR or USDC from the user's wallet.
 * Confidential live settlement today is NEAR ↔ USDC; other desk symbols open
 * the Swap desk for paper/agent flow while still offering a NEAR/USDC live rail.
 */
export function AssetSwapPanel({
  symbol,
  liveEnabled,
  deskSymbol,
}: {
  symbol: string;
  liveEnabled: boolean;
  deskSymbol: string | null;
}) {
  const upper = symbol.toUpperCase();
  const isNearFamily = upper === "NEAR" || upper === "USDC";
  const [counter, setCounter] = useState<Counter>(upper === "USDC" ? "NEAR" : "USDC");
  const [markets, setMarkets] = useState<Market[]>([]);
  const [ticker, setTicker] = useState<Ticker | null>(null);

  useEffect(() => {
    tradingApi.markets().then(setMarkets).catch(() => setMarkets([]));
  }, []);

  const nearMarket = markets.find((m) => m.symbol === "NEAR") ?? null;
  const deskMarket = markets.find((m) => m.symbol === (deskSymbol ?? upper)) ?? null;
  const trackSymbol = isNearFamily ? "NEAR" : deskMarket?.symbol ?? "NEAR";

  useEffect(() => {
    let stop = false;
    const load = () =>
      tradingApi
        .ticker(trackSymbol)
        .then((t) => !stop && setTicker(t))
        .catch(() => {});
    void load();
    const id = setInterval(load, 8_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [trackSymbol]);

  // Viewing NEAR or USDC → live confidential swap against the other.
  if (isNearFamily && nearMarket) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="kicker !text-[10px]">Confidential Intents</p>
            <h2 className="display mt-1 text-lg">
              {upper === "NEAR" ? "NEAR ↔ USDC" : "USDC ↔ NEAR"}
            </h2>
          </div>
          {ticker && (
            <div className="text-right">
              <p className="font-mono text-sm">{fmtPrice(ticker.price)}</p>
              <p className={`font-mono text-[11px] ${ticker.change_pct >= 0 ? "text-accent" : "text-danger"}`}>
                {fmtPct(ticker.change_pct)}
              </p>
            </div>
          )}
        </div>
        <p className="text-xs leading-5 text-muted">
          Swap with the <span className="text-foreground">NEAR</span> and{" "}
          <span className="text-foreground">USDC</span> held in your connected wallet. Settlement uses
          Confidential Intents on mainnet.
        </p>
        <LiveSwap market={nearMarket} markPrice={ticker?.price ?? null} />
      </div>
    );
  }

  const counters: Counter[] = ["USDC", "NEAR"];

  return (
    <div className="space-y-4">
      <div>
        <p className="kicker !text-[10px]">Swap · {upper}</p>
        <h2 className="display mt-1 text-lg">Trade with NEAR / USDC</h2>
        <p className="mt-2 text-xs leading-5 text-muted">
          Choose which wallet asset to use against <span className="text-foreground">{upper}</span>.
          Live confidential deposits settle as NEAR ↔ USDC; desk markets open paper / agent flow for{" "}
          {upper}/USDC.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-background p-1" role="radiogroup" aria-label="Counter asset">
        {counters.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={counter === c}
            onClick={() => setCounter(c)}
            className={`rounded-lg py-2 text-sm font-medium ${
              counter === c ? "bg-accent text-accent-ink" : "text-muted hover:text-foreground"
            }`}
          >
            Use {c}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-background/50 p-3 text-xs leading-5 text-muted">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <ArrowLeftRight className="size-3.5 text-accent-2" />
          {upper} ↔ {counter}
        </p>
        <p className="mt-1.5">
          {liveEnabled
            ? "Live wallet swap is available for this rail."
            : deskMarket
              ? `${upper} is on the NIXO desk. Open Swap for paper quotes priced with Confidential Intents dry quotes, or settle live NEAR/USDC from the panel below.`
              : `${upper} is tracked for market data. Confidential live settlement currently supports NEAR ↔ USDC from your wallet.`}
        </p>
      </div>

      {deskMarket && (
        <Link
          href={`/dashboard/trade`}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-line bg-surface-2 py-2.5 text-sm font-medium hover:border-accent/40"
        >
          <CandlestickChart className="size-4 text-accent" />
          Open {deskMarket.pair} on Swap desk
        </Link>
      )}

      {nearMarket && (
        <div className="space-y-3 border-t border-line pt-4">
          <p className="text-[10px] uppercase tracking-wider text-muted">
            Your available NEAR assets · live {counter === "NEAR" || counter === "USDC" ? "NEAR ↔ USDC" : ""}
          </p>
          <LiveSwap market={nearMarket} markPrice={ticker?.symbol === "NEAR" ? ticker.price : null} />
        </div>
      )}
    </div>
  );
}
