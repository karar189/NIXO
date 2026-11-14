/** Overlapping circular pair icons — inline SVGs, no CDN. */

import type { ReactElement } from "react";

function NearMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#000" />
      <path
        fill="#fff"
        d="M15.66 6.2c-.2-.28-.52-.4-.86-.32l-4.1 1.1c-.28.08-.5.28-.6.54L7.2 15.7c-.1.28 0 .58.24.78.14.12.32.18.5.18.1 0 .2-.02.3-.06l4.1-1.1c.28-.08.5-.28.6-.54l2.9-8.18c.1-.28 0-.58-.18-.78Zm-4.4 8.9-2.7.72 2.18-6.16 2.7-.72-2.18 6.16Z"
      />
    </svg>
  );
}

function UsdcMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#2775CA" />
      <path
        fill="#fff"
        d="M12 4.5c-4.14 0-7.5 3.36-7.5 7.5S7.86 19.5 12 19.5s7.5-3.36 7.5-7.5S16.14 4.5 12 4.5Zm0 13.4c-3.25 0-5.9-2.65-5.9-5.9S8.75 6.1 12 6.1s5.9 2.65 5.9 5.9-2.65 5.9-5.9 5.9Zm.7-9.2v-.9h-1.4v.92c-1.18.14-2 .78-2 1.78 0 1.08.78 1.6 2.18 1.9l.72.16c.78.18 1.18.38 1.18.84 0 .48-.46.8-1.28.8-.82 0-1.36-.36-1.5-.98l-1.28.3c.24 1.08 1.1 1.72 2.52 1.88v.94h1.4v-.94c1.2-.14 2.1-.8 2.1-1.92 0-1.16-.86-1.72-2.28-2.04l-.7-.16c-.7-.16-1.1-.36-1.1-.78 0-.44.4-.74 1.1-.74.7 0 1.14.32 1.26.84l1.26-.28c-.22-1.02-.98-1.66-2.28-1.82Z"
      />
    </svg>
  );
}

function BtcMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#F7931A" />
      <path
        fill="#fff"
        d="M15.4 10.7c.2-1.36-.84-2.1-2.26-2.58l.46-1.86-1.12-.28-.45 1.8c-.3-.08-.6-.14-.9-.2l.45-1.8-1.12-.28-.46 1.86c-.24-.06-.48-.1-.71-.16l-1.54-.38-.3 1.2s.84.2.82.2c.46.12.54.42.52.68l-.52 2.1c.04 0 .08.02.12.04l-.12-.03-.74 2.94c-.06.14-.2.34-.5.26.02.02-.82-.2-.82-.2l-.56 1.3 1.46.36c.28.08.54.14.8.2l-.46 1.88 1.12.28.46-1.86c.3.08.6.16.9.22l-.46 1.84 1.12.28.46-1.88c1.9.36 3.32.22 3.92-1.5.48-1.4-.02-2.2-1.02-2.72.72-.16 1.26-.64 1.4-1.62Zm-2.5 3.5c-.34 1.38-2.66.64-3.42.44l.62-2.46c.76.2 3.18.56 2.8 2.02Zm.34-3.54c-.32 1.26-2.26.62-2.9.46l.56-2.22c.64.16 2.68.46 2.34 1.76Z"
      />
    </svg>
  );
}

function EthMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#627EEA" />
      <path fill="#fff" fillOpacity=".6" d="M12.1 4.5v5.5l4.65 2.08L12.1 4.5Z" />
      <path fill="#fff" d="M12.1 4.5 7.45 12.08 12.1 10V4.5Z" />
      <path fill="#fff" fillOpacity=".6" d="M12.1 16.48v3.02l4.66-6.46-4.66 3.44Z" />
      <path fill="#fff" d="M12.1 19.5v-3.02l-4.65-3.44L12.1 19.5Z" />
      <path fill="#fff" fillOpacity=".2" d="m12.1 15.5 4.65-3.42L12.1 10v5.5Z" />
      <path fill="#fff" fillOpacity=".6" d="m7.45 12.08 4.65 3.42V10l-4.65 2.08Z" />
    </svg>
  );
}

function SolMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="solGrad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#9945FF" />
          <stop offset="50%" stopColor="#14F195" />
          <stop offset="100%" stopColor="#00D1FF" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="12" fill="#000" />
      <path
        fill="url(#solGrad)"
        d="M7.4 14.7c.1-.1.3-.2.5-.2h8.7c.3 0 .5.4.2.6l-1.5 1.5c-.1.1-.3.2-.5.2H6.1c-.3 0-.5-.4-.2-.6l1.5-1.5Zm0-7.2c.1-.1.3-.2.5-.2h8.7c.3 0 .5.4.2.6l-1.5 1.5c-.1.1-.3.2-.5.2H6.1c-.3 0-.5-.4-.2-.6l1.5-1.5Zm9.2 3.4c-.1-.1-.3-.2-.5-.2H7.4c-.3 0-.5.4-.2.6l1.5 1.5c.1.1.3.2.5.2h8.7c.3 0 .5-.4.2-.6l-1.5-1.5Z"
      />
    </svg>
  );
}

const MARK: Record<string, (p: { className?: string }) => ReactElement> = {
  NEAR: NearMark,
  USDC: UsdcMark,
  BTC: BtcMark,
  ETH: EthMark,
  SOL: SolMark,
};

function Coin({ symbol, className = "size-6" }: { symbol: string; className?: string }) {
  const Mark = MARK[symbol.toUpperCase()];
  const letter = symbol.slice(0, 1).toUpperCase();
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-surface-2 ${className}`}
      title={symbol}
    >
      {Mark ? (
        <Mark className="size-full" />
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
