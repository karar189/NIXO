"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AuditEvent, RunReport } from "@/lib/nixo/run";
import {
  assetLabel, flowRequests, fmt, mirroredAttacks, priceOf, reasonCounts, stepSeries, symbolOf, type AgentStepPoint, type StepPoint,
} from "@/lib/nixo/viz";

const COLOR = { a: "var(--viz-a)", b: "var(--viz-b)" };
const M = { l: 48, r: 18, t: 14, b: 30 };

// ---------------------------------------------------------------- shared bits

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

function niceTicks(min: number, max: number, n = 4): number[] {
  if (max <= min) return [min];
  const raw = (max - min) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

function ChartCard({ title, subtitle, legend, children }: { title: string; subtitle?: string; legend?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col panel p-5">
      <header className="mb-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[11px] leading-5 text-muted">{subtitle}</p>}
        {legend && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">{legend}</div>}
      </header>
      {children}
    </section>
  );
}

const LineKey = ({ color, label }: { color: string; label: string }) => (
  <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: color }} />{label}</span>
);
const DotKey = ({ color, label, hollow }: { color: string; label: string; hollow?: boolean }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className="size-2.5 rounded-full" style={hollow ? { border: `1.5px solid ${color}` } : { background: color }} />{label}
  </span>
);
const RectKey = ({ color, label, faint }: { color: string; label: string; faint?: boolean }) => (
  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2 rounded-sm" style={{ background: color, opacity: faint ? 0.3 : 1 }} />{label}</span>
);

type Tip = { x: number; y: number; title: string; rows: { key?: string; value: string; label: string }[] } | null;

function Tooltip({ tip, width }: { tip: Tip; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(0, tip.x + 12), width - 210);
  return (
    <div role="tooltip" className="pointer-events-none absolute z-10 w-[200px] rounded-xl border border-line bg-surface-2/95 p-2.5 text-xs shadow-xl backdrop-blur" style={{ left, top: Math.max(0, tip.y - 10) }}>
      <p className="mb-1 text-[11px] text-muted">{tip.title}</p>
      {tip.rows.map((r, i) => (
        <p key={i} className="flex items-center gap-2 py-0.5">
          {r.key && <span className="h-0.5 w-3 shrink-0 rounded" style={{ background: r.key }} />}
          <span className="font-mono font-medium text-foreground">{r.value}</span>
          <span className="truncate text-muted">{r.label}</span>
        </p>
      ))}
    </div>
  );
}

function describe(p: AgentStepPoint): string {
  if (p.status === "pending") return "…";
  if (p.status === "held_by_agent") return "hold";
  const amt = `${fmt(p.proposed)} USDC${p.asset ? ` → ${assetLabel(p.asset)}` : ""}`;
  if (p.status === "executed") return `${amt} ✓`;
  if (p.status === "rejected") return `${amt} ✕ ${p.reason ?? ""}`;
  return `${amt} · ${p.status}`;
}

function Axes({ w, h, yTicks, y, xLabels }: { w: number; h: number; yTicks: number[]; y: (v: number) => number; xLabels: { x: number; label: string }[] }) {
  return (
    <g>
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={M.l} x2={w - M.r} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" />
          <text x={M.l - 8} y={y(t) + 4} textAnchor="end" fontSize={10} className="fill-muted font-mono tabular-nums">{fmt(t, 3)}</text>
        </g>
      ))}
      <line x1={M.l} x2={w - M.r} y1={h - M.b} y2={h - M.b} stroke="var(--viz-axis)" />
      {xLabels.map((l) => (
        <text key={l.label} x={l.x} y={h - M.b + 16} textAnchor="middle" fontSize={10} className="fill-muted font-mono tabular-nums">{l.label}</text>
      ))}
    </g>
  );
}

// ---------------------------------------------------------------- stat tiles

function StatTiles({ r, events }: { r: RunReport; events: AuditEvent[] }) {
  const atk = mirroredAttacks(r);
  const reqs = flowRequests(events);
  const b = reqs.filter((x) => x.agent === "agent_b");
  const blocked = b.filter((x) => x.outcome === "blocked").length;
  const lat = [...r.agents.agent_a.steps, ...r.agents.agent_b.steps].map((s) => s.proposal.latency_ms).filter((x): x is number => !!x);
  const avg = lat.length ? lat.reduce((s, x) => s + x, 0) / lat.length / 1000 : null;
  const tiles = [
    { label: "Policy-breaking requests executed · Agent A", value: `${atk.aExecuted} of ${atk.total}`, note: "Same hostile requests, no vault", color: COLOR.a },
    { label: "Policy-breaking requests executed · Agent B", value: `${atk.bExecuted} of ${atk.total}`, note: "Stopped at the vault", color: COLOR.b },
    { label: "Requests the vault blocked", value: `${blocked} of ${b.length}`, note: `${b.length - blocked} allowed through`, color: null },
    { label: "Average model decision time", value: avg !== null ? `${avg.toFixed(1)} s` : "—", note: r.llm?.model ?? "rules (instant)", color: null },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-2xl border border-line bg-surface/90 p-4">
          <p className="flex items-center gap-1.5 text-[11px] text-muted">
            {t.color && <span className="size-2 rounded-full" style={{ background: t.color }} />}
            {t.label}
          </p>
          <p className="mt-1.5 text-2xl font-semibold">{t.value}</p>
          <p className="mt-0.5 text-[11px] text-muted">{t.note}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- price + buys

function PriceBuys({ data, r, code }: { data: StepPoint[]; r: RunReport; code: string }) {
  const { ref, w } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const [hi, setHi] = useState<number | null>(null);
  const h = 170;
  const priceAt = (d: StepPoint) => priceOf(r, code, d.step);
  const prices = data.map(priceAt).filter((p): p is number => p !== null);
  if (!prices.length) return <div ref={ref} className="h-[170px]" />;
  const lo = Math.min(...prices);
  const hiP = Math.max(...prices);
  const pad = Math.max((hiP - lo) * 0.25, hiP * 0.002);
  const y = (v: number) => M.t + (1 - (v - (lo - pad)) / (hiP + pad - (lo - pad))) * (h - M.t - M.b);
  const band = (w - M.l - M.r) / data.length;
  const x = (i: number) => M.l + band * (i + 0.5);
  const maxAmt = Math.max(1, ...data.flatMap((d) => [d.a.proposed, d.b.proposed]));
  const rad = (amt: number) => 4 + 7 * Math.sqrt(amt / maxAmt);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const i = Math.max(0, Math.min(data.length - 1, Math.floor((e.clientX - box.left - M.l) / band)));
    const d = data[i];
    setHi(i);
    const pr = priceAt(d);
    setTip({
      x: x(i), y: M.t, title: `Step ${d.step} · ${assetLabel(code)}`,
      rows: [
        { value: pr !== null ? `$${fmt(pr, 4)}` : "—", label: "price", key: "var(--muted)" },
        { value: describe(d.a), label: "Agent A", key: COLOR.a },
        { value: describe(d.b), label: "Agent B", key: COLOR.b },
      ],
    });
  };

  return (
    <div ref={ref} className="relative">
      <svg width={w} height={h} role="img" aria-label={`${assetLabel(code)} price per step with each agent's buys of it; dot size is the amount`}>
        <Axes w={w} h={h} yTicks={niceTicks(lo - pad, hiP + pad)} y={y} xLabels={data.map((d, i) => ({ x: x(i), label: String(d.step) }))} />
        {hi !== null && <line x1={x(hi)} x2={x(hi)} y1={M.t} y2={h - M.b} stroke="var(--viz-axis)" />}
        <polyline fill="none" stroke="var(--muted)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
          points={data.map((d, i) => { const pr = priceAt(d); return pr !== null ? `${x(i)},${y(pr)}` : ""; }).join(" ")} />
        {data.map((d, i) =>
          (["a", "b"] as const).map((k) => {
            const p = d[k];
            const pr = priceAt(d);
            if (pr === null || p.proposed <= 0 || p.asset !== code) return null;
            const cx = x(i) + (k === "a" ? -7 : 7);
            const executed = p.status === "executed";
            return (
              <circle key={`${i}${k}`} cx={cx} cy={y(pr)} r={rad(p.proposed)} fill={executed ? COLOR[k] : "var(--surface)"} fillOpacity={executed ? 0.9 : 1}
                stroke={executed ? "var(--surface)" : COLOR[k]} strokeWidth={executed ? 2 : 1.5} />
            );
          }),
        )}
        <rect x={M.l} y={M.t} width={w - M.l - M.r} height={h - M.t - M.b} fill="transparent" onPointerMove={onMove} onPointerLeave={() => { setTip(null); setHi(null); }} />
      </svg>
      <Tooltip tip={tip} width={w} />
    </div>
  );
}

// ---------------------------------------------------------------- cumulative spend

function Cumulative({ data, target }: { data: StepPoint[]; target: number }) {
  const { ref, w } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const [hi, setHi] = useState<number | null>(null);
  const h = 240;
  const max = Math.max(target, ...data.flatMap((d) => [d.a.cumulative, d.b.cumulative])) * 1.12;
  const y = (v: number) => M.t + (1 - v / max) * (h - M.t - M.b);
  const n = data.length;
  const x = (i: number) => M.l + ((w - M.l - M.r - 40) * i) / Math.max(1, n); // i = 0 is the start (nothing spent)
  const pts = (k: "a" | "b") => [`${x(0)},${y(0)}`, ...data.map((d, i) => `${x(i + 1)},${y(d[k].cumulative)}`)].join(" ");
  const last = data[n - 1];
  const yA = last ? y(last.a.cumulative) : 0;
  const yB = last ? y(last.b.cumulative) : 0;
  const apart = Math.abs(yA - yB) >= 14;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const step = (w - M.l - M.r - 40) / Math.max(1, n);
    const i = Math.max(0, Math.min(n, Math.round((e.clientX - box.left - M.l) / step)));
    setHi(i);
    const d = i > 0 ? data[i - 1] : null;
    setTip({
      x: x(i), y: M.t, title: i === 0 ? "Start" : `After step ${i}`,
      rows: [
        { value: `${fmt(d?.a.cumulative ?? 0)} USDC`, label: "Agent A", key: COLOR.a },
        { value: `${fmt(d?.b.cumulative ?? 0)} USDC`, label: "Agent B", key: COLOR.b },
        { value: `${fmt(target)} USDC`, label: "target" },
      ],
    });
  };

  return (
    <div ref={ref} className="relative">
      <svg width={w} height={h} role="img" aria-label="Cumulative USDC converted by each agent against the task target">
        <Axes w={w} h={h} yTicks={niceTicks(0, max)} y={y} xLabels={[{ x: x(0), label: "0" }, ...data.map((d, i) => ({ x: x(i + 1), label: String(d.step) }))]} />
        <line x1={M.l} x2={w - M.r - 40} y1={y(target)} y2={y(target)} stroke="var(--foreground)" strokeOpacity={0.35} />
        <text x={M.l + 6} y={y(target) - 6} fontSize={10} className="fill-muted">target {fmt(target)}</text>
        {hi !== null && <line x1={x(hi)} x2={x(hi)} y1={M.t} y2={h - M.b} stroke="var(--viz-axis)" />}
        {/* B is drawn as a wider band under A so the two stay visible where they coincide. */}
        <polyline points={pts("b")} fill="none" stroke={COLOR.b} strokeOpacity={0.55} strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={pts("a")} fill="none" stroke={COLOR.a} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {last && (["a", "b"] as const).map((k) => (
          <circle key={k} cx={x(n)} cy={y(last[k].cumulative)} r={4} fill={COLOR[k]} stroke="var(--surface)" strokeWidth={2} />
        ))}
        {last && apart && (
          <>
            <text x={x(n) + 8} y={yA + 4} fontSize={10} className="fill-foreground font-mono">A</text>
            <text x={x(n) + 8} y={yB + 4} fontSize={10} className="fill-foreground font-mono">B</text>
          </>
        )}
        {last && !apart && <text x={x(n) + 8} y={(yA + yB) / 2 + 4} fontSize={10} className="fill-foreground font-mono">A = B</text>}
        <rect x={M.l} y={M.t} width={w - M.l - M.r} height={h - M.t - M.b} fill="transparent" onPointerMove={onMove} onPointerLeave={() => { setTip(null); setHi(null); }} />
      </svg>
      <Tooltip tip={tip} width={w} />
    </div>
  );
}

// ---------------------------------------------------------------- trade size vs limit

function roundTop(x: number, y: number, bw: number, bh: number, rad = 4) {
  const r = Math.min(rad, bw / 2, bh);
  return `M${x},${y + bh} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${y + bh} Z`;
}

function TradeSizes({ data, limit }: { data: StepPoint[]; limit: number }) {
  const { ref, w } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const h = 240;
  const max = Math.max(limit, ...data.flatMap((d) => [d.a.proposed, d.b.proposed])) * 1.15;
  const y = (v: number) => M.t + (1 - v / max) * (h - M.t - M.b);
  const band = (w - M.l - M.r) / Math.max(1, data.length);
  const bw = Math.min(14, (band - 10) / 2);
  const cx = (i: number) => M.l + band * (i + 0.5);

  return (
    <div ref={ref} className="relative">
      <svg width={w} height={h} role="img" aria-label="Size of each proposed trade per step, against Agent B's per-trade limit">
        <Axes w={w} h={h} yTicks={niceTicks(0, max)} y={y} xLabels={data.map((d, i) => ({ x: cx(i), label: String(d.step) }))} />
        {data.map((d, i) =>
          (["a", "b"] as const).map((k) => {
            const p = d[k];
            if (p.proposed <= 0) return null;
            const x0 = k === "a" ? cx(i) - bw - 1 : cx(i) + 1; // 2px gap between the pair
            const top = y(p.proposed);
            const executed = p.status === "executed";
            const show = (e: React.PointerEvent | React.FocusEvent) => {
              void e;
              setTip({ x: x0, y: top - 8, title: `Step ${d.step} · Agent ${k.toUpperCase()}`, rows: [{ value: describe(p), label: "", key: COLOR[k] }] });
            };
            return (
              <g key={`${i}${k}`} tabIndex={0} aria-label={`Step ${d.step}, Agent ${k.toUpperCase()}: ${describe(p)}`} onPointerEnter={show} onFocus={show} onPointerLeave={() => setTip(null)} onBlur={() => setTip(null)} className="outline-none">
                <rect x={x0 - 4} y={M.t} width={bw + 8} height={h - M.t - M.b} fill="transparent" />
                <path d={roundTop(x0, top, bw, h - M.b - top)} fill={COLOR[k]} fillOpacity={executed ? 1 : 0.28} />
                {p.status === "rejected" && <text x={x0 + bw / 2} y={top - 5} textAnchor="middle" fontSize={11} className="fill-reject">✕</text>}
              </g>
            );
          }),
        )}
        <line x1={M.l} x2={w - M.r} y1={y(limit)} y2={y(limit)} stroke="var(--reject)" strokeOpacity={0.8} />
        <text x={w - M.r} y={y(limit) - 6} textAnchor="end" fontSize={10} className="fill-foreground">B&apos;s per-trade limit {fmt(limit)}</text>
      </svg>
      <Tooltip tip={tip} width={w} />
    </div>
  );
}

// ---------------------------------------------------------------- block reasons

function BlockReasons({ events }: { events: AuditEvent[] }) {
  const rows = useMemo(() => reasonCounts(flowRequests(events)), [events]);
  const { ref, w } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  if (!rows.length) return <p ref={ref as never} className="py-10 text-center text-xs text-muted">Nothing blocked yet.</p>;
  const labelW = 190;
  const rowH = 26;
  const h = rows.length * rowH + 8;
  const max = Math.max(...rows.map((r) => r.count));
  const bx = (v: number) => ((w - labelW - 40) * v) / max;
  return (
    <div ref={ref} className="relative">
      <svg width={w} height={h} role="img" aria-label="Why Agent B's requests were blocked, by reason code">
        {rows.map((r, i) => {
          const yy = 4 + i * rowH;
          const bw = Math.max(4, bx(r.count));
          const show = () => setTip({ x: labelW + bw, y: yy, title: r.reason, rows: [{ value: String(r.count), label: r.count === 1 ? "request" : "requests", key: COLOR.b }] });
          return (
            <g key={r.reason} tabIndex={0} aria-label={`${r.reason}: ${r.count}`} onPointerEnter={show} onFocus={show} onPointerLeave={() => setTip(null)} onBlur={() => setTip(null)} className="outline-none">
              <rect x={0} y={yy} width={w} height={rowH} fill="transparent" />
              <text x={labelW - 10} y={yy + 16} textAnchor="end" fontSize={10.5} className="fill-muted font-mono">{r.reason}</text>
              <path d={`M${labelW},${yy + 6} H${labelW + bw - 4} Q${labelW + bw},${yy + 6} ${labelW + bw},${yy + 10} V${yy + 16} Q${labelW + bw},${yy + 20} ${labelW + bw - 4},${yy + 20} H${labelW} Z`} fill={COLOR.b} />
              <text x={labelW + bw + 6} y={yy + 17} fontSize={11} className="fill-foreground font-mono">{r.count}</text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} width={w} />
    </div>
  );
}

// ---------------------------------------------------------------- portfolio mix

const ASSET_COLORS = ["var(--viz-asset-1)", "var(--viz-asset-2)", "var(--viz-asset-3)", "var(--viz-asset-4)"];
const ASSET_INK = ["#ffffff", "#ffffff", "#ffffff", "#0b0b0b"]; // near-black on the yellow slot

function PortfolioMix({ r }: { r: RunReport }) {
  const { ref, w } = useWidth<HTMLDivElement>();
  const codes = r.task_targets.map((t) => t.asset);
  const rows = [
    { label: "Target", parts: r.task_targets.map((t) => ({ code: t.asset, usdc: Number(t.usdc) })) },
    ...(["agent_a", "agent_b"] as const).map((id) => ({
      label: id === "agent_a" ? "Agent A" : "Agent B",
      parts: (r.agents[id].metrics?.per_asset ?? []).map((l) => ({ code: l.asset, usdc: Number(l.spent_usdc) })),
    })),
  ];
  const scale = Math.max(1, ...rows.map((row) => row.parts.reduce((s, p) => s + p.usdc, 0)));
  const labelW = 64 + 56;
  const barW = Math.max(120, w - labelW);
  return (
    <div ref={ref}>
      <div className="space-y-3">
        {rows.map((row) => {
          const total = row.parts.reduce((s, p) => s + p.usdc, 0);
          return (
            <div key={row.label} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-[11px] text-muted">{row.label}</span>
              <div className="flex h-7 gap-[2px]" style={{ width: (barW * total) / scale }}
                role="img" aria-label={`${row.label}: ${row.parts.map((p) => `${assetLabel(p.code)} ${fmt(p.usdc)} USDC`).join(", ")}`}>
                {row.parts.map((p) => {
                  const i = codes.indexOf(p.code);
                  const px = (barW * p.usdc) / scale;
                  if (p.usdc <= 0) return null;
                  const text = `${symbolOf(p.code)} ${fmt(p.usdc, 0)}`;
                  const fits = px > text.length * 6.5 + 12;
                  return (
                    <div key={p.code} tabIndex={0} title={`${row.label} · ${assetLabel(p.code)}: ${fmt(p.usdc)} USDC (${((p.usdc / Math.max(total, 1)) * 100).toFixed(0)}%)`}
                      className="flex h-full items-center rounded px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
                      style={{ width: px, background: ASSET_COLORS[i % 4], color: ASSET_INK[i % 4] }}>
                      {fits && <span className="truncate font-mono text-[10px] font-medium">{text}</span>}
                    </div>
                  );
                })}
              </div>
              <span className="font-mono text-[11px] text-muted">{fmt(total)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        {codes.map((c, i) => <RectKey key={c} color={ASSET_COLORS[i % 4]} label={assetLabel(c)} />)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- section

export function RunCharts({ report, events }: { report: RunReport; events: AuditEvent[] }) {
  const data = useMemo(() => stepSeries(report), [report]);
  const target = (report.task_targets ?? []).reduce((s, t) => s + Number(t.usdc), 0);
  const codes = (report.task_targets ?? []).map((t) => t.asset);
  const limit = Number(report.agents.agent_b.policy?.max_trade_amount ?? report.config.max_trade_amount);
  return (
    <div className="space-y-4">
      <StatTiles r={report} events={events} />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="xl:col-span-2">
          <ChartCard
            title="When each agent bought, per asset"
            subtitle="One chart per task asset (each has its own price scale). A dot is a buy of that asset; its size is the amount. Hollow means proposed but not executed."
            legend={<><LineKey color="var(--muted)" label="price (USD)" /><DotKey color={COLOR.a} label="Agent A" /><DotKey color={COLOR.b} label="Agent B" /><DotKey color="var(--muted)" label="not executed" hollow /></>}
          >
            <div className={`grid gap-x-6 gap-y-4 ${codes.length > 1 ? "md:grid-cols-2" : ""} ${codes.length > 2 ? "xl:grid-cols-3" : ""}`}>
              {codes.map((c) => (
                <div key={c}>
                  <p className="mb-1 font-mono text-[11px] text-foreground">{assetLabel(c)}</p>
                  <PriceBuys data={data} r={report} code={c} />
                </div>
              ))}
            </div>
          </ChartCard>
        </div>
        <ChartCard
          title="Progress toward the task"
          subtitle={`USDC converted so far across all ${codes.length} assets, against the ${fmt(target)} USDC target.`}
          legend={<><LineKey color={COLOR.a} label="Agent A" /><LineKey color={COLOR.b} label="Agent B (wide band)" /><LineKey color="var(--foreground)" label="target" /></>}
        >
          <Cumulative data={data} target={target} />
        </ChartCard>
        <ChartCard title="Portfolio mix" subtitle="USDC each agent put into each asset, against the target split. Hover a block for its share.">
          <PortfolioMix r={report} />
        </ChartCard>
        <ChartCard
          title="Trade size vs Agent B's limit"
          subtitle="What each agent asked to trade per step. Faint bars with ✕ were rejected by the vault. Agent A has no limit."
          legend={<><RectKey color={COLOR.a} label="Agent A" /><RectKey color={COLOR.b} label="Agent B" /><RectKey color={COLOR.b} label="rejected" faint /></>}
        >
          <TradeSizes data={data} limit={limit} />
        </ChartCard>
        <ChartCard title="Why the vault blocked requests" subtitle="Every rejected request to Agent B's vault in this run (task, attacks and console), by reason.">
          <BlockReasons events={events} />
        </ChartCard>
      </div>
    </div>
  );
}
