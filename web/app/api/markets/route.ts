import { NextResponse } from "next/server";

const COINGECKO = "https://api.coingecko.com/api/v3";

/** Desk symbols that map onto NIXO Confidential Intents / paper markets. */
const DESK: Record<string, { symbol: string; liveEnabled: boolean }> = {
  near: { symbol: "NEAR", liveEnabled: true },
  bitcoin: { symbol: "BTC", liveEnabled: false },
  ethereum: { symbol: "ETH", liveEnabled: false },
  solana: { symbol: "SOL", liveEnabled: false },
  "usd-coin": { symbol: "USDC", liveEnabled: true },
};

type GeckoMarket = {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number | null;
  price_change_percentage_24h: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  total_volume: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
};

let cache: { at: number; body: unknown } | null = null;
const TTL_MS = 45_000;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const perPage = Math.min(100, Math.max(10, Number(searchParams.get("per_page") ?? 40) || 40));

  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.body, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    });
  }

  const url =
    `${COINGECKO}/coins/markets?vs_currency=usd&order=market_cap_desc` +
    `&per_page=${perPage}&page=1&sparkline=false&price_change_percentage=7d`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
      next: { revalidate: 45 },
    });
  } catch {
    return NextResponse.json({ detail: "Price feed unavailable" }, { status: 502 });
  }

  if (!upstream.ok) {
    return NextResponse.json({ detail: `Price feed error (HTTP ${upstream.status})` }, { status: 502 });
  }

  const raw = (await upstream.json()) as GeckoMarket[];
  const tokens = raw.map((t) => {
    const desk = DESK[t.id] ?? null;
    return {
      id: t.id,
      symbol: (desk?.symbol ?? t.symbol).toUpperCase(),
      name: t.name,
      image: t.image,
      price: t.current_price ?? 0,
      change24h: t.price_change_percentage_24h ?? 0,
      change7d: t.price_change_percentage_7d_in_currency ?? null,
      volume24h: t.total_volume ?? 0,
      marketCap: t.market_cap ?? 0,
      rank: t.market_cap_rank,
      deskSymbol: desk?.symbol ?? null,
      liveEnabled: desk?.liveEnabled ?? false,
    };
  });

  // Ensure desk assets appear even if CoinGecko pagination pushed them down.
  const have = new Set(tokens.map((t) => t.id));
  const missingIds = Object.keys(DESK).filter((id) => !have.has(id));
  if (missingIds.length) {
    try {
      const extraRes = await fetch(
        `${COINGECKO}/coins/markets?vs_currency=usd&ids=${missingIds.join(",")}&sparkline=false&price_change_percentage=7d`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
      );
      if (extraRes.ok) {
        const extra = (await extraRes.json()) as GeckoMarket[];
        for (const t of extra) {
          const desk = DESK[t.id];
          tokens.push({
            id: t.id,
            symbol: (desk?.symbol ?? t.symbol).toUpperCase(),
            name: t.name,
            image: t.image,
            price: t.current_price ?? 0,
            change24h: t.price_change_percentage_24h ?? 0,
            change7d: t.price_change_percentage_7d_in_currency ?? null,
            volume24h: t.total_volume ?? 0,
            marketCap: t.market_cap ?? 0,
            rank: t.market_cap_rank,
            deskSymbol: desk?.symbol ?? null,
            liveEnabled: desk?.liveEnabled ?? false,
          });
        }
      }
    } catch {
      // Optional enrichment — ignore.
    }
  }

  tokens.sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  const body = { tokens, updatedAt: new Date().toISOString() };
  cache = { at: Date.now(), body };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
  });
}
