"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { nixoApi, type AssetCode, type AssetInfo, type Catalogue } from "@/lib/nixo/experiment";

// One fetch per page load; the agents service caches the 1Click list for 10 minutes.
let cached: Promise<Catalogue> | null = null;

/** The NEAR Intents token catalogue (SYMBOL@chain codes, grouped by chain). */
export function useCatalogue(account: string) {
  const [cat, setCat] = useState<Catalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!account) return;
    let stop = false;
    cached ??= nixoApi.assets(account);
    cached
      .then((c) => !stop && setCat(c))
      .catch((e: Error) => {
        cached = null;
        if (!stop) setError(e.message);
      });
    return () => {
      stop = true;
    };
  }, [account]);
  const byCode = useMemo(() => {
    const m = new Map<AssetCode, AssetInfo>();
    cat?.chains.forEach((g) => g.assets.forEach((a) => m.set(a.code, a)));
    return m;
  }, [cat]);
  return { cat, byCode, error };
}

export const symbolOf = (code: string) => code.split("@")[0];
export const chainOf = (code: string) => (code.split("@")[1] ?? "").split(":")[0];

function fmtPrice(p: number | null) {
  if (p === null) return "—";
  return p >= 1 ? `$${p.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${p.toPrecision(3)}`;
}

/** Searchable token picker grouped by chain. */
export function AssetPicker({
  cat,
  value,
  onChange,
  exclude = [],
  label,
  placeholder,
}: {
  cat: Catalogue | null;
  /** "" shows the placeholder (e.g. an "add" picker) */
  value: AssetCode | "";
  onChange: (code: AssetCode) => void;
  exclude?: AssetCode[];
  label: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (cat?.chains ?? [])
      .map((g) => ({
        chain: g.chain,
        assets: g.assets.filter(
          (a) => !exclude.includes(a.code) && (!needle || a.code.toLowerCase().includes(needle) || a.symbol.toLowerCase().includes(needle)),
        ),
      }))
      .filter((g) => g.assets.length)
      .sort((a, b) => (a.chain === "near" ? -1 : b.chain === "near" ? 1 : a.chain.localeCompare(b.chain)));
  }, [cat, q, exclude]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-background px-3 py-2 text-left text-sm focus:border-accent focus:outline-none"
      >
        {value ? (
          <span className="truncate">
            <span className="font-mono">{symbolOf(value)}</span>
            <span className="ml-1.5 text-[11px] text-muted">on {chainOf(value)}</span>
          </span>
        ) : (
          <span className="truncate text-xs text-muted">{placeholder ?? "Choose a token"}</span>
        )}
        <ChevronDown className="size-4 shrink-0 text-muted" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface shadow-2xl">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Search className="size-3.5 text-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${cat?.count ?? ""} tokens…`}
              aria-label="Search tokens"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
            />
          </div>
          <ul id={listId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto py-1">
            {!cat && <li className="px-3 py-2 text-xs text-muted">Loading NEAR Intents tokens…</li>}
            {cat && !groups.length && <li className="px-3 py-2 text-xs text-muted">No token matches.</li>}
            {groups.map((g) => (
              <li key={g.chain}>
                <p className="sticky top-0 bg-surface px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{g.chain}</p>
                <ul>
                  {g.assets.map((a) => (
                    <li key={a.code}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={a.code === value}
                        onClick={() => {
                          onChange(a.code);
                          setOpen(false);
                          setQ("");
                        }}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-surface-2 ${a.code === value ? "text-accent" : ""}`}
                      >
                        <span className="font-mono">{a.symbol}</span>
                        <span className="font-mono text-[11px] text-muted">{fmtPrice(a.price)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {cat?.source === "fallback" && (
            <p className="border-t border-line px-3 py-2 text-[10px] text-amber-300">1Click unreachable: showing the offline list.</p>
          )}
        </div>
      )}
    </div>
  );
}
