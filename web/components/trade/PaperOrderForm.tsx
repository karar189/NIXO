"use client";

import { useEffect, useMemo, useState } from "react";
import { tradingApi, type Fill, type Market, type Side } from "@/lib/trading/api";
import { fmtPrice, fmtQty, fmtUsd, pnlTone } from "@/lib/trading/format";

type LevelMode = "pct" | "price" | "none";
const MMR = 0.005;

function LevelInput({
  label,
  mode,
  value,
  onMode,
  onValue,
}: {
  label: string;
  mode: LevelMode;
  value: string;
  onMode: (m: LevelMode) => void;
  onValue: (v: string) => void;
}) {
  const id = `lvl-${label.replace(/\s/g, "")}`;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={id} className="text-xs text-muted">{label}</label>
        <div className="flex rounded-md border border-line p-0.5 text-[10px]">
          {(["pct", "price", "none"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onMode(m)}
              aria-pressed={mode === m}
              className={`rounded px-1.5 py-0.5 ${mode === m ? "bg-surface-2 text-foreground" : "text-muted"}`}
            >
              {m === "pct" ? "%" : m === "price" ? "Price" : "Off"}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        <input
          id={id}
          inputMode="decimal"
          disabled={mode === "none"}
          value={mode === "none" ? "" : value}
          onChange={(e) => onValue(e.target.value)}
          placeholder={mode === "none" ? "Off" : mode === "pct" ? "2" : "0.00"}
          className="w-full rounded-lg border border-line bg-background px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none disabled:opacity-50"
        />
        {mode === "pct" && <span className="pointer-events-none absolute right-3 top-2 text-sm text-muted">%</span>}
      </div>
    </div>
  );
}

export function PaperOrderForm({
  account,
  market,
  markPrice,
  busy,
  onOpened,
}: {
  account: string;
  market: Market;
  markPrice: number | null;
  busy: string | null;
  onOpened: () => void;
}) {
  const [side, setSide] = useState<Side>("LONG");
  const [margin, setMargin] = useState("100");
  const [leverage, setLeverage] = useState(5);
  const [tpMode, setTpMode] = useState<LevelMode>("pct");
  const [tp, setTp] = useState("4");
  const [slMode, setSlMode] = useState<LevelMode>("pct");
  const [sl, setSl] = useState("2");
  const [preview, setPreview] = useState<{ mark: number; fill: Fill } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lev = Math.min(leverage, market.maxLeverage);
  const marginNum = Number(margin);
  const notional = Number.isFinite(marginNum) && marginNum > 0 ? marginNum * lev : 0;

  // Debounced 1Click dry-run quote for the entry.
  useEffect(() => {
    if (notional < 5) return;
    const t = setTimeout(() => {
      tradingApi
        .preview(market.symbol, side, notional)
        .then((p) => {
          setPreview(p);
          setPreviewError(null);
        })
        .catch((e: Error) => setPreviewError(e.message));
    }, 500);
    return () => clearTimeout(t);
  }, [market.symbol, side, notional]);

  const entry = preview?.fill.price ?? markPrice ?? null;
  const est = useMemo(() => {
    if (!entry || !notional) return null;
    const sign = side === "LONG" ? 1 : -1;
    const level = (mode: LevelMode, raw: string, isTp: boolean) => {
      const v = Number(raw);
      if (mode === "none" || !raw || !Number.isFinite(v) || v <= 0) return null;
      if (mode === "price") return v;
      return entry * (1 + (isTp ? sign : -sign) * (v / 100));
    };
    const tpPrice = level(tpMode, tp, true);
    const slPrice = level(slMode, sl, false);
    const qty = notional / entry;
    const pnlAt = (px: number | null) => (px === null ? null : Math.max(sign * (px - entry) * qty, -marginNum));
    const liq = lev > 1 ? entry * (side === "LONG" ? 1 - 1 / lev + MMR : 1 + 1 / lev - MMR) : null;
    return { tpPrice, slPrice, qty, tpPnl: pnlAt(tpPrice), slPnl: pnlAt(slPrice), liq };
  }, [entry, notional, side, tpMode, tp, slMode, sl, lev, marginNum]);

  const levelError = (() => {
    if (!est || !entry) return null;
    const long = side === "LONG";
    if (est.tpPrice !== null && (long ? est.tpPrice <= entry : est.tpPrice >= entry))
      return `Take profit must be ${long ? "above" : "below"} entry`;
    if (est.slPrice !== null && (long ? est.slPrice >= entry : est.slPrice <= entry))
      return `Stop loss must be ${long ? "below" : "above"} entry`;
    if (est.slPrice !== null && est.liq !== null && (long ? est.slPrice <= est.liq : est.slPrice >= est.liq))
      return "Stop loss is past the liquidation price";
    return null;
  })();

  async function submit() {
    setError(null);
    if (!(marginNum > 0)) return setError("Enter a margin amount");
    if (levelError) return setError(levelError);
    setSubmitting(true);
    try {
      const toValue = (mode: LevelMode, raw: string) =>
        mode === "none" ? null : mode === "pct" ? Number(raw) / 100 : Number(raw);
      await tradingApi.manual(account, {
        symbol: market.symbol,
        side,
        amount_usdc: marginNum,
        leverage: lev,
        tp_mode: tpMode,
        tp: toValue(tpMode, tp),
        sl_mode: slMode,
        sl: toValue(slMode, sl),
      });
      onOpened();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-background p-1" role="radiogroup" aria-label="Side">
        {(["LONG", "SHORT"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={side === s}
            onClick={() => setSide(s)}
            className={`rounded-lg py-2 text-sm font-medium transition-colors ${
              side === s ? (s === "LONG" ? "bg-accent text-background" : "bg-danger text-background") : "text-muted hover:text-foreground"
            }`}
          >
            {s === "LONG" ? "Long" : "Short"}
          </button>
        ))}
      </div>

      <div>
        <label htmlFor="margin" className="mb-1.5 block text-xs text-muted">Margin (USDC)</label>
        <input
          id="margin"
          inputMode="decimal"
          value={margin}
          onChange={(e) => setMargin(e.target.value)}
          className="w-full rounded-lg border border-line bg-background px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
        />
        <div className="mt-1.5 flex gap-1.5">
          {[25, 100, 500, 1000].map((v) => (
            <button key={v} type="button" onClick={() => setMargin(String(v))} className="rounded-md border border-line px-2 py-0.5 font-mono text-[11px] text-muted hover:text-foreground">
              ${v}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="leverage" className="text-xs text-muted">Leverage</label>
          <span className="font-mono text-sm">{lev}x</span>
        </div>
        <input
          id="leverage"
          type="range"
          min={1}
          max={market.maxLeverage}
          value={lev}
          onChange={(e) => setLeverage(Number(e.target.value))}
          className="w-full accent-[var(--accent)]"
        />
        <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
          {[1, 5, 10, 20, market.maxLeverage].map((v) => (
            <button key={v} type="button" onClick={() => setLeverage(v)} className="hover:text-foreground">{v}x</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <LevelInput label="Take profit" mode={tpMode} value={tp} onMode={setTpMode} onValue={setTp} />
        <LevelInput label="Stop loss" mode={slMode} value={sl} onMode={setSlMode} onValue={setSl} />
      </div>

      <dl className="space-y-1.5 rounded-xl border border-line bg-background/50 p-3 text-xs">
        {[
          ["Position size", notional ? `${fmtUsd(notional)} · ${fmtQty(est?.qty)} ${market.symbol}` : "—"],
          ["Est. entry (NEAR Intents)", preview ? `${fmtPrice(preview.fill.price)} (${preview.fill.slippage_bps >= 0 ? "+" : ""}${preview.fill.slippage_bps.toFixed(1)} bps)` : previewError ? "quote unavailable" : "quoting…"],
          ["Liquidation", est?.liq ? fmtPrice(est.liq) : "none at 1x"],
          ["At take profit", est?.tpPrice ? `${fmtPrice(est.tpPrice)} → ${fmtUsd(est.tpPnl, true)}` : "—"],
          ["At stop loss", est?.slPrice ? `${fmtPrice(est.slPrice)} → ${fmtUsd(est.slPnl, true)}` : "—"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted">{k}</dt>
            <dd className={`text-right font-mono ${k === "At take profit" ? pnlTone(est?.tpPnl) : k === "At stop loss" ? pnlTone(est?.slPnl) : ""}`}>{v}</dd>
          </div>
        ))}
      </dl>
      {preview?.fill.source === "reference" && (
        <p className="text-[11px] text-amber-300">1Click has no quote for this size right now; the fill would use the mark price.</p>
      )}

      {(error || levelError) && <p role="alert" className="text-xs text-danger">{error ?? levelError}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={Boolean(busy) || submitting || !notional}
        className={`w-full rounded-full py-2.5 text-sm font-medium text-background transition hover:brightness-110 disabled:opacity-50 ${side === "LONG" ? "bg-accent" : "bg-danger"}`}
      >
        {submitting ? "Opening…" : `Open paper ${side === "LONG" ? "long" : "short"} · ${market.pair}`}
      </button>
      {busy && <p className="text-center text-[11px] text-muted">{busy}</p>}
      <p className="text-center text-[11px] leading-5 text-muted">
        Paper only: priced by real NEAR Intents solver quotes, no funds move. Leverage is simulated because
        Intents settles spot swaps.
      </p>
    </div>
  );
}
