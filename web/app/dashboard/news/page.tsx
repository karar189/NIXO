"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { Earth } from "@/components/news/Earth";
import { relativeTime } from "@/lib/markets/format";
import type { NewsCategory, NewsItem, NewsPriority, NewsSentiment, NewsTimeFilter } from "@/lib/markets/types";

const PAGE_SIZE = 8;

const CATEGORIES: NewsCategory[] = [
  "All",
  "NEAR Protocol",
  "NEAR Intents",
  "Market and Prices",
  "Technology",
  "Regulation",
];
const TIME_FILTERS: NewsTimeFilter[] = ["Now", "24H", "7D"];
const PRIORITIES: NewsPriority[] = ["Critical", "High", "Low"];
const TOPICS = ["NEAR Protocol", "NEAR Intents", "Intents", "AI", "DeFi", "Mainnet", "Wallet"];
const REGIONS = ["United States", "EU", "Asia", "Global"];

function SentimentIcon({ sentiment }: { sentiment: NewsSentiment }) {
  if (sentiment === "up") return <TrendingUp className="size-4 text-clean" aria-label="Positive" />;
  if (sentiment === "down") return <TrendingDown className="size-4 text-danger" aria-label="Negative" />;
  return <Minus className="size-4 text-muted" aria-label="Neutral" />;
}

function priorityClass(p: NewsPriority, active: boolean) {
  if (p === "Critical") return active ? "bg-danger/20 text-danger" : "text-danger/80 hover:bg-danger/10";
  if (p === "High") return active ? "bg-accent/20 text-accent" : "text-accent/80 hover:bg-accent/10";
  return active ? "bg-surface-2 text-foreground" : "text-muted hover:bg-surface-2";
}

function faviconFor(source: string) {
  const domain = source.toLowerCase().replace(/[^a-z0-9]+/g, "") + ".com";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

export default function NewsPage() {
  const [articles, setArticles] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const [category, setCategory] = useState<NewsCategory>("All");
  const [timeFilter, setTimeFilter] = useState<NewsTimeFilter>("7D");
  const [priority, setPriority] = useState<NewsPriority | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [topicOpen, setTopicOpen] = useState(false);
  const [regionOpen, setRegionOpen] = useState(false);
  const [tab, setTab] = useState<"feed" | "intents" | "protocol">("feed");
  const [page, setPage] = useState(1);
  const [customSources, setCustomSources] = useState<{ name: string; url: string }[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const fetchNews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        category: tab === "intents" ? "NEAR Intents" : tab === "protocol" ? "NEAR Protocol" : category,
        time_filter: timeFilter,
        page_size: "40",
      });
      if (activeSearch) params.set("q", activeSearch);
      const topic = activeFilters.find((f) => TOPICS.includes(f));
      if (topic) params.set("topic", topic);

      const res = await fetch(`/api/news?${params}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail ?? `News error ${res.status}`);
      }
      const data = (await res.json()) as { articles: NewsItem[]; updatedAt?: string };
      setArticles(data.articles ?? []);
      setUpdatedAt(data.updatedAt ?? new Date().toISOString());
      setPage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load news");
      setArticles([]);
    } finally {
      setLoading(false);
    }
  }, [category, timeFilter, activeSearch, activeFilters, tab]);

  useEffect(() => {
    void fetchNews();
  }, [fetchNews]);

  useEffect(() => {
    setPage(1);
  }, [priority, activeFilters, tab, category, timeFilter, activeSearch]);

  const filtered = useMemo(() => {
    let list = [...articles];
    if (priority) list = list.filter((a) => a.priority === priority);
    if (activeFilters.length) {
      list = list.filter((a) =>
        activeFilters.some(
          (f) =>
            a.headline.toLowerCase().includes(f.toLowerCase()) ||
            a.source.toLowerCase().includes(f.toLowerCase()) ||
            a.tags.some((t) => t.toLowerCase().includes(f.toLowerCase())) ||
            a.category.toLowerCase().includes(f.toLowerCase()),
        ),
      );
    }
    if (tab === "intents") {
      list = list.filter(
        (a) => a.category === "NEAR Intents" || a.tags.includes("NEAR Intents") || /intent/i.test(a.headline),
      );
    }
    if (tab === "protocol") {
      list = list.filter(
        (a) => a.category === "NEAR Protocol" || a.tags.includes("NEAR Protocol") || /near protocol/i.test(a.headline),
      );
    }
    return list;
  }, [articles, priority, activeFilters, tab]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function runSearch() {
    setActiveSearch(searchInput.trim());
  }

  function clearSearch() {
    setSearchInput("");
    setActiveSearch("");
  }

  function addFilter(value: string) {
    setActiveFilters((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setTopicOpen(false);
    setRegionOpen(false);
  }

  function addSource() {
    const name = newName.trim();
    if (!name) return;
    setCustomSources((prev) => [...prev, { name, url: newUrl.trim() }]);
    setNewName("");
    setNewUrl("");
    setAddOpen(false);
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-5.75rem)] min-h-0 w-full max-w-[1600px] flex-col gap-3 overflow-hidden px-3 py-3 sm:gap-4 sm:px-5 sm:py-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="kicker">Desk · Intel</p>
          <h1 className="display mt-1 text-xl sm:text-2xl">News</h1>
          <p className="mt-1 hidden max-w-xl truncate text-sm text-muted sm:block">
            Latest coverage on <span className="text-foreground">NEAR Protocol</span> and{" "}
            <span className="text-foreground">NEAR Intents</span>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchNews()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm text-muted hover:text-foreground"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
          {updatedAt && (
            <span className="font-mono text-[10px] text-muted">· {new Date(updatedAt).toLocaleTimeString()}</span>
          )}
        </button>
      </div>

      {/* Both panels fill remaining viewport height */}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(240px,38%)_minmax(0,1fr)] gap-3 overflow-hidden lg:grid-cols-2 lg:grid-rows-1 lg:gap-4">
        {/* Earth panel */}
        <aside className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface/90">
          <div className="pointer-events-none absolute inset-0 grid-bg opacity-30" aria-hidden />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 70% 60% at 50% 50%, color-mix(in srgb, var(--accent-2) 24%, transparent), transparent 70%)",
            }}
            aria-hidden
          />

          <div className="relative z-10 flex shrink-0 flex-col items-center px-4 pt-4 text-center sm:px-5 sm:pt-5">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-accent">
              <span className="size-1.5 animate-pulse rounded-full bg-accent" />
              Live · NEAR desk
            </span>
            <h2 className="display mt-2 text-xl sm:text-2xl lg:text-3xl">
              Protocol <span className="text-accent-2">&amp; Intents</span>
            </h2>
            <p className="mt-1.5 max-w-md text-[11px] leading-5 text-muted sm:text-xs">
              Global signal map for confidential settlement and NEAR ecosystem coverage.
            </p>
            <p className="mt-1 font-mono text-[11px] text-muted">
              <span className="text-foreground">{filtered.length}</span> signals · {timeFilter}
            </p>
          </div>

          <div className="relative z-10 mx-auto min-h-0 w-full max-w-[560px] flex-1 overflow-hidden px-3 py-2 sm:px-5">
            <Earth interactive />
          </div>

          <div className="relative z-10 flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-line px-4 py-2.5 sm:px-5">
            <span className="text-[10px] uppercase tracking-wider text-muted">Signals</span>
            {["NEAR Protocol", "NEAR Intents", "Confidential", "1Click"].map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => addFilter(chip)}
                className="rounded-md border border-line bg-background/60 px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-accent/40 hover:text-foreground"
              >
                {chip}
              </button>
            ))}
          </div>
        </aside>

        {/* Feed panel — fixed height, list scrolls inside */}
        <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface/90">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="flex rounded-lg border border-line bg-background p-0.5" role="tablist">
              {(
                [
                  ["feed", "Feed"],
                  ["intents", "NEAR Intents"],
                  ["protocol", "NEAR Protocol"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`rounded-md px-3 py-1.5 text-sm ${
                    tab === id ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              <Plus className="size-3.5" /> Add source
            </button>
          </div>

          <div className="shrink-0 space-y-3 border-b border-line px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[160px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runSearch()}
                  placeholder="Search NEAR, Intents, source…"
                  className="w-full rounded-lg border border-line bg-background py-2 pl-9 pr-9 text-sm focus:border-accent focus:outline-none"
                />
                {(searchInput || activeSearch) && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={runSearch}
                className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm hover:border-accent/40"
              >
                Search
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setCategory(cat);
                    if (tab !== "feed") setTab("feed");
                  }}
                  className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                    category === cat && tab === "feed"
                      ? "bg-accent/15 text-accent"
                      : "text-muted hover:bg-surface-2 hover:text-foreground"
                  }`}
                >
                  {cat}
                </button>
              ))}
              <div className="ml-auto flex rounded-md border border-line bg-background p-0.5">
                {TIME_FILTERS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTimeFilter(t)}
                    className={`rounded px-2 py-0.5 font-mono text-[10px] ${
                      timeFilter === t ? "bg-surface-2 text-foreground" : "text-muted"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(priority === p ? null : p)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${priorityClass(p, priority === p)}`}
                >
                  {p}
                </button>
              ))}

              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setTopicOpen((v) => !v);
                    setRegionOpen(false);
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-foreground"
                >
                  + Topic <ChevronDown className="size-3.5" />
                </button>
                {topicOpen && (
                  <div className="absolute left-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
                    {TOPICS.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => addFilter(t)}
                        className="block w-full px-3 py-2 text-left text-xs hover:bg-surface-2"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setRegionOpen((v) => !v);
                    setTopicOpen(false);
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-foreground"
                >
                  + Region <ChevronDown className="size-3.5" />
                </button>
                {regionOpen && (
                  <div className="absolute left-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
                    {REGIONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => addFilter(r)}
                        className="block w-full px-3 py-2 text-left text-xs hover:bg-surface-2"
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setActiveFilters([]);
                  setPriority(null);
                  clearSearch();
                  setCategory("All");
                  setTimeFilter("7D");
                  setTab("feed");
                }}
                className="rounded-full px-3 py-1 text-xs text-danger hover:bg-danger/10"
              >
                Clear
              </button>
            </div>

            {activeFilters.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {activeFilters.map((f) => (
                  <span
                    key={f}
                    className="inline-flex items-center gap-1 rounded-full bg-accent-2/15 px-2.5 py-1 text-[11px] text-accent-2"
                  >
                    {f}
                    <button
                      type="button"
                      aria-label={`Remove ${f}`}
                      onClick={() => setActiveFilters((prev) => prev.filter((x) => x !== f))}
                      className="rounded-full p-0.5 hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {customSources.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-muted">Your sources</span>
                {customSources.map((s, i) => (
                  <span key={`${s.name}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[11px]">
                    {s.name}
                    <button
                      type="button"
                      onClick={() => setCustomSources((prev) => prev.filter((_, j) => j !== i))}
                      className="rounded-full p-0.5 text-muted hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
                <Loader2 className="size-4 animate-spin" /> Loading signals…
              </div>
            ) : error ? (
              <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-8 text-center text-sm text-danger">
                {error}
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line px-4 py-12 text-center text-sm text-muted">
                No stories for the current filters. Try widening time or clearing topics.
              </div>
            ) : (
              <ul className="space-y-3">
                {pageItems.map((item) => (
                  <li key={item.id}>
                    <article className="rounded-xl border border-line bg-background/40 p-3.5 transition-colors hover:bg-surface-2/40">
                      <div className="flex gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={faviconFor(item.source)}
                          alt=""
                          className="size-9 shrink-0 rounded-lg border border-line bg-surface object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                            <span className="font-medium text-foreground/80">{item.source}</span>
                            <span>{item.sourceHandle}</span>
                            <span>·</span>
                            <span>{item.time || relativeTime(item.publishedAt)}</span>
                            <SentimentIcon sentiment={item.sentiment} />
                          </div>
                          <h3 className="mt-1.5 text-sm font-medium leading-snug text-foreground">{item.headline}</h3>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span className="rounded-md border border-line px-1.5 py-0.5 text-[10px] text-muted">
                              {item.category}
                            </span>
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[10px] ${
                                item.priority === "Critical"
                                  ? "bg-danger/15 text-danger"
                                  : item.priority === "High"
                                    ? "bg-accent/15 text-accent"
                                    : "bg-surface-2 text-muted"
                              }`}
                            >
                              {item.priority}
                            </span>
                            {item.tags.slice(0, 2).map((t) => (
                              <span key={t} className="rounded-md bg-accent-2/10 px-1.5 py-0.5 text-[10px] text-accent-2">
                                {t}
                              </span>
                            ))}
                          </div>
                          {item.link && (
                            <a
                              href={item.link}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent-2 hover:underline"
                            >
                              Read article <ExternalLink className="size-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!loading && !error && filtered.length > 0 && (
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-4 py-3">
              <p className="font-mono text-[11px] text-muted">
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs text-muted disabled:opacity-40 hover:text-foreground"
                >
                  <ChevronLeft className="size-3.5" /> Prev
                </button>
                <span className="font-mono text-[11px] text-muted">
                  {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs text-muted disabled:opacity-40 hover:text-foreground"
                >
                  Next <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal>
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <h2 className="display text-lg">Add news source</h2>
            <p className="mt-1 text-xs text-muted">Saved locally in this session for your desk filters.</p>
            <div className="mt-4 space-y-3">
              <label className="block text-xs text-muted">
                Name
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  placeholder="e.g. NEAR Blog"
                />
              </label>
              <label className="block text-xs text-muted">
                URL or handle
                <input
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  placeholder="https://… or @handle"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="rounded-full border border-line px-4 py-2 text-sm text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addSource}
                className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
              >
                Add source
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
