import type { ReactNode } from "react";

/**
 * Dashboard panel. Rounded border surface with an optional header
 * (title / icon / tag / action). `flush` drops body padding for tables/charts.
 */
export function Card({
  title,
  icon,
  tag,
  description,
  action,
  children,
  className = "",
  bodyClassName = "",
  flush = false,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  tag?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;
}) {
  const hasHeader = title || action || tag;
  return (
    <section
      className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface/90 ${flush ? "" : "p-5"} ${className}`}
    >
      {hasHeader && (
        <header
          className={`flex items-start justify-between gap-3 ${flush ? "px-5 pt-5" : ""} ${description ? "mb-3" : "mb-4"}`}
        >
          <div className="min-w-0 flex-1">
            {title && (
              <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                {icon && <span className="text-muted [&>svg]:size-4">{icon}</span>}
                <span className="truncate">{title}</span>
              </h2>
            )}
            {description && <p className="mt-1 text-xs leading-5 text-muted">{description}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {tag && (
              <span className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                {tag}
              </span>
            )}
            {action}
          </div>
        </header>
      )}
      <div className={`flex min-h-0 flex-1 flex-col ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`block animate-pulse rounded bg-surface-2 ${className}`} />;
}
