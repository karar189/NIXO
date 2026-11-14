import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Skeleton } from "./Card";

/* ------------------------------------------------------------------ header */

export function PageHeader({
  kicker,
  title,
  description,
  actions,
  className = "",
}: {
  kicker: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-4 ${className}`}>
      <div className="min-w-0">
        <p className="kicker">{kicker}</p>
        <h1 className="display mt-2 text-[clamp(1.5rem,2.4vw,2rem)]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- stats */

export type DeltaTone = "up" | "down" | "flat";

export function Delta({ tone, children }: { tone: DeltaTone; children: ReactNode }) {
  const cls = tone === "up" ? "text-clean" : tone === "down" ? "text-reject" : "text-muted";
  return <span className={`font-medium tabular-nums ${cls}`}>{children}</span>;
}

/**
 * Monad-style stat card: title + icon on top, big grotesk value with a small
 * mono unit, a caption line and an optional delta / action at the bottom.
 * `value === null` renders a skeleton.
 */
export function StatCard({
  title,
  icon,
  value,
  unit,
  caption,
  delta,
  tone = "default",
  action,
  href,
  className = "",
}: {
  title: string;
  icon?: ReactNode;
  value: ReactNode | null;
  unit?: string;
  caption?: ReactNode;
  delta?: { tone: DeltaTone; label: string } | null;
  tone?: "default" | "clean" | "reject" | "warn" | "accent";
  action?: ReactNode;
  href?: string;
  className?: string;
}) {
  const valueTone =
    tone === "clean" ? "text-clean" : tone === "reject" ? "text-reject" : tone === "warn" ? "text-warn" : tone === "accent" ? "text-accent" : "";
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 text-muted">
        <p className="text-[13px] font-medium text-foreground/90">{title}</p>
        {icon && <span className="[&>svg]:size-4">{icon}</span>}
      </div>
      <div className="mt-3 flex min-h-9 items-baseline gap-2">
        {value === null ? (
          <Skeleton className="h-8 w-28" />
        ) : (
          <>
            <p className={`display truncate text-[1.75rem] ${valueTone}`}>{value}</p>
            {unit && <span className="font-mono text-[11px] text-muted">{unit}</span>}
          </>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted">
        <span className="min-w-0 truncate">{caption}</span>
        {action ?? (delta ? <Delta tone={delta.tone}>{delta.label}</Delta> : href ? <ArrowUpRight className="size-3.5 shrink-0 text-muted" /> : null)}
      </div>
    </>
  );
  const cls = `panel group flex flex-col justify-between p-5 ${href ? "transition-colors hover:border-muted/60" : ""} ${className}`;
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <article className={cls}>{body}</article>
  );
}

/* -------------------------------------------------------------------- misc */

export type TagTone = "clean" | "reject" | "warn" | "mock" | "muted" | "accent";

export function Tag({ tone = "muted", children, title }: { tone?: TagTone; children: ReactNode; title?: string }) {
  const cls = {
    clean: "border-clean/40 bg-clean-bg text-clean",
    reject: "border-reject/40 bg-reject-bg text-reject",
    warn: "border-warn/40 bg-warn-bg text-warn",
    mock: "border-mock/40 bg-mock-bg text-mock",
    muted: "border-line text-muted",
    accent: "border-accent/40 bg-accent/10 text-accent",
  }[tone];
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${cls}`}>
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className = "",
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-8 text-center ${className}`}>
      {icon && <span className="flex size-11 items-center justify-center rounded-lg border border-line bg-surface-2 text-accent [&>svg]:size-5">{icon}</span>}
      <p className="mt-4 font-medium">{title}</p>
      {body && <p className="mt-1 max-w-xs text-sm leading-6 text-balance text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Mono key / value row used in detail lists. */
export function KV({ k, v, mono = true }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-xs">
      <dt className="text-muted">{k}</dt>
      <dd className={`min-w-0 truncate text-right ${mono ? "font-mono" : ""}`}>{v}</dd>
    </div>
  );
}
