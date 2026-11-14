export type MarketTab = "All" | "Gainers" | "Losers";

export type MarketToken = {
  id: string;
  symbol: string;
  name: string;
  image: string;
  price: number;
  change24h: number;
  change7d: number | null;
  volume24h: number;
  marketCap: number;
  rank: number | null;
  /** Present when this coin is a NIXO desk / Confidential Intents market. */
  deskSymbol: string | null;
  liveEnabled: boolean;
};

export type NewsCategory = "All" | "NEAR Protocol" | "NEAR Intents" | "Market and Prices" | "Technology" | "Regulation";
export type NewsTimeFilter = "Now" | "24H" | "7D";
export type NewsPriority = "Critical" | "High" | "Low";
export type NewsSentiment = "up" | "down" | "neutral";

export type NewsItem = {
  id: string;
  time: string;
  publishedAt: string;
  headline: string;
  source: string;
  sourceHandle: string;
  category: NewsCategory;
  priority: NewsPriority;
  sentiment: NewsSentiment;
  tags: string[];
  link?: string;
  summary?: string;
};
