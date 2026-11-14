"use client";

const FALLBACK: Record<string, { src: string; bg: string }> = {
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

export function TokenIcon({
  symbol,
  image,
  size = 28,
}: {
  symbol: string;
  image?: string | null;
  size?: number;
}) {
  const sym = symbol.toUpperCase();
  const fallback = FALLBACK[sym];
  const src = image || fallback?.src;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line"
      style={{ width: size, height: size, background: fallback?.bg ?? "#191d32" }}
      title={sym}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} className="size-full object-cover" />
      ) : (
        <span className="text-[10px] font-semibold text-foreground">{sym.slice(0, 1)}</span>
      )}
    </span>
  );
}
