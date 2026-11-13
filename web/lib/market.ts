const COINGECKO = "https://api.coingecko.com/api/v3";

export const TICKER_COINS = [
  { id: "near", symbol: "NEAR" },
  { id: "bitcoin", symbol: "BTC" },
  { id: "ethereum", symbol: "ETH" },
  { id: "solana", symbol: "SOL" },
] as const;

export type CoinId = (typeof TICKER_COINS)[number]["id"];
export type Quote = { usd: number; change24h: number };
export type Quotes = Partial<Record<CoinId, Quote>>;
export type PricePoint = { t: number; p: number };

export async function fetchQuotes(): Promise<Quotes> {
  const ids = TICKER_COINS.map((c) => c.id).join(",");
  const res = await fetch(
    `${COINGECKO}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
  );
  if (!res.ok) throw new Error(`Price feed unavailable (HTTP ${res.status})`);
  const raw = (await res.json()) as Record<string, { usd: number; usd_24h_change: number }>;
  const out: Quotes = {};
  for (const { id } of TICKER_COINS) {
    const q = raw[id];
    if (q) out[id] = { usd: q.usd, change24h: q.usd_24h_change };
  }
  return out;
}

export async function fetchPriceHistory(coin: CoinId, days: number): Promise<PricePoint[]> {
  const res = await fetch(
    `${COINGECKO}/coins/${coin}/market_chart?vs_currency=usd&days=${days}`,
  );
  if (!res.ok) throw new Error(`Chart data unavailable (HTTP ${res.status})`);
  const raw = (await res.json()) as { prices: [number, number][] };
  return raw.prices.map(([t, p]) => ({ t, p }));
}

export const formatUsd = (n: number, max = 2) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: max,
  });

export const formatPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
