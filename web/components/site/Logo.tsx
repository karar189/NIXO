/** NIXO wordmark: a pixel-fused glyph plus wide tracked type. */
export function Logo({ className = "", light = false }: { className?: string; light?: boolean }) {
  const ink = light ? "var(--accent-ink)" : "var(--accent)";
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 5 5" className="size-6" aria-hidden="true" shapeRendering="crispEdges">
        {/* a 5×5 fused blob: body plus two stray cells */}
        {[
          [1, 0],
          [0, 1],
          [1, 1],
          [2, 1],
          [3, 1],
          [1, 2],
          [2, 2],
          [3, 2],
          [4, 2],
          [1, 3],
          [2, 3],
          [3, 3],
          [2, 4],
          [4, 4],
        ].map(([x, y]) => (
          <rect key={`${x}${y}`} x={x + 0.04} y={y + 0.04} width="0.92" height="0.92" fill={ink} />
        ))}
      </svg>
      <span className="wordmark text-[13px] text-current">NIXO</span>
    </span>
  );
}
