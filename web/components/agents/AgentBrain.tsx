"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { AuditEvent, RunReport } from "@/lib/nixo/run";
import { GATES, flowRequests, gateFunnel, type FlowRequest } from "@/lib/nixo/viz";
import { PROVIDER_SHORT } from "@/lib/trading/api";

// ---------------------------------------------------------------- geometry (viewBox 1000 × 480)

type P = [number, number];
type Seg = [P, P, P, P]; // cubic bezier

const W = 1000;
const H = 480;
const BRAIN: P = [255, 215];
const RED: P = [255, 430];
const INPUTS = [
  { id: "in_market", label: "Market bars", hint: "Recent NEAR/USDC closes from the frozen snapshot.", p: [70, 110] as P },
  { id: "in_balance", label: "Balances", hint: "What the agent can spend right now (B sees the vault's view).", p: [70, 185] as P },
  { id: "in_task", label: "Task", hint: "The same instruction for both agents.", p: [70, 260] as P },
  { id: "in_feedback", label: "Feedback", hint: "Its own previous outcomes, including rejection reasons.", p: [70, 335] as P },
];
const AG_B: P = [455, 120];
const AG_A: P = [455, 400];
const GX = 620;
const GY0 = 70;
const LAST_GATE = GATES.length - 1;
const GSTEP = 270 / LAST_GATE; // gates fill the same column height however many there are
const gateP = (i: number): P => [GX, GY0 + i * GSTEP];
const BRANCH_X = 795;
const BLOCKED: P = [915, 205];
const VENUE: P = [915, 420];

const line = (a: P, b: P): Seg => [a, [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3], b];
const curveH = (a: P, b: P): Seg => {
  const dx = (b[0] - a[0]) * 0.5;
  return [a, [a[0] + dx, a[1]], [b[0] - dx, b[1]], b];
};
const d = (s: Seg) => `M${s[0][0]},${s[0][1]} C${s[1][0]},${s[1][1]} ${s[2][0]},${s[2][1]} ${s[3][0]},${s[3][1]}`;

function at(s: Seg, t: number): P {
  const u = 1 - t;
  const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [k[0] * s[0][0] + k[1] * s[1][0] + k[2] * s[2][0] + k[3] * s[3][0], k[0] * s[0][1] + k[1] * s[1][1] + k[2] * s[2][1] + k[3] * s[3][1]];
}
const segLen = (s: Seg) => {
  let len = 0;
  let prev = s[0];
  for (let i = 1; i <= 12; i++) {
    const p = at(s, i / 12);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return len;
};

const EDGE = {
  brainB: curveH([BRAIN[0] + 30, BRAIN[1] - 10], [AG_B[0] - 18, AG_B[1]]),
  brainA: curveH([BRAIN[0] + 30, BRAIN[1] + 10], [AG_A[0] - 18, AG_A[1]]),
  redB: curveH([RED[0] + 14, RED[1] - 6], [AG_B[0] - 18, AG_B[1] + 6]),
  redA: curveH([RED[0] + 14, RED[1]], [AG_A[0] - 18, AG_A[1] + 4]),
  bGate: curveH([AG_B[0] + 18, AG_B[1]], [GX - 9, GY0]),
  aVenue: [[AG_A[0] + 18, AG_A[1]], [600, 462], [800, 462], [VENUE[0] - 22, VENUE[1] + 6]] as Seg,
  passVenue: [[GX, gateP(LAST_GATE)[1] + 9], [GX, 420], [700, 420], [VENUE[0] - 22, VENUE[1]]] as Seg,
};
const chain = (i: number): Seg => line([GX, gateP(i)[1] + 9], [GX, gateP(i + 1)[1] - 9]);
const branch = (i: number): Seg => curveH([BRANCH_X, gateP(i)[1]], [BLOCKED[0] - 22, BLOCKED[1]]);
const toBranch = (i: number): Seg => line([GX + 9, gateP(i)[1]], [BRANCH_X, gateP(i)[1]]);

function route(r: FlowRequest): Seg[] {
  const fromModel = r.phase === "task";
  if (r.agent === "agent_a") return [fromModel ? EDGE.brainA : EDGE.redA, EDGE.aVenue];
  const segs: Seg[] = [fromModel ? EDGE.brainB : EDGE.redB, EDGE.bGate];
  const stop = r.stoppedAt ? GATES.findIndex((g) => g.id === r.stoppedAt) : GATES.length;
  for (let i = 0; i < Math.min(stop, GATES.length - 1); i++) segs.push(chain(i));
  if (r.stoppedAt) segs.push(toBranch(stop), branch(stop));
  else segs.push(EDGE.passVenue);
  return segs;
}

// Decorative "neural mesh" around the model node (seeded, so it is stable between renders).
function mesh() {
  let seed = 7;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pts: P[] = [];
  while (pts.length < 54) {
    const x = (rnd() * 2 - 1) * 92;
    const y = (rnd() * 2 - 1) * 112;
    if ((x * x) / (92 * 92) + (y * y) / (112 * 112) <= 1 && Math.hypot(x, y) > 34) pts.push([BRAIN[0] + x, BRAIN[1] + y]);
  }
  const links: [P, P][] = [];
  pts.forEach((p, i) => {
    const near = pts
      .map((q, j) => ({ j, dd: Math.hypot(p[0] - q[0], p[1] - q[1]) }))
      .filter((x) => x.j !== i)
      .sort((a, b) => a.dd - b.dd)
      .slice(0, 3);
    near.forEach(({ j }) => j > i && links.push([p, pts[j]]));
    if (i % 4 === 0) links.push([p, BRAIN]);
  });
  return { pts, links, delays: pts.map(() => rnd() * 3) };
}

const NET = mesh(); // constant decoration, computed once

const width = (n: number, max: number) => (n <= 0 ? 0 : 1.5 + 6 * Math.sqrt(n / Math.max(1, max)));

// ---------------------------------------------------------------- component

/** One animated request: SMIL timing in the SVG document timeline (seconds). */
type Particle = { key: string; d: string; begin: number; dur: number; agent: string; end: P; blocked: boolean; gate: P | null; gateAt: number };

function routePath(segs: Seg[]): string {
  return segs
    .map((s, i) => `${i === 0 ? "M" : "L"}${s[0][0]},${s[0][1]} C${s[1][0]},${s[1][1]} ${s[2][0]},${s[2][1]} ${s[3][0]},${s[3][1]}`)
    .join(" ");
}

export function AgentBrain({ report, events }: { report: RunReport; events: AuditEvent[] }) {
  const reqs = useMemo(() => flowRequests(events), [events]);
  const funnel = useMemo(() => gateFunnel(reqs), [reqs]);
  const net = NET;
  const counts = useMemo(() => {
    const c = { brainA: 0, brainB: 0, redA: 0, redB: 0, aVenue: 0, bExec: 0, blocked: 0, aFailed: 0, bFailed: 0, aOut: 0, bOut: 0 };
    for (const r of reqs) {
      const fromModel = r.phase === "task";
      if (r.agent === "agent_a") {
        c[fromModel ? "brainA" : "redA"]++;
        c.aVenue++;
        if (r.outcome === "failed") c.aFailed++;
        else if (r.recipient) c.aOut++;
      } else {
        c[fromModel ? "brainB" : "redB"]++;
        if (r.outcome === "blocked") c.blocked++;
        else if (r.outcome === "executed") {
          c.bExec++;
          if (r.recipient) c.bOut++;
        }
        else c.bFailed++;
      }
    }
    return c;
  }, [reqs]);
  const maxFlow = Math.max(1, counts.brainA + counts.redA, funnel.total);

  // ---- animation (native SVG <animateMotion>; no per-frame React renders)
  const [particles, setParticles] = useState<Particle[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const svgRef = useRef<SVGSVGElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);

  const launch = (list: FlowRequest[], stagger: number, reset = false) => {
    const t0 = (svgRef.current?.getCurrentTime() ?? 0) + 0.1;
    const ps = list.map((r, i): Particle => {
      const segs = route(r);
      const lens = segs.map(segLen);
      const total = lens.reduce((a, b) => a + b, 0);
      const dur = 0.6 + total * 0.0024;
      const gi = r.stoppedAt ? GATES.findIndex((g) => g.id === r.stoppedAt) : -1;
      // the stop gate is reached at the end of the last chain segment (before toBranch)
      const toGate = gi >= 0 ? lens.slice(0, segs.length - 2).reduce((a, b) => a + b, 0) : 0;
      return {
        key: `${r.key}:${t0.toFixed(3)}`, d: routePath(segs), begin: t0 + (i * stagger) / 1000, dur, agent: r.agent,
        end: segs[segs.length - 1][3], blocked: !!r.stoppedAt, gate: gi >= 0 ? gateP(gi) : null, gateAt: total ? (toGate / total) * dur : 0,
      };
    });
    setParticles((cur) => (reset ? ps : [...cur, ...ps].slice(-240)));
  };

  // New requests (initial load or live polling) get launched once.
  useEffect(() => {
    const fresh = reqs.filter((r) => !seen.current.has(r.key));
    if (!fresh.length) return;
    const markSeen = () => fresh.forEach((r) => seen.current.add(r.key));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return markSeen();
    // Mark as seen only when launched, so a cancelled frame (StrictMode re-run) doesn't drop them.
    const id = requestAnimationFrame(() => {
      markSeen();
      launch(fresh, fresh.length > 12 ? 260 : 420);
    });
    return () => cancelAnimationFrame(id);
  }, [reqs]);

  const replay = () => launch(reqs, reqs.length > 12 ? 260 : 420, true);

  // ---- tooltip content
  const model = report.llm?.provider === "rules" ? "Rules agent" : `${PROVIDER_SHORT[report.llm?.provider ?? ""] ?? "LLM"} · ${report.llm?.model ?? "…"}`;
  const tip = (id: string): { title: string; lines: string[] } | null => {
    const inp = INPUTS.find((x) => x.id === id);
    if (inp) return { title: inp.label, lines: [inp.hint] };
    const g = funnel.gates.find((x) => x.id === id);
    if (g)
      return {
        title: `${g.label} · ${g.stopped.length} stopped of ${g.reached} checked`,
        lines: [g.blurb, ...g.stopped.slice(0, 4).map((r) => `${r.requestId} · ${r.action} ${r.amount ?? ""} → ${r.reason}`), ...(g.stopped.length > 4 ? [`+${g.stopped.length - 4} more`] : [])],
      };
    switch (id) {
      case "brain":
        return { title: model, lines: ["Same model, prompt and settings for both agents.", `${counts.brainA + counts.brainB} proposals this run (one per agent per step).`, "It only proposes; it can't move funds."] };
      case "red":
        return { title: "Red team & owner console", lines: ["Scripted attacks (§7) and your own manual requests.", `${counts.redA} sent to A, ${counts.redB} to B's vault.`] };
      case "agent_a":
        return { title: "Agent A · baseline", lines: ["No vault: every request goes straight to the venue.", `${counts.aVenue} requests, ${counts.aVenue - counts.aFailed} executed.`] };
      case "agent_b":
        return { title: "Agent B · constrained", lines: ["Every request must pass the vault's checks, top to bottom.", `${funnel.total} requests: ${counts.bExec} executed, ${counts.blocked} blocked.`] };
      case "blocked":
        return { title: `Blocked by the vault · ${counts.blocked}`, lines: ["Rejected before reaching the venue. Nothing executed, nothing spent."] };
      case "venue":
        return {
          title: "Venue · paper fills",
          lines: [
            "Simulated execution, priced from the frozen snapshot with NEAR Intents route costs.",
            `Agent A: ${counts.aVenue - counts.aFailed} executed${counts.aOut ? `, ${counts.aOut} paid out to addresses the request chose (no pinning)` : ""}`,
            `Agent B: ${counts.bExec} executed: ${counts.bExec - counts.bOut} kept in the vault, ${counts.bOut} sent to the owner's pinned address${counts.bFailed ? `; ${counts.bFailed} failed or held (fail-closed)` : ""}`,
          ],
        };
    }
    return null;
  };
  const anchor = (id: string): P => {
    const inp = INPUTS.find((x) => x.id === id);
    if (inp) return inp.p;
    const gi = GATES.findIndex((g) => g.id === id);
    if (gi >= 0) return gateP(gi);
    return ({ brain: BRAIN, red: RED, agent_a: AG_A, agent_b: AG_B, blocked: BLOCKED, venue: VENUE } as Record<string, P>)[id] ?? [0, 0];
  };
  const hov = hover ? tip(hover) : null;
  const hp = hover ? anchor(hover) : null;

  const focusable = (id: string, label: string) => ({
    tabIndex: 0,
    role: "img" as const,
    "aria-label": label,
    onPointerEnter: () => setHover(id),
    onPointerLeave: () => setHover((h) => (h === id ? null : h)),
    onFocus: () => setHover(id),
    onBlur: () => setHover((h) => (h === id ? null : h)),
    className: "cursor-default outline-none",
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-viz-a" /> Agent A · baseline</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-viz-b" /> Agent B · through the vault</span>
        <span className="inline-flex items-center gap-1.5"><span className="text-clean">✓</span> executed</span>
        <span className="inline-flex items-center gap-1.5"><span className="text-reject">✕</span> blocked</span>
        <span>Line thickness = number of requests</span>
        <button type="button" onClick={replay} className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs text-foreground hover:border-accent/50">
          <RotateCcw className="size-3.5" /> Replay run
        </button>
      </div>

      <div ref={rootRef} className="relative overflow-x-auto">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[760px]" role="group" aria-label="How requests flow from the model through each agent and the vault">
          <defs>
            <radialGradient id="brainGlow">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="60%" stopColor="var(--accent-2)" stopOpacity="0.06" />
              <stop offset="100%" stopColor="var(--accent-2)" stopOpacity="0" />
            </radialGradient>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* column captions */}
          {[[70, "Inputs"], [255, "Model"], [455, "Agents"], [GX, "Vault checks (in order)"], [915, "Outcome"]].map(([x, t]) => (
            <text key={t as string} x={x as number} y={22} textAnchor="middle" className="fill-muted font-mono" fontSize={10} letterSpacing="0.14em">{(t as string).toUpperCase()}</text>
          ))}

          {/* brain mesh (decorative) */}
          <ellipse cx={BRAIN[0]} cy={BRAIN[1]} rx={125} ry={140} fill="url(#brainGlow)" />
          <g aria-hidden="true">
            {net.links.map(([a, b], i) => (
              <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="var(--accent-2)" strokeOpacity={0.16} strokeWidth={0.8} />
            ))}
            {net.pts.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={i % 5 === 0 ? 2.6 : 1.8} fill={i % 3 === 0 ? "var(--accent)" : "var(--accent-2)"} className="brain-node" style={{ animationDelay: `${net.delays[i]}s` }} />
            ))}
          </g>

          {/* inputs → model */}
          {INPUTS.map((inp) => (
            <g key={inp.id}>
              <path d={d(curveH([inp.p[0] + 8, inp.p[1]], [BRAIN[0] - 30, BRAIN[1] + (inp.p[1] - BRAIN[1]) * 0.25]))} fill="none" stroke="var(--viz-axis)" strokeWidth={1.2} />
              <g {...focusable(inp.id, `${inp.label}: ${inp.hint}`)}>
                <circle cx={inp.p[0]} cy={inp.p[1]} r={14} fill="transparent" />
                <circle cx={inp.p[0]} cy={inp.p[1]} r={6} fill="var(--surface)" stroke="var(--accent-2)" strokeWidth={1.5} />
                <text x={inp.p[0]} y={inp.p[1] - 13} textAnchor="middle" className="fill-foreground" fontSize={12}>{inp.label}</text>
              </g>
            </g>
          ))}

          {/* flows */}
          <g fill="none" strokeLinecap="round">
            <path d={d(EDGE.brainB)} stroke="var(--viz-b)" strokeOpacity={0.55} strokeWidth={width(counts.brainB, maxFlow)} />
            <path d={d(EDGE.brainA)} stroke="var(--viz-a)" strokeOpacity={0.55} strokeWidth={width(counts.brainA, maxFlow)} />
            <path d={d(EDGE.redB)} stroke="var(--viz-b)" strokeOpacity={0.35} strokeWidth={width(counts.redB, maxFlow)} />
            <path d={d(EDGE.redA)} stroke="var(--viz-a)" strokeOpacity={0.35} strokeWidth={width(counts.redA, maxFlow)} />
            <path d={d(EDGE.aVenue)} stroke="var(--viz-a)" strokeOpacity={0.55} strokeWidth={width(counts.aVenue, maxFlow)} />
            <path d={d(EDGE.bGate)} stroke="var(--viz-b)" strokeOpacity={0.55} strokeWidth={width(funnel.total, maxFlow)} />
            {funnel.gates.slice(0, -1).map((g, i) => (
              <path key={g.id} d={d(chain(i))} stroke="var(--viz-b)" strokeOpacity={0.55} strokeWidth={width(funnel.gates[i + 1].reached, maxFlow)} />
            ))}
            <path d={d(EDGE.passVenue)} stroke="var(--viz-b)" strokeOpacity={0.55} strokeWidth={width(funnel.passed, maxFlow)} />
            {funnel.gates.map((g, i) =>
              g.stopped.length ? (
                <path key={g.id} d={d(branch(i))} stroke="var(--reject)" strokeOpacity={0.5} strokeWidth={width(g.stopped.length, maxFlow)} />
              ) : null,
            )}
          </g>
          <text x={690} y={474} textAnchor="middle" className="fill-muted" fontSize={11}>no checks</text>

          {/* model node */}
          <g {...focusable("brain", `${model}. Same model for both agents.`)}>
            <circle cx={BRAIN[0]} cy={BRAIN[1]} r={30} fill="var(--surface)" stroke="var(--accent)" strokeWidth={1.5} filter="url(#glow)" />
            <text x={BRAIN[0]} y={BRAIN[1] + 4} textAnchor="middle" className="fill-foreground font-mono" fontSize={12}>LLM</text>
            <text x={BRAIN[0]} y={BRAIN[1] + 150} textAnchor="middle" className="fill-muted font-mono" fontSize={11}>{model}</text>
          </g>

          {/* red team */}
          <g {...focusable("red", "Red team and owner console: scripted attacks and manual requests")}>
            <circle cx={RED[0]} cy={RED[1]} r={18} fill="transparent" />
            <rect x={RED[0] - 9} y={RED[1] - 9} width={18} height={18} rx={4} fill="var(--surface)" stroke="var(--reject)" strokeWidth={1.5} />
            <text x={RED[0] - 18} y={RED[1] + 4} textAnchor="end" className="fill-foreground" fontSize={12}>Red team &amp; console</text>
          </g>

          {/* agents */}
          {([["agent_b", AG_B, "var(--viz-b)", "Agent B", "constrained"], ["agent_a", AG_A, "var(--viz-a)", "Agent A", "baseline"]] as const).map(([id, p, c, name, role]) => (
            <g key={id} {...focusable(id, `${name}, ${role}`)}>
              <circle cx={p[0]} cy={p[1]} r={18} fill="var(--surface)" stroke={c} strokeWidth={2} filter="url(#glow)" />
              <text x={p[0]} y={p[1] + 4} textAnchor="middle" className="fill-foreground font-mono" fontSize={12}>{name.slice(-1)}</text>
              <text x={p[0]} y={p[1] - 26} textAnchor="middle" className="fill-foreground" fontSize={12}>{name} · {role}</text>
            </g>
          ))}

          {/* vault gates */}
          <rect x={GX - 26} y={GY0 - 22} width={BRANCH_X - GX + 40} height={GSTEP * LAST_GATE + 44} rx={8} fill="none" stroke="var(--viz-axis)" />
          {funnel.gates.map((g, i) => {
            const [x, y] = gateP(i);
            const hit = g.stopped.length > 0;
            return (
              <g key={g.id} {...focusable(g.id, `${g.label}: ${g.stopped.length} stopped of ${g.reached} checked`)}>
                <rect x={x - 14} y={y - GSTEP / 2} width={BRANCH_X - x + 14} height={GSTEP} fill="transparent" />
                <circle cx={x} cy={y} r={8} fill="var(--surface)" stroke={hit ? "var(--reject)" : "var(--viz-b)"} strokeWidth={1.5} />
                <text x={x + 18} y={y + 4} className="fill-foreground" fontSize={12}>{g.label}</text>
                {hit && (
                  <text x={BRANCH_X - 6} y={y + 4} textAnchor="end" className="fill-muted font-mono" fontSize={11}>
                    <tspan className="fill-reject">✕</tspan> {g.stopped.length}
                  </text>
                )}
              </g>
            );
          })}

          {/* outcomes */}
          <g {...focusable("blocked", `Blocked by the vault: ${counts.blocked}`)}>
            <circle cx={BLOCKED[0]} cy={BLOCKED[1]} r={22} fill="var(--reject-bg)" stroke="var(--reject)" strokeWidth={1.5} />
            <text x={BLOCKED[0]} y={BLOCKED[1] + 5} textAnchor="middle" className="fill-foreground font-mono" fontSize={14}>{counts.blocked}</text>
            <text x={BLOCKED[0]} y={BLOCKED[1] + 42} textAnchor="middle" className="fill-foreground" fontSize={12}>✕ Blocked</text>
          </g>
          <g {...focusable("venue", `Venue: A ${counts.aVenue - counts.aFailed} executed, B ${counts.bExec} executed`)}>
            <circle cx={VENUE[0]} cy={VENUE[1]} r={22} fill="var(--clean-bg)" stroke="var(--clean)" strokeWidth={1.5} />
            <text x={VENUE[0]} y={VENUE[1] + 5} textAnchor="middle" className="fill-foreground font-mono" fontSize={14}>{counts.aVenue - counts.aFailed + counts.bExec}</text>
            <text x={VENUE[0]} y={VENUE[1] - 32} textAnchor="middle" className="fill-foreground" fontSize={12}>✓ Executed</text>
          </g>

          {/* particles: each request travels its route; a ring pulses where it ends (and at the gate that stopped it) */}
          {particles.map((p) => {
            const color = p.agent === "agent_a" ? "var(--viz-a)" : "var(--viz-b)";
            const b = `${p.begin.toFixed(3)}s`;
            const endAt = `${(p.begin + p.dur).toFixed(3)}s`;
            return (
              <g key={p.key} aria-hidden="true">
                <circle r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} opacity={0} filter="url(#glow)">
                  <set attributeName="opacity" to="1" begin={b} dur={`${p.dur.toFixed(3)}s`} />
                  <animateMotion path={p.d} begin={b} dur={`${p.dur.toFixed(3)}s`} />
                </circle>
                {p.gate && (
                  <circle cx={p.gate[0]} cy={p.gate[1]} r={8} fill="none" stroke="var(--reject)" strokeWidth={2} opacity={0}>
                    <animate attributeName="r" from="8" to="20" begin={`${(p.begin + p.gateAt).toFixed(3)}s`} dur="0.7s" />
                    <animate attributeName="opacity" values="0.9;0" begin={`${(p.begin + p.gateAt).toFixed(3)}s`} dur="0.7s" />
                  </circle>
                )}
                <circle cx={p.end[0] + 22} cy={p.end[1]} r={22} fill="none" stroke={p.blocked ? "var(--reject)" : "var(--clean)"} strokeWidth={2} opacity={0}>
                  <animate attributeName="r" from="22" to="34" begin={endAt} dur="0.7s" />
                  <animate attributeName="opacity" values="0.8;0" begin={endAt} dur="0.7s" />
                </circle>
              </g>
            );
          })}
        </svg>

        {hov && hp && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 w-64 rounded-xl border border-line bg-surface-2/95 p-3 text-xs shadow-xl backdrop-blur"
            style={{
              left: `clamp(0px, calc(${(hp[0] / W) * 100}% - 128px), calc(100% - 256px))`,
              top: `calc(${(hp[1] / H) * 100}% + 18px)`,
            }}
          >
            <p className="font-medium text-foreground">{hov.title}</p>
            {hov.lines.map((l, i) => (
              <p key={i} className={`mt-1 ${i === 0 ? "text-muted" : "font-mono text-[11px] text-foreground/80"}`}>{l}</p>
            ))}
          </div>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-5 text-muted">
        Each moving dot is one request. Agent A&apos;s go straight to the venue. Agent B&apos;s must pass every vault check from top to
        bottom; a red branch shows where one was stopped. Hover or tab to any node for details. Exact rows are in the tables below.
      </p>
    </div>
  );
}
