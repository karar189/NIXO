"use client";

import { useId, useMemo, useState } from "react";
import { fetchPriceHistory, formatPct, formatUsd, type PricePoint } from "@/lib/market";
import { usePolling } from "@/lib/usePolling";
import { Card, Skeleton } from "./Card";

const RANGES = [
  { label: "1D", days: 1 },
  { label: "7D", days: 7 },
  { label: "1M", days: 30 },
] as const;

const W = 600;
const H = 200;

function PriceChart({ points, days }: { points: PricePoint[]; days: number }) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const { line, area, xs, ys, min, max } = useMemo(() => {
    const ps = points.map((p) => p.p);
    const min = Math.min(...ps);
    const max = Math.max(...ps);
    const span = max - min || 1;
    const xs = points.map((_, i) => (i / (points.length - 1)) * W);
    const ys = ps.map((p) => H - 12 - ((p - min) / span) * (H - 24));
    const line = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join("");
    return { line, area: `${line}L${W},${H}L0,${H}Z`, xs, ys, min, max };
  }, [points]);

  const up = points[points.length - 1].p >= points[0].p;
  const stroke = up ? "var(--accent)" : "var(--danger)";
  const active = hover !== null ? points[hover] : null;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setHover(Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1)))));
  }

  const fmtTime = (t: number) =>
    new Date(t).toLocaleString([], days <= 1 ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric" });

  return (
    <div className="relative">
      <div className="pointer-events-none absolute right-0 top-0 text-right font-mono text-[11px] text-muted">
        {active ? (
          <>
            <span className="text-foreground">{formatUsd(active.p, 3)}</span> · {fmtTime(active.t)}
          </>
        ) : (
          <>
            H {formatUsd(max, 3)} · L {formatUsd(min, 3)}
          </>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-6 h-44 w-full touch-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`NEAR price chart, low ${formatUsd(min, 3)}, high ${formatUsd(max, 3)}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {hover !== null && (
          <>
            <line x1={xs[hover]} x2={xs[hover]} y1="0" y2={H} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <circle cx={xs[hover]} cy={ys[hover]} r="4" fill={stroke} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-muted">
        <span>{fmtTime(points[0].t)}</span>
        <span>{fmtTime(points[points.length - 1].t)}</span>
      </div>
    </div>
  );
}

export function MarketCard() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[0]);
  const history = usePolling(() => fetchPriceHistory("near", range.days), 120_000, [range.days]);
  const points = history.data;
  const last = points?.[points.length - 1]?.p;
  const change = points && points.length > 1 ? ((points[points.length - 1].p - points[0].p) / points[0].p) * 100 : null;

  return (
    <Card
      title="NEAR / USD"
      action={
        <div className="flex rounded-lg border border-line bg-background p-0.5" role="tablist" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              role="tab"
              aria-selected={r.label === range.label}
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
                r.label === range.label ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="flex items-baseline gap-3">
        {last !== undefined ? (
          <p className="text-3xl font-semibold tracking-tight">{formatUsd(last, 3)}</p>
        ) : (
          <Skeleton className="h-9 w-28" />
        )}
        {change !== null && (
          <span className={`font-mono text-sm ${change >= 0 ? "text-accent" : "text-danger"}`}>
            {formatPct(change)} <span className="text-muted">{range.label}</span>
          </span>
        )}
      </div>
      {points && points.length > 1 ? (
        <PriceChart points={points} days={range.days} />
      ) : history.error ? (
        <p className="mt-6 flex h-44 items-center justify-center rounded-xl border border-dashed border-line text-sm text-muted">
          Chart unavailable — {history.error}
        </p>
      ) : (
        <Skeleton className="mt-6 h-44 w-full" />
      )}
      <p className="mt-3 text-[10px] text-muted/70">Market data: CoinGecko</p>
    </Card>
  );
}
