import { NextResponse } from "next/server";
import type { NewsCategory, NewsItem, NewsPriority, NewsSentiment } from "@/lib/markets/types";

const FEEDS = [
  {
    id: "near-protocol",
    tag: "NEAR Protocol" as const,
    url: "https://news.google.com/rss/search?q=%22NEAR%20Protocol%22%20OR%20%22NEAR%20blockchain%22&hl=en-US&gl=US&ceid=US:en",
  },
  {
    id: "near-intents",
    tag: "NEAR Intents" as const,
    url: "https://news.google.com/rss/search?q=%22NEAR%20Intents%22%20OR%20%22Confidential%20Intents%22%20OR%20%22intents.near%22&hl=en-US&gl=US&ceid=US:en",
  },
  {
    id: "near-general",
    tag: "NEAR Protocol" as const,
    url: "https://news.google.com/rss/search?q=NEAR%20crypto%20OR%20NEAR%20DeFi%20OR%20%22wrap.near%22&hl=en-US&gl=US&ceid=US:en",
  },
] as const;

const CATEGORY_KEYWORDS: Record<Exclude<NewsCategory, "All" | "NEAR Protocol" | "NEAR Intents">, string[]> = {
  Regulation: ["sec", "regulation", "law", "legal", "ban", "compliance", "lawsuit", "policy", "government"],
  Technology: ["upgrade", "protocol", "mainnet", "testnet", "integration", "developer", "smart contract", "zk", "sharding", "ai"],
  "Market and Prices": ["price", "rally", "bull", "bear", "surge", "crash", "dip", "market", "trading", "volume", "etf"],
};

const HIGH_IMPACT = ["hack", "breach", "ban", "crash", "sec", "lawsuit", "partnership", "mainnet", "launch", "billion"];
const POSITIVE = ["surge", "rally", "gain", "record", "partnership", "launch", "upgrade", "growth", "adoption"];
const NEGATIVE = ["crash", "hack", "ban", "lawsuit", "decline", "loss", "exploit", "scam", "drop"];

type RawItem = {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  feedTag: "NEAR Protocol" | "NEAR Intents";
};

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(s: string) {
  return decodeEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function parseRss(xml: string, feedTag: "NEAR Protocol" | "NEAR Intents"): RawItem[] {
  const items: RawItem[] = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks) {
    const title = stripTags((block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/^<!\[CDATA\[|\]\]>$/g, ""));
    const link = stripTags(block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? "");
    const pubDate = stripTags(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "");
    const source =
      stripTags(block.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] ?? "") ||
      stripTags((block.match(/<font[^>]*>([\s\S]*?)<\/font>/i)?.[1] ?? "")) ||
      "News";
    if (!title || !link) continue;
    items.push({ title, link, pubDate, source, feedTag });
  }
  return items;
}

function classifyCategory(text: string, feedTag: "NEAR Protocol" | "NEAR Intents"): NewsCategory {
  const t = text.toLowerCase();
  if (feedTag === "NEAR Intents" || t.includes("intent") || t.includes("1click") || t.includes("confidential")) {
    return "NEAR Intents";
  }
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS) as [keyof typeof CATEGORY_KEYWORDS, string[]][]) {
    if (kws.some((k) => t.includes(k))) return cat;
  }
  return "NEAR Protocol";
}

function classifyPriority(text: string): NewsPriority {
  const t = text.toLowerCase();
  const hits = HIGH_IMPACT.filter((w) => t.includes(w)).length;
  if (hits >= 2 || t.includes("hack") || t.includes("exploit")) return "Critical";
  if (hits >= 1) return "High";
  return "Low";
}

function classifySentiment(text: string): NewsSentiment {
  const t = text.toLowerCase();
  const up = POSITIVE.filter((w) => t.includes(w)).length;
  const down = NEGATIVE.filter((w) => t.includes(w)).length;
  if (up > down) return "up";
  if (down > up) return "down";
  return "neutral";
}

function withinTime(iso: string, filter: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return filter === "7D";
  const age = Date.now() - t;
  if (filter === "Now") return age <= 2 * 60 * 60 * 1000;
  if (filter === "24H") return age <= 24 * 60 * 60 * 1000;
  return age <= 7 * 24 * 60 * 60 * 1000;
}

function toItem(raw: RawItem, idx: number): NewsItem {
  const publishedAt = raw.pubDate ? new Date(raw.pubDate).toISOString() : new Date().toISOString();
  const category = classifyCategory(`${raw.title} ${raw.source}`, raw.feedTag);
  const tags: string[] = [raw.feedTag];
  if (category !== raw.feedTag) tags.push(category);
  return {
    id: `${Buffer.from(raw.link).toString("base64url").slice(0, 24)}-${idx}`,
    time: relativeClock(publishedAt),
    publishedAt,
    headline: raw.title,
    source: raw.source,
    sourceHandle: `@${raw.source.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 18) || "news"}`,
    category,
    priority: classifyPriority(raw.title),
    sentiment: classifySentiment(raw.title),
    tags,
    link: raw.link,
  };
}

function relativeClock(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

let cache: { at: number; items: NewsItem[] } | null = null;
const TTL_MS = 5 * 60_000;

async function loadAll(): Promise<NewsItem[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.items;

  const settled = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const res = await fetch(feed.url, {
        headers: {
          Accept: "application/rss+xml, application/xml, text/xml, */*",
          "User-Agent": "NIXO-NewsDesk/1.0",
        },
        signal: AbortSignal.timeout(12_000),
        next: { revalidate: 300 },
      });
      if (!res.ok) throw new Error(`feed ${feed.id} ${res.status}`);
      const xml = await res.text();
      return parseRss(xml, feed.tag);
    }),
  );

  const seen = new Set<string>();
  const merged: RawItem[] = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      const key = item.title.toLowerCase().slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }

  merged.sort((a, b) => Date.parse(b.pubDate || "") - Date.parse(a.pubDate || ""));
  const items = merged.slice(0, 80).map(toItem);
  cache = { at: Date.now(), items };
  return items;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const category = (searchParams.get("category") ?? "All") as NewsCategory | "All";
  const timeFilter = searchParams.get("time_filter") ?? "7D";
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const topic = (searchParams.get("topic") ?? "").trim().toLowerCase();
  const pageSize = Math.min(50, Math.max(1, Number(searchParams.get("page_size") ?? 40) || 40));

  try {
    let articles = await loadAll();

    if (category !== "All") {
      articles = articles.filter((a) => a.category === category || a.tags.includes(category));
    }
    articles = articles.filter((a) => withinTime(a.publishedAt, timeFilter));

    if (q) {
      articles = articles.filter(
        (a) =>
          a.headline.toLowerCase().includes(q) ||
          a.source.toLowerCase().includes(q) ||
          a.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (topic) {
      articles = articles.filter(
        (a) =>
          a.headline.toLowerCase().includes(topic) ||
          a.tags.some((t) => t.toLowerCase().includes(topic)) ||
          a.category.toLowerCase().includes(topic),
      );
    }

    return NextResponse.json(
      {
        articles: articles.slice(0, pageSize),
        total: articles.length,
        updatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
    );
  } catch (e) {
    return NextResponse.json(
      { detail: e instanceof Error ? e.message : "News feed unavailable", articles: [] },
      { status: 502 },
    );
  }
}
