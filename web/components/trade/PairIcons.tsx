/** Overlapping circular icons for a BASE/USDC pair (trading-desk style). */

const ICON: Record<string, { src: string; bg: string }> = {
  NEAR: {
    src: "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/near.svg",
    bg: "#000",
  },
  BTC: {
    src: "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/btc.svg",
    bg: "#f7931a",
  },
  ETH: {
    src: "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/eth.svg",
    bg: "#627eea",
  },
  SOL: {
    src: "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/sol.svg",
    bg: "#000",
  },
  USDC: {
    src: "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/usdc.svg",
    bg: "#2775ca",
  },
};

function Coin({ symbol, className = "size-6" }: { symbol: string; className?: string }) {
  const meta = ICON[symbol.toUpperCase()];
  const letter = symbol.slice(0, 1).toUpperCase();
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-background ${className}`}
      style={{ background: meta?.bg ?? "#1a2338" }}
      title={symbol}
    >
      {meta ? (
        <img src={meta.src} alt="" className="size-full object-cover" width={24} height={24} />
      ) : (
        <span className="text-[10px] font-semibold text-foreground">{letter}</span>
      )}
    </span>
  );
}

export function PairIcons({ base, quote = "USDC", size = "md" }: { base: string; quote?: string; size?: "sm" | "md" }) {
  const gap = size === "sm" ? "-space-x-1.5" : "-space-x-2";
  return (
    <span className={`inline-flex items-center ${gap}`} aria-hidden="true">
      <Coin symbol={base} className={size === "sm" ? "size-5" : "size-6"} />
      <Coin symbol={quote} className={size === "sm" ? "size-5" : "size-6"} />
    </span>
  );
}
