/** NIXO wordmark: a shield-in-diamond glyph plus wide display type. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
        <path d="M12 1.5 22.5 12 12 22.5 1.5 12Z" fill="none" stroke="var(--accent)" strokeWidth="1.4" />
        <path d="M12 6.5 17.5 12 12 17.5 6.5 12Z" fill="var(--accent)" opacity="0.9" />
        <path d="M12 9.2 14.8 12 12 14.8 9.2 12Z" fill="var(--background)" />
      </svg>
      <span className="display text-[13px] tracking-[0.28em] text-foreground">NIXO</span>
    </span>
  );
}
