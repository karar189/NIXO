/**
 * A pixel-fused shape: a small grid pattern rendered as SVG squares.
 * `pattern` is rows of "#" (filled) and "." (empty). Cells carry `data-px`
 * so GSAP can build them in one by one.
 */
export function PixelShape({
  pattern,
  fill = "var(--accent)",
  className = "",
  gap = 0.06,
  rounded = 0,
}: {
  pattern: string[];
  fill?: string;
  className?: string;
  /** gap between cells, as a fraction of a cell */
  gap?: number;
  rounded?: number;
}) {
  const rows = pattern.length;
  const cols = Math.max(...pattern.map((r) => r.length));
  const cells: { x: number; y: number }[] = [];
  pattern.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "#") cells.push({ x, y });
  });
  const size = 1 - gap;
  return (
    <svg viewBox={`0 0 ${cols} ${rows}`} className={className} aria-hidden="true" preserveAspectRatio="none" shapeRendering="crispEdges">
      {cells.map((c) => (
        <rect key={`${c.x}-${c.y}`} data-px x={c.x + gap / 2} y={c.y + gap / 2} width={size} height={size} rx={rounded} fill={fill} className="pixel-cell" />
      ))}
    </svg>
  );
}

/* Patterns. Shapes are drawn so they "fuse" like the reference: a big body with
   stray cells breaking off the edges. */

export const BLOB_WIDE = [
  ".....#..........",
  ".....#......#...",
  "...#######......",
  "...#########....",
  ".##############.",
  "################",
  "################",
  ".##############.",
  "...##########...",
  "...#######.##...",
  ".....#..........",
];

export const BLOB_TALL = [
  "...#....#..",
  "..######...",
  ".########..",
  "##########.",
  "###########",
  "###########",
  ".##########",
  "..########.",
  "..#######..",
  "...##.##...",
  "....#......",
];

export const BLOB_CTA = [
  "......#...............#.....",
  "....######........#####.....",
  "..#########################.",
  ".###########################",
  "############################",
  "############################",
  ".###########################",
  "..########################..",
  "....###########..#######....",
  "......#....#........#.......",
];

export const BLOB_SMALL = ["..#..", ".###.", "#####", ".###.", "..#.#"];

export const CHEVRON = ["#...#...", ".#...#..", "..#...#.", "...#...#", "..#...#.", ".#...#..", "#...#..."];
