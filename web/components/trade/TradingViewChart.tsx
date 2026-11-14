"use client";

import { useEffect, useId, useRef } from "react";

declare global {
  interface Window {
    TradingView?: { widget: new (config: Record<string, unknown>) => unknown };
  }
}

const TV_SCRIPT = "https://s3.tradingview.com/tv.js";

const STUDIES: Record<string, string> = {
  RSI: "RSI@tv-basicstudies",
  MACD: "MACD@tv-basicstudies",
  BB: "BB@tv-basicstudies",
  EMA: "MAExp@tv-basicstudies",
  SMA: "MASimple@tv-basicstudies",
  VWAP: "VWAP@tv-basicstudies",
  ATR: "ATR@tv-basicstudies",
  OBV: "OBV@tv-basicstudies",
};

const INTERVALS: Record<string, string> = { "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240" };

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.TradingView) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = TV_SCRIPT;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptPromise = null;
      reject(new Error("TradingView failed to load"));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

export function TradingViewChart({
  symbol,
  timeframe,
  indicators,
}: {
  symbol: string; // e.g. BINANCE:NEARUSDT
  timeframe: string;
  indicators: string[];
}) {
  const reactId = useId();
  const containerId = `tv-${reactId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const failedRef = useRef<HTMLParagraphElement>(null);
  const studiesKey = indicators.join(",");

  useEffect(() => {
    let cancelled = false;
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    loadScript()
      .then(() => {
        if (cancelled || !window.TradingView) return;
        new window.TradingView.widget({
          container_id: containerId,
          symbol,
          interval: INTERVALS[timeframe] ?? "15",
          autosize: true,
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "en",
          enable_publishing: false,
          hide_side_toolbar: false,
          allow_symbol_change: false,
          withdateranges: true,
          save_image: false,
          backgroundColor: "rgba(13, 17, 22, 1)",
          gridColor: "rgba(255, 255, 255, 0.04)",
          studies: studiesKey ? studiesKey.split(",").map((s) => STUDIES[s]).filter(Boolean) : [],
        });
      })
      .catch(() => {
        if (failedRef.current) failedRef.current.hidden = false;
      });
    return () => {
      cancelled = true;
    };
  }, [containerId, symbol, timeframe, studiesKey]);

  return (
    <div className="relative h-full min-h-[460px] w-full overflow-hidden rounded-2xl border border-line bg-surface">
      <div id={containerId} className="absolute inset-0" />
      <p ref={failedRef} hidden className="absolute inset-0 flex items-center justify-center text-sm text-muted">
        Chart unavailable. Check your connection or ad blocker.
      </p>
    </div>
  );
}
