export type Status = "live" | "build";

/** Small honesty tag: what is deployed on testnet versus what is still being built. */
export function StatusTag({ status, onLight = false }: { status: Status; onLight?: boolean }) {
  const base = "inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[9px] tracking-[0.18em] uppercase";
  if (status === "live") {
    return (
      <span className={`${base} ${onLight ? "border-black/30 text-black" : "border-accent/50 text-accent"}`}>
        <span className={`size-1.5 ${onLight ? "bg-black" : "bg-accent"}`} /> Live on testnet
      </span>
    );
  }
  return (
    <span className={`${base} ${onLight ? "border-black/20 text-black/60" : "border-line text-muted"}`}>
      <span className={`size-1.5 ${onLight ? "bg-black/40" : "bg-muted/60"}`} /> In build
    </span>
  );
}
