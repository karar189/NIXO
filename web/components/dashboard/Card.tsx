import type { ReactNode } from "react";

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface/90 p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className="whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{title}</h2>
          )}
          <div className="shrink-0">{action}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`block animate-pulse rounded bg-surface-2 ${className}`} />;
}
