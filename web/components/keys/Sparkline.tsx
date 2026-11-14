/** Cumulative-PnL line. Green when the last point is >= 0, red otherwise. */
export function Sparkline({ points, height = 36, className = "" }: { points: [number, number][]; height?: number; className?: string }) {
  if (points.length < 2) {
    return <div className={`flex items-center text-[10px] text-muted ${className}`} style={{ height }}>no closed trades yet</div>;
  }
  const w = 200;
  const ys = [0, ...points.map((p) => p[1])];
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const xy = (i: number, v: number) => [(i / (points.length - 1)) * w, height - 2 - ((v - min) / span) * (height - 4)];
  const d = points.map((p, i) => xy(i, p[1]).map((n) => n.toFixed(1)).join(",")).join(" ");
  const zeroY = xy(0, 0)[1];
  const up = points[points.length - 1][1] >= 0;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={`w-full ${up ? "text-clean" : "text-danger"} ${className}`} style={{ height }} aria-hidden>
      <line x1="0" x2={w} y1={zeroY} y2={zeroY} className="stroke-line" strokeDasharray="3 3" strokeWidth="1" />
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
