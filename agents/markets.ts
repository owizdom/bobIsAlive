/**
 * Market Data Fetchers
 *
 * Pulls real-time crypto market data from free, keyless APIs:
 * - CoinGecko /api/v3/simple/price + market_chart
 * - Binance /api/v3/ticker/24hr + klines
 * - CoinCap /assets + /assets/{id}/history
 * - CoinPaprika /tickers + /coins/{id}/ohlcv/historical
 * - Kraken /0/public/Ticker + /0/public/OHLC
 * - Coinbase /products/{pair}/stats + /products/{pair}/candles
 * Sentiment enrichment:
 * - Alternative.me Fear & Greed index
 * - Free crypto RSS feeds
 * - Polymarket Gamma public endpoint (best-effort)
 */

export const MARKET_TICKERS = ["polymarket", "bitcoin", "ethereum", "solana", "chainlink", "polygon"] as const;
export type MarketTicker = (typeof MARKET_TICKERS)[number];

export interface MarketDataset {
  id: string;
  ticker: MarketTicker;
  name: string;
  fetchedAt: number;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  marketCap: number;
  priceHistory: [number, number][];
  volatility7d: number;
  trend7d: "up" | "down" | "sideways";
  supportLevel: number;
  resistanceLevel: number;
  fearGreedValue: number;
  fearGreedLabel: string;
  predictionQuestion: string;
  priceAtQuestion: number;
  questionExpiresAt: number;
  analysisContext: string;
  newsContext?: string;
  newsSentiment?: number; // -1..1, where >0 is broadly bullish
  newsHeadlines?: string[];
  polymarketSentiment?: number; // -1..1 proxy confidence signal
  polymarketContext?: string;
  polymarketEventInsights?: string[];
  polymarketResearch?: string[];
  polymarketQuestionFound?: boolean;
  polymarketQuestionId?: string;
}

interface CacheEntry {
  data: MarketDataset;
  ts: number;
}

type ProviderMarketData = {
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  prices: [number, number][];
};

const cache = new Map<string, CacheEntry>();
const failedCache = new Map<string, number>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const FAILED_TTL_MS = 60_000;
const STALE_TTL_MS = 24 * 60 * 60 * 1000;
const POLYMARKET_ACTIVITY_RECENCY_MS = 90 * 24 * 60 * 60 * 1000;

const COINGECKO_API = "https://api.coingecko.com/api/v3";
const BINANCE_API = "https://api.binance.com/api/v3";
const COINCAP_API = "https://api.coincap.io/v2";
const COINPAPRIKA_API = "https://api.coinpaprika.com/v1";
const KRAKEN_API = "https://api.kraken.com/0/public";
const POLY_API = "https://gamma-api.polymarket.com";
const POLY_MARKET_WEB = "https://polymarket.com";
const POLY_EVENT_LINK_PREFIX = `${POLY_MARKET_WEB}/event/`;
const POLY_MARKET_LINK_PREFIX = `${POLY_MARKET_WEB}/market/`;
const POLY_RESEARCH_PROXIES = [
  (url: string) => `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`,
  (url: string) => `https://r.jina.ai/https://${url.replace(/^https?:\/\//, "")}`,
  (url: string) => `https://r.jina.ai/http://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];
const COINBASE_API = "https://api.exchange.coinbase.com";
const FNG_URL = "https://api.alternative.me/fng/";
const CRYPTOCOMPARE_NEWS_API = "https://min-api.cryptocompare.com/data/v2/news/";

const TICKER_META: Record<
  MarketTicker,
  {
    name: string;
    coinGecko: string;
    binance: string;
    coinCap: string;
    coinPaprika: string;
    kraken: string;
    coinbase: string;
    coindeskKeyword: string;
  }
> = {
  bitcoin: {
    name: "Bitcoin",
    coinGecko: "bitcoin",
    binance: "BTCUSDT",
    coinCap: "bitcoin",
    coinPaprika: "btc-bitcoin",
    kraken: "XXBTZUSD",
    coinbase: "BTC-USD",
    coindeskKeyword: "Bitcoin",
  },
  ethereum: {
    name: "Ethereum",
    coinGecko: "ethereum",
    binance: "ETHUSDT",
    coinCap: "ethereum",
    coinPaprika: "eth-ethereum",
    kraken: "XETHZUSD",
    coinbase: "ETH-USD",
    coindeskKeyword: "Ethereum",
  },
  solana: {
    name: "Solana",
    coinGecko: "solana",
    binance: "SOLUSDT",
    coinCap: "solana",
    coinPaprika: "sol-solana",
    kraken: "SOLUSD",
    coinbase: "SOL-USD",
    coindeskKeyword: "Solana",
  },
  chainlink: {
    name: "Chainlink",
    coinGecko: "chainlink",
    binance: "LINKUSDT",
    coinCap: "chainlink",
    coinPaprika: "link-chainlink",
    kraken: "LINKUSD",
    coinbase: "LINK-USD",
    coindeskKeyword: "Chainlink",
  },
  polygon: {
    name: "Polygon",
    coinGecko: "matic-network",
    binance: "MATICUSDT",
    coinCap: "polygon",
    coinPaprika: "matic-polygon",
    kraken: "MATICUSD",
    coinbase: "MATIC-USD",
    coindeskKeyword: "Polygon",
  },
  polymarket: {
    name: "Polymarket",
    coinGecko: "",
    binance: "",
    coinCap: "",
    coinPaprika: "",
    kraken: "",
    coinbase: "",
    coindeskKeyword: "Polymarket",
  },
};

export function normalizeMarketTicker(rawTicker: string): MarketTicker | null {
  if (!rawTicker) return null;

  const cleaned = rawTicker
    .toLowerCase()
    .replace(/[_/]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s+&,-]/g, "")
    .trim();

  const splitTokens = cleaned
    .split(/[\s+&,-]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const matched: MarketTicker[] = [];
  const pushIfMatch = (ticker: MarketTicker) => {
    if (!matched.includes(ticker)) matched.push(ticker);
  };

  for (const token of splitTokens) {
    if (token === "polymarket" || token === "prediction") pushIfMatch("polymarket");
    if (token === "bitcoin" || token === "btc") pushIfMatch("bitcoin");
    else if (token === "ethereum" || token === "eth") pushIfMatch("ethereum");
    else if (token === "solana" || token === "sol") pushIfMatch("solana");
    else if (token === "chainlink" || token === "link") pushIfMatch("chainlink");
    else if (token === "polygon" || token === "matic" || token === "poly") pushIfMatch("polygon");
  }

  if (matched.length === 1) return matched[0];
  if (matched.length > 1) return null;

  const normalized = splitTokens.join(" ").trim();

  if (["btc", "bitcoin"].includes(normalized)) return "bitcoin";
  if (["eth", "ethereum"].includes(normalized)) return "ethereum";
  if (normalized.includes("sol")) return "solana";
  if (normalized.includes("link") || normalized.includes("chainlink")) return "chainlink";
  if (normalized.includes("poly") || normalized.includes("matic") || normalized.includes("polygon")) return "polygon";
  if (normalized.includes("polymarket")) return "polymarket";

  if (MARKET_TICKERS.includes(normalized as MarketTicker)) {
    return normalized as MarketTicker;
  }
  return "polymarket";
}

const TICKER_SENTIMENT_TERMS: Record<MarketTicker, string[]> = {
  bitcoin: ["bitcoin", "btc", "satoshi", "btc"],
  ethereum: ["ethereum", "eth", "ether", "erc"],
  solana: ["solana", "sol", "sol"],
  chainlink: ["chainlink", "link", "oracle"],
  polygon: ["polygon", "matic", "polygon"],
  polymarket: ["polymarket", "prediction", "market"],
};

type NewsSource = {
  name: string;
  url: string;
};

const NEWS_FEEDS: NewsSource[] = [
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { name: "Cointelegraph", url: "https://cointelegraph.com/feed/" },
  { name: "NewsBTC", url: "https://www.newsbtc.com/feed/" },
  { name: "Decrypt", url: "https://decrypt.co/feed" },
  { name: "The Block", url: "https://www.theblock.co/feed" },
  { name: "CryptoGlobe", url: "https://www.cryptoglobe.com/feed/" },
  { name: "CryptoPotato", url: "https://cryptopotato.com/feed/" },
  { name: "CryptoPanic", url: "https://cryptopanic.com/en/feed/" },
];

const NEWS_PROXY_PREFIXES = [
  (url: string) => `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`,
  (url: string) => `https://r.jina.ai/https://${url.replace(/^https?:\/\//, "")}`,
  (url: string) => `https://r.jina.ai/http://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

const POSITIVE_WORDS = [
  "surge",
  "surges",
  "rally",
  "bull",
  "bullish",
  "up",
  "gain",
  "gains",
  "higher",
  "approval",
  "adoption",
  "upgrade",
  "partnership",
  "institution",
  "breakout",
  "outperform",
  "resilient",
  "record",
];

const NEGATIVE_WORDS = [
  "dump",
  "crash",
  "drop",
  "decline",
  "fear",
  "bear",
  "bearish",
  "down",
  "hack",
  "hacked",
  "hackathon",
  "rug",
  "ban",
  "lawsuit",
  "regulation",
  "liquidation",
  "fraud",
  "outage",
  "attack",
  "exploit",
];

const WORD_SPLIT = /[^\p{L}\p{N}]+/gu;

type NewsSignal = {
  sentiment: number;
  headlines: string[];
  sources: string[];
};

type PolymarketSignal = {
  sentiment: number;
  headline: string;
  eventInsights: string[];
  research?: string[];
  question?: string;
  questions?: string[];
  questionId?: string;
  questionExpiresAt?: number;
};

const EMPTY_POLYMARKET_SIGNAL: PolymarketSignal = {
  sentiment: 0,
  headline: "Polymarket API unavailable",
  eventInsights: [],
  research: [],
  questions: [],
  question: "",
  questionId: "",
  questionExpiresAt: undefined,
};

export type PolymarketLiveQuestion = {
  question: string;
  link: string;
  source: string;
  slug?: string;
  id?: string;
};

function now(): number {
  return Date.now();
}

function getCached(key: string): CacheEntry | null {
  const hit = cache.get(key);
  if (!hit) return null;
  const age = now() - hit.ts;
  if (age > CACHE_TTL_MS) {
    if (age <= STALE_TTL_MS) {
      return hit;
    }
    cache.delete(key);
    return null;
  }
  return hit;
}

function setCache(key: string, data: MarketDataset): void {
  cache.set(key, { data, ts: now() });
}

function setFailed(key: string): void {
  failedCache.set(key, now());
}

function getFailureCached(key: string): boolean {
  const failTs = failedCache.get(key);
  if (!failTs) return false;
  if (now() - failTs > FAILED_TTL_MS) {
    failedCache.delete(key);
    return false;
  }
  return true;
}

function mapLabelForValue(v: number): string {
  if (v >= 80) return "Extreme Greed";
  if (v >= 60) return "Greed";
  if (v >= 40) return "Neutral";
  if (v >= 20) return "Fear";
  return "Extreme Fear";
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

async function fetchJson(url: string, timeoutMs = 12_000): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "swarm-mind/agent",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

async function fetchText(url: string, timeoutMs = 12_000): Promise<string> {
  const res = await fetch(url, {
    headers: {
      accept: "application/rss+xml, application/xml, text/xml, application/json, text/plain, */*",
      "user-agent": "swarm-mind/agent",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.text();
}

async function fetchFearGreed(): Promise<{ value: number; label: string }> {
  try {
    const data = await fetchJson(FNG_URL, 8_000) as {
      data?: Array<{ value?: string; value_classification?: string }>;
    };

    const point = (data.data || [])[0];
    const value = parseInt(point?.value ?? "50", 10);
    if (Number.isNaN(value)) {
      return { value: 50, label: "Neutral" };
    }
    return {
      value,
      label: point?.value_classification ?? mapLabelForValue(value),
    };
  } catch {
    return { value: 50, label: "Neutral" };
  }
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function computeVolatilityAndTrend(prices: [number, number][]): {
  volatility7d: number;
  trend7d: "up" | "down" | "sideways";
  supportLevel: number;
  resistanceLevel: number;
} {
  if (prices.length < 2) {
    return {
      volatility7d: 0,
      trend7d: "sideways",
      supportLevel: 0,
      resistanceLevel: 0,
    };
  }

  const values = prices.map((p) => p[1]);
  const returns = values
    .slice(1)
    .map((v, i) => {
      const prev = values[i];
      if (!prev || !Number.isFinite(prev) || prev === 0) return 0;
      return (v - prev) / prev;
    });

  const volatility7d = stdDev(returns);

  const first = values[0];
  const last = values[values.length - 1];
  const delta = last - first;

  let trend7d: "up" | "down" | "sideways" = "sideways";
  if (delta / Math.max(1, Math.abs(first)) > 0.01) trend7d = "up";
  else if (delta / Math.max(1, Math.abs(first)) < -0.01) trend7d = "down";

  const supportLevel = Math.min(...values) * 0.98;
  const resistanceLevel = Math.max(...values) * 1.02;

  return { volatility7d, trend7d, supportLevel, resistanceLevel };
}

function toQuestionTimestamp(raw: unknown): number | undefined {
  if (!raw) return undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw > 1_000_000_000_000) return raw;
    return raw * 1000;
  }
  const parsed = Date.parse(String(raw));
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function parseRssHeadlines(xmlText: string): string[] {
  const blocks = xmlText.match(/<(item|entry)\b[^>]*>[\s\S]*?<\/\1>/gi) || [];
  const titles: string[] = [];
  for (const block of blocks) {
    const match = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!match) continue;
    const title = stripHtml(match[1]).replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "");
    if (title && title.length > 2) titles.push(title);
  }
  return titles;
}

function scoreHeadlineSentiment(headline: string): number {
  const tokens = headline.toLowerCase().split(WORD_SPLIT).filter(Boolean);
  if (tokens.length === 0) return 0;

  const positiveCount = tokens.reduce((count, token) => (POSITIVE_WORDS.includes(token) ? count + 1 : count), 0);
  const negativeCount = tokens.reduce((count, token) => (NEGATIVE_WORDS.includes(token) ? count + 1 : count), 0);

  if (positiveCount === 0 && negativeCount === 0) return 0;
  return (positiveCount - negativeCount) / tokens.length;
}

function includesTickerTerm(title: string, ticker: MarketTicker): boolean {
  const terms = TICKER_SENTIMENT_TERMS[ticker];
  const lower = title.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function clampSentiment(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

async function fetchNewsSignal(ticker: MarketTicker): Promise<NewsSignal> {
  let total = 0;
  let score = 0;
  const headlines: string[] = [];
  const sources: string[] = [];

  for (const feed of NEWS_FEEDS) {
    try {
      const xmlText = await fetchNewsText(feed.url);
      const allHeadlines = parseRssHeadlines(xmlText);
      const relevant = allHeadlines.filter((h) => includesTickerTerm(h, ticker));
      if (relevant.length === 0) continue;

      for (const headline of relevant.slice(0, 8)) {
        const s = scoreHeadlineSentiment(headline);
        score += s;
        total += 1;
        headlines.push(headline);
      }
      sources.push(feed.name);
    } catch {
      continue;
    }
  }

  if (total === 0) {
    const fallback = await fetchCryptoCompareNewsSignal(ticker);
    if (fallback.headlines.length === 0) {
      return {
        sentiment: 0,
        headlines: [],
        sources: [],
      };
    }
    return {
      sentiment: fallback.sentiment,
      headlines: fallback.headlines.slice(0, 4),
      sources: fallback.sources,
    };
  }

  const avg = score / total;
  const deduped = Array.from(new Set(headlines)).slice(0, 4);
  return { sentiment: clampSentiment(avg), headlines: deduped, sources };
}

async function fetchNewsText(url: string): Promise<string> {
  const attempts = [url, ...NEWS_PROXY_PREFIXES.map((fn) => fn(url))];
  let lastError: unknown = null;

  for (const candidate of attempts) {
    try {
      return await fetchText(candidate);
    } catch (err: unknown) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`All news feed attempts failed: ${url}`);
}

async function fetchCryptoCompareNewsSignal(ticker: MarketTicker): Promise<NewsSignal> {
  try {
    const payload = (await fetchJson(
      `${CRYPTOCOMPARE_NEWS_API}?lang=EN&sortOrder=latest&excludeCategories=Sponsored`
    )) as { Data?: Array<{ title?: string; body?: string; categories?: string }>; };

    const entries = Array.isArray(payload?.Data) ? payload.Data : [];
    let total = 0;
    let score = 0;
    const headlines: string[] = [];
    const sources: string[] = ["cryptocompare"];

    for (const item of entries.slice(0, 25)) {
      const text = `${item?.title ?? ""} ${item?.body ?? ""} ${item?.categories ?? ""}`.trim();
      if (!text) continue;
      if (!includesTickerTerm(text, ticker)) continue;
      const sentiment = scoreHeadlineSentiment(text);
      score += sentiment;
      total += 1;
      if (item.title) headlines.push(item.title);
    }

    if (total === 0) {
      return { sentiment: 0, headlines: [], sources: [] };
    }

    return {
      sentiment: clampSentiment(score / total),
      headlines: Array.from(new Set(headlines)).slice(0, 4),
      sources,
    };
  } catch {
    return { sentiment: 0, headlines: [], sources: [] };
  }
}

function parseOutcomePrices(raw: unknown): number[] {
  const value = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (!value || value === "{}" || value === "[]") return [];
  try {
    const parsed = JSON.parse(value as string);
    if (Array.isArray(parsed)) {
      return parsed
        .map((v) => parseFloat(typeof v === "string" ? v : JSON.stringify(v)))
        .filter((n) => Number.isFinite(n));
    }
    if (typeof parsed === "object" && parsed !== null) {
      return Object.values(parsed).map((v) => parseFloat(typeof v === "string" ? v : JSON.stringify(v))).filter((n) => Number.isFinite(n));
    }
  } catch {
    const single = parseFloat(value);
    if (Number.isFinite(single)) return [single];
  }
  return [];
}

function getCandidateMarketsFromPolymarket(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload)) return payload;
  const root = payload as Record<string, unknown>;
  const pool: unknown[] = [];

  const pushArray = (value: unknown) => {
    if (Array.isArray(value)) pool.push(...value);
  };

  pushArray(root.events);
  pushArray(root.markets);
  pushArray(root.results);

  if (root.data && typeof root.data === "object") {
    const nested = root.data as Record<string, unknown>;
    pushArray(nested.events);
    pushArray(nested.markets);
  }

  return pool;
}

function collectPolymarketMarketQuestions(payload: unknown, out: string[]): void {
  if (!payload) return;

  if (typeof payload === "string") {
    const text = payload.trim();
    if (text) out.push(text);
    return;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      collectPolymarketMarketQuestions(item, out);
    }
    return;
  }

  if (typeof payload !== "object") return;
  const obj = payload as Record<string, unknown>;

  const pick = [
    toStringFromUnknown(obj.question),
    toStringFromUnknown(obj.title),
    toStringFromUnknown(obj.name),
    toStringFromUnknown(obj.slug),
  ];

  for (const text of pick) {
    const normalized = text.trim();
    if (normalized) out.push(normalized);
  }

  collectPolymarketMarketQuestions(obj.markets, out);
  collectPolymarketMarketQuestions(obj.events, out);
  collectPolymarketMarketQuestions(obj.results, out);
  collectPolymarketMarketQuestions(obj.data, out);
}

function buildPolymarketQuestionLink(slug?: string, id?: string): string {
  const normalizedSlug = (slug || "").trim();
  if (normalizedSlug) return `${POLY_EVENT_LINK_PREFIX}${encodeURIComponent(normalizedSlug)}`;
  const normalizedId = (id || "").trim();
  if (normalizedId) return `${POLY_MARKET_LINK_PREFIX}${encodeURIComponent(normalizedId)}`;
  return "";
}

function collectPolymarketQuestionItems(payload: unknown, out: PolymarketLiveQuestion[]): void {
  if (!payload) return;

  if (Array.isArray(payload)) {
    for (const item of payload) {
      collectPolymarketQuestionItems(item, out);
    }
    return;
  }

  if (typeof payload !== "object") return;
  const obj = payload as Record<string, unknown>;
  const itemActive = isPolymarketItemCurrent(obj);

  const eventTitle = extractEventTitle(obj);
  const eventSlug = toStringFromUnknown(obj.slug);
  const eventId = toId(obj.id);
  const eventQuestion = toStringFromUnknown(obj.question).trim() || eventTitle;
  const eventLink = buildPolymarketQuestionLink(eventSlug, eventId);

  if (Array.isArray(obj.markets)) {
    for (const market of obj.markets) {
      if (!market || typeof market !== "object") continue;
      const marketObj = market as Record<string, unknown>;
      if (!isPolymarketItemCurrent(marketObj, now())) continue;
      const marketQuestion = (
        toStringFromUnknown(marketObj.question).trim()
        || toStringFromUnknown(marketObj.title).trim()
        || eventQuestion
      ).trim();
      if (!marketQuestion) continue;

      const marketSlug = toStringFromUnknown(marketObj.slug);
      const marketId = toId(marketObj.id);
      out.push({
        question: marketQuestion,
        link: buildPolymarketQuestionLink(marketSlug, marketId) || eventLink,
        source: marketLinkSource(marketSlug, marketId, eventLink),
        slug: marketSlug || eventSlug,
        id: marketId || eventId,
      });
    }
  } else if (eventQuestion && itemActive) {
    out.push({
      question: eventQuestion,
      link: eventLink,
      source: eventLink ? "polymarket-event" : "polymarket",
      slug: eventSlug,
      id: eventId,
    });
  }

  collectPolymarketQuestionItems(obj.events, out);
  collectPolymarketQuestionItems(obj.results, out);
  collectPolymarketQuestionItems(obj.data, out);
}

function marketLinkSource(slug?: string, id?: string, fallback = ""): string {
  if (slug || id) return "polymarket-market";
  if (fallback) return "polymarket-event";
  return "polymarket";
}

function dedupePolymarketQuestions(questions: PolymarketLiveQuestion[]): PolymarketLiveQuestion[] {
  const out: PolymarketLiveQuestion[] = [];
  const seen = new Set<string>();
  for (const question of questions) {
    const normalized = (question.question || "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...question,
      question: normalized,
      link: (question.link || "").trim(),
    });
  }
  return out;
}

function dedupeQuestions(questions: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const question of questions) {
    const normalized = question.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function parseOutcomeFromItem(item: unknown): number[] {
  const direct = parseOutcomePrices((item as { outcomePrices?: unknown }).outcomePrices);
  if (direct.length >= 2) return direct;

  const outcomes = Array.isArray((item as { outcomes?: unknown }).outcomes)
    ? ((item as { outcomes?: unknown[] }).outcomes || [])
    : [];

  const values = outcomes
    .map((outcome: unknown) => {
      if (!outcome || typeof outcome !== "object") return null;
      const raw = (outcome as { price?: unknown }).price;
      const parsed = parseFloat(String(raw ?? ""));
      return Number.isFinite(parsed) ? parsed : null;
    })
    .filter((v): v is number => v !== null);

  if (values.length >= 2) return values;

  const tradePrice = parseFloat(String((item as { lastTradePrice?: unknown }).lastTradePrice ?? ""));
  if (Number.isFinite(tradePrice)) {
    return [tradePrice, 1 - tradePrice];
  }

  return [];
}

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  return "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringFromUnknown(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toNumberFromUnknown(value: unknown): number {
  const v = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(v) ? v : 0;
}

function toId(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function extractEventTitle(item: Record<string, unknown>): string {
  return [
    toStringFromUnknown(item.question),
    toStringFromUnknown(item.title),
    toStringFromUnknown(item.name),
    toStringFromUnknown(item.slug),
    toStringFromUnknown(item.id),
  ]
  .map((entry) => entry.trim())
  .find(Boolean) || "Unnamed Polymarket market/event";
}

function parseDateToTs(value: unknown): number | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return value > 1_000_000_000_000 ? value : value * 1000;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    }

    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function isPolymarketItemActive(item: Record<string, unknown>, nowMs = now()): boolean {
  const status = String(item.status || "").toLowerCase();
  if (status) {
    if (status === "closed" || status === "resolved" || status === "canceled" || status === "cancelled") {
      return false;
    }
    if (status === "active" || status === "open" || status === "trading") {
      return true;
    }
  }

  const resolvedRaw = item.resolved;
  if (resolvedRaw === true || String(resolvedRaw).toLowerCase() === "true") return false;
    const closedRaw = item.closed;
  if (closedRaw === true || String(closedRaw).toLowerCase() === "true") return false;
  const liquidity = Number(item.liquidity);
  if (Number.isFinite(liquidity) && liquidity < 0) return false;

  const endedAt = parseDateToTs(item.endDate || item.end_time || item.endAt || item.closedTime);
  if (typeof endedAt === "number" && endedAt <= nowMs) return false;

  const startedAt = parseDateToTs(item.startDate || item.start_time || item.startAt || item.created);
  if (typeof startedAt === "number" && startedAt > nowMs + 30 * 24 * 60 * 60 * 1000) return false;

  const hasMarketDate = [endedAt, startedAt, parseDateToTs(item.createdAt || item.created_at || item.updatedAt || item.updated_at || item.published_at || item.closedTime)]
    .some((value): value is number => typeof value === "number");
  if (!hasMarketDate && String(item.id || item.slug || item.question || item.title).trim() === "") {
    return false;
  }

  return true;
}

function isPolymarketItemFresh(item: Record<string, unknown>, nowMs = now()): boolean {
  const updatedAt = parseDateToTs(item.updatedAt || item.updated_at || item.published_at || item.createdAt || item.created_at);
  if (typeof updatedAt === "number" && updatedAt < nowMs - POLYMARKET_ACTIVITY_RECENCY_MS) {
    return false;
  }

  const createdAt = parseDateToTs(item.createdAt || item.created_at || item.created);
  if (typeof createdAt === "number" && createdAt < nowMs - POLYMARKET_ACTIVITY_RECENCY_MS * 12) {
    return false;
  }

  const startAt = parseDateToTs(item.startDate || item.start_time || item.startAt);
  if (typeof startAt === "number" && startAt < nowMs - POLYMARKET_ACTIVITY_RECENCY_MS) {
    return false;
  }

  return true;
}

function isPolymarketItemCurrent(item: Record<string, unknown>, nowMs = now()): boolean {
  return isPolymarketItemActive(item, nowMs) && isPolymarketItemFresh(item, nowMs);
}

function collectTextFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function hasTextOverlap(text: string, terms: string[]): boolean {
  const lowered = text.toLowerCase();
  return terms.some((term) => lowered.includes(term));
}

function textFromJson(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => textFromJson(entry)).filter(Boolean).join(" ");
  }
  if (!value || typeof value !== "object") return "";

  const obj = value as Record<string, unknown>;
  return Object.values(obj).map((entry) => textFromJson(entry)).filter(Boolean).join(" ");
}

function cleanResearchText(raw: string, maxLength = 240): string {
  const normalized = stripHtml(raw).replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trim()}…` : normalized;
}

async function fetchPolymarketResearchSource(url: string): Promise<string | null> {
  if (!url) return null;
  const sanitized = url.trim();
  const attempts = new Set<string>([
    sanitized,
    ...POLY_RESEARCH_PROXIES.map((prefix) => prefix(sanitized)),
  ]);

  for (const candidate of attempts) {
    try {
      const raw = await fetchText(candidate, 8_000);
      const summary = cleanResearchText(raw, 260);
      if (summary) return summary;
    } catch {
      continue;
    }
  }

  return null;
}

async function formatPolymarketResearch(
  eventTitle: string,
  resolutionSource: string,
  description: string
): Promise<string> {
  if (resolutionSource) {
    const summary = await fetchPolymarketResearchSource(resolutionSource);
    if (summary) {
      return `${eventTitle}: ${summary}`;
    }
  }

  return description ? `${eventTitle}: ${description}` : `${eventTitle}: no public resolution context available`;
}

function extractOutcomeScore(item: Record<string, unknown>): number {
  const outcomePrices = parseOutcomeFromItem(item);
  if (outcomePrices.length >= 2) {
    return clampSentiment(outcomePrices[0] - outcomePrices[1]);
  }
  const tradePriceRaw = parseFloat(String(item.lastTradePrice ?? ""));
  if (Number.isFinite(tradePriceRaw)) return clampSentiment(tradePriceRaw - 0.5);
  return 0;
}

function eventStrength(item: Record<string, unknown>): number {
  const volume = toNumberFromUnknown((item as { volume24h?: unknown }).volume24h);
  const liquidity = toNumberFromUnknown((item as { liquidity?: unknown }).liquidity);
  const resolved = String(item.resolved || item.status || item.closed).toLowerCase();
  const state = resolved === "true" ? "resolved" : resolved || "open";
  const endTime = toStringFromUnknown(item.endDate || item.end_time || item.endAt);
  const strength = Math.min(1, Math.log10(Math.max(1, volume + liquidity + 1)) / 6);
  const extra = `${state} ${endTime}`.trim();
  return Number.isFinite(strength) ? (extra ? strength : 0.2) : 0.2;
}

function eventEvidence(item: Record<string, unknown>): string {
  const volume = toNumberFromUnknown((item as { volume24h?: unknown }).volume24h);
  const liquidity = toNumberFromUnknown((item as { liquidity?: unknown }).liquidity);
  const resolvedRaw = (item as { resolved?: unknown }).resolved;
  const statusRaw = (item as { status?: unknown }).status;
  const closedRaw = (item as { closed?: unknown }).closed;
  const isClosed =
    resolvedRaw === true ||
    String(resolvedRaw).toLowerCase() === "true" ||
    String(closedRaw).toLowerCase() === "true";
  const status =
    isClosed ? "closed" : typeof statusRaw === "string" && statusRaw ? statusRaw : "open";
  const endTs = toStringFromUnknown((item as { endDate?: unknown; end_time?: unknown; endAt?: unknown }).endDate || (item as { end_time?: unknown }).end_time || (item as { endAt?: unknown }).endAt);
  const parts = [
    `state:${status}`,
    `time:${endTs || "active"}`,
    `vol24h:${volume ? volume.toFixed(0) : "n/a"}`,
    `liquidity:${liquidity ? liquidity.toFixed(0) : "n/a"}`,
  ];
  return parts.join(" ");
}

export async function fetchPolymarketSignal(): Promise<PolymarketSignal> {
  try {
    const queries = ["prediction", "market", "event", "outcome", "polymarket"];

    const endpoints = Array.from(new Set(
      queries.flatMap((query) => {
        const encoded = encodeURIComponent(query);
        return [
          `${POLY_API}/events?search=${encoded}&limit=30`,
          `${POLY_API}/public-search?search=${encoded}&limit=30`,
        ];
      })
    )).concat([
      `${POLY_API}/events?limit=30`,
      `${POLY_API}/markets?limit=30`,
    ]);

    const payloads = await Promise.allSettled(
      endpoints.map((url) => fetchJson(url, 10_000))
    );

    const pools: unknown[] = [];
    for (const payload of payloads) {
      if (payload.status === "fulfilled") {
        pools.push(...getCandidateMarketsFromPolymarket(payload.value));
      }
    }

    let score = 0;
    let weight = 0;
    const headlines: string[] = [];
    const eventInsights: string[] = [];
    const research: string[] = [];
    const seen = new Set<string>();
    const candidates: Array<{
      title: string;
      directional: number;
      contribution: number;
      insight: string;
      resolutionSource: string;
      description: string;
      question: string;
      questionId?: string;
      questionExpiresAt?: number;
    }> = [];

  for (const item of pools) {
      if (!isObject(item) || !isPolymarketItemCurrent(item, now())) continue;
      const eventTitle = extractEventTitle(item);
      const rawQuestion = toStringFromUnknown(item.question).trim();
      const question = (rawQuestion || eventTitle).trim();
      if (!question) continue;

      const id = toId(item.id) || toId(item.slug) || toId(item.questionId);
      const dedupeKey = id || eventTitle.toLowerCase();
      if (dedupeKey && seen.has(dedupeKey)) continue;
      if (dedupeKey) seen.add(dedupeKey);

      if (headlines.length < 5) headlines.push(eventTitle);

      const outcomePrices = parseOutcomeFromItem(item);
      const strength = Math.max(0.3, eventStrength(item));
      const directional = extractOutcomeScore(item);
      const directionScore = outcomePrices.length >= 2 ? outcomePrices[0] - outcomePrices[1] : directional;
      const direction = directional >= 0.05 ? "bullish" : directional <= -0.05 ? "bearish" : "neutral";
      const contribution = clampSentiment(directionScore) * (0.5 + strength * 0.5);

      score += contribution * strength;
      weight += strength;
      candidates.push({
        title: eventTitle,
        directional,
        contribution,
        insight: `${direction}: ${eventTitle} | ${directional.toFixed(2)} | ${eventEvidence(item)}`,
        resolutionSource: toStringFromUnknown(item.resolutionSource),
        description: toStringFromUnknown(item.description).slice(0, 260).trim(),
        question,
        questionId: toId(item.questionId) || toId(item.id) || toId(item.slug),
        questionExpiresAt: toQuestionTimestamp(toStringFromUnknown(item.endDate) || toStringFromUnknown(item.end_time) || toStringFromUnknown(item.endAt)),
      });
    }

    if (weight === 0) {
      return {
        sentiment: 0,
        headline: "No active Polymarket questions found",
        questions: [],
        eventInsights: [],
        research: [],
      };
    }

    const ranked = candidates.sort((a, b) => b.contribution - a.contribution).slice(0, 20);
    for (const candidate of ranked) {
      eventInsights.push(candidate.insight);
    }

    const topQuestion = ranked.find((candidate) => Boolean(candidate.question));

    const researchLines = await Promise.all(
      ranked.map((candidate) =>
        formatPolymarketResearch(candidate.title, candidate.resolutionSource, candidate.description).then((text) =>
          text.trim()
        )
      )
    );
    for (const line of researchLines) {
      if (line) research.push(line);
    }

    const scaled = clampSentiment(score / weight);
    return {
      sentiment: scaled,
      headline: headlines.slice(0, 3).join(" | "),
      eventInsights: eventInsights.slice(0, 5),
      research: Array.from(new Set(research)).slice(0, 5),
      questions: ranked.map((candidate) => candidate.question).filter((q): q is string => Boolean(q)),
      question: topQuestion?.question,
      questionId: topQuestion?.questionId,
      questionExpiresAt: topQuestion?.questionExpiresAt ?? undefined,
    };
  } catch {
    return {
      sentiment: 0,
      headline: "Polymarket API unavailable",
      questions: [],
      eventInsights: [],
      research: [],
    };
  }
}

async function fetchFromCoinGecko(ticker: MarketTicker): Promise<ProviderMarketData> {
  const cgId = TICKER_META[ticker].coinGecko;
  const [pricePayload, chartPayload] = await Promise.all([
    fetchJson(`${COINGECKO_API}/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`),
    fetchJson(`${COINGECKO_API}/coins/${cgId}/market_chart?vs_currency=usd&days=7&interval=hourly`),
  ]);

  const q = pricePayload as Record<string, { usd?: number; usd_24h_change?: number; usd_24h_vol?: number; usd_market_cap?: number }>;
  const raw = q[cgId];
  if (!raw || typeof raw.usd !== "number" || typeof raw.usd_24h_change !== "number") {
    throw new Error("Invalid CoinGecko price payload");
  }

  const chart = chartPayload as { prices?: [number, number][] };
  const prices = Array.isArray(chart?.prices)
    ? chart.prices.filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [p[0], Number(p[1])]) as [number, number][]
    : [];
  if (prices.length < 10) {
    throw new Error("Invalid CoinGecko chart payload");
  }

  return {
    price: raw.usd,
    change24h: raw.usd_24h_change,
    volume24h: raw.usd_24h_vol || 0,
    marketCap: raw.usd_market_cap || 0,
    prices: prices.slice(-168),
  };
}

async function fetchFromCoinbase(ticker: MarketTicker): Promise<ProviderMarketData> {
  const product = TICKER_META[ticker].coinbase;
  const [statsPayload, candlesPayload] = await Promise.all([
    fetchJson(`${COINBASE_API}/products/${product}/stats`),
    fetchJson(`${COINBASE_API}/products/${product}/candles?granularity=3600`),
  ]);

  const stats = statsPayload as { open?: string; open_24h?: string; last?: string; volume?: string; volume_24h?: string };
  const price = parseFloat(stats?.last ?? "");
  if (!Number.isFinite(price)) {
    throw new Error("Invalid Coinbase stats payload");
  }

  const change24h = (() => {
    const open = parseFloat(stats?.open ?? stats?.open_24h ?? "");
    const base = Number.isFinite(open) ? open : price;
    if (base === 0) return 0;
    return ((price - base) / base) * 100;
  })();

  const rawCandles = Array.isArray(candlesPayload) ? candlesPayload : [];
  const closes: [number, number][] = rawCandles
    .map((c: unknown) => {
      if (!Array.isArray(c) || c.length < 6) return null;
      const ts = Number(c[0]);
      const close = Number(c[4]);
      if (!Number.isFinite(ts) || !Number.isFinite(close)) return null;
      return [ts * 1000, close] as [number, number];
    })
    .filter((x): x is [number, number] => x !== null)
    .slice(-168);

  const volume24h = parseFloat((stats?.volume_24h ?? stats?.volume ?? "").toString());

  return {
    price,
    change24h,
    volume24h: Number.isFinite(volume24h) ? volume24h : 0,
    marketCap: 0,
    prices: closes.length >= 2 ? closes : [[Date.now(), price]],
  };
}

async function fetchFromBinance(ticker: MarketTicker): Promise<ProviderMarketData> {
  const symbol = TICKER_META[ticker].binance;
  const [tickerPayload, klinesPayload] = await Promise.all([
    fetchJson(`${BINANCE_API}/ticker/24hr?symbol=${symbol}`),
    fetchJson(`${BINANCE_API}/klines?symbol=${symbol}&interval=1h&limit=168`),
  ]);

  const t = tickerPayload as { lastPrice?: string; priceChangePercent?: string; quoteVolume?: string };

  const price = parseFloat(t.lastPrice ?? "");
  const change24h = parseFloat(t.priceChangePercent ?? "0");
  const volume24h = parseFloat(t.quoteVolume ?? "0");
  if (!Number.isFinite(price)) throw new Error("Invalid Binance price payload");

  const rawKlines = Array.isArray(klinesPayload) ? klinesPayload : [];
  const closes: [number, number][] = rawKlines
    .map((k: unknown) => {
      if (!Array.isArray(k) || k.length < 6) return null;
      const ts = Number(k[0]);
      const close = Number(k[4]);
      if (!Number.isFinite(ts) || !Number.isFinite(close)) return null;
      return [ts, close] as [number, number];
    })
    .filter((x): x is [number, number] => x !== null);

  if (closes.length < 20) throw new Error("Invalid Binance chart payload");

  return {
    price,
    change24h,
    volume24h,
    marketCap: 0,
    prices: closes,
  };
}

async function fetchFromCoinCap(ticker: MarketTicker): Promise<ProviderMarketData> {
  const coin = TICKER_META[ticker].coinCap;
  const end = Date.now();
  const start = end - 7 * 24 * 60 * 60 * 1000;
  const [assetPayload, historyPayload] = await Promise.all([
    fetchJson(`${COINCAP_API}/assets/${coin}`),
    fetchJson(
      `${COINCAP_API}/assets/${coin}/history?interval=h1&start=${start}&end=${end}`,
      10_000,
    ),
  ]);

  const asset = (assetPayload as { data?: {
    priceUsd?: string;
    changePercent24Hr?: string;
    volumeUsd24Hr?: string;
    marketCapUsd?: string;
  }; }).data;

  const price = parseFloat(asset?.priceUsd ?? "0");
  const change24h = parseFloat(asset?.changePercent24Hr ?? "0");
  const volume24h = parseFloat(asset?.volumeUsd24Hr ?? "0");
  const marketCap = parseFloat(asset?.marketCapUsd ?? "0");
  if (!Number.isFinite(price) || !Number.isFinite(change24h)) throw new Error("Invalid CoinCap asset payload");

  const history = (historyPayload as { data?: Array<{ time?: string | number; priceUsd?: string; }>; }).data ?? [];
  const prices = Array.isArray(history)
    ? history
        .map((entry) => {
          const ts = Number(entry.time);
          const p = Number(entry.priceUsd);
          if (!Number.isFinite(ts) || !Number.isFinite(p)) return null;
          return [ts, p] as [number, number];
        })
        .filter((p): p is [number, number] => p !== null)
    : [];

  if (prices.length < 10) throw new Error("Invalid CoinCap history payload");

  return {
    price,
    change24h,
    volume24h: Number.isFinite(volume24h) ? volume24h : 0,
    marketCap: Number.isFinite(marketCap) ? marketCap : 0,
    prices: prices.slice(-168),
  };
}

async function fetchFromCoinPaprika(ticker: MarketTicker): Promise<ProviderMarketData> {
  const id = TICKER_META[ticker].coinPaprika;
  const end = new Date().toISOString();
  const start = new Date(now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [tickerPayload, historyPayload] = await Promise.all([
    fetchJson(`${COINPAPRIKA_API}/tickers/${id}`),
    fetchJson(`${COINPAPRIKA_API}/coins/${id}/ohlcv/historical?start=${start}&end=${end}&interval=1h`),
  ]);

  const t = tickerPayload as {
    quotes?: {
      USD?: {
        price?: number;
        volume_24h?: number;
        market_cap?: number;
        percent_change_24h?: number;
      };
    };
  };
  const data = t?.quotes?.USD;
  const price = data?.price;
  const change24h = data?.percent_change_24h ?? 0;
  const volume24h = data?.volume_24h ?? 0;
  const marketCap = data?.market_cap ?? 0;
  if (!Number.isFinite(price as number) || !Number.isFinite(change24h as number)) {
    throw new Error("Invalid CoinPaprika ticker payload");
  }

  const history = (Array.isArray(historyPayload) ? historyPayload : []) as Array<Record<string, unknown>>;
  const closes = history
    .map((entry) => {
      const ts = Number((entry.time_open ?? entry.time_close ?? entry.time_opened ?? entry.time) ?? NaN);
      const close = Number(
        (entry.close ?? entry.price ?? entry.price_close ?? entry.price_open) ?? NaN
      );
      if (!Number.isFinite(ts) || !Number.isFinite(close)) return null;
      return [ts, close] as [number, number];
    })
    .filter((p): p is [number, number] => p !== null);

  if (closes.length < 10) throw new Error("Invalid CoinPaprika history payload");

  return {
    price: Number(price),
    change24h: Number(change24h),
    volume24h: Number.isFinite(volume24h) ? volume24h : 0,
    marketCap: Number.isFinite(marketCap) ? marketCap : 0,
    prices: closes.slice(-168),
  };
}

async function fetchFromKraken(ticker: MarketTicker): Promise<ProviderMarketData> {
  const pair = TICKER_META[ticker].kraken;
  const [tickerPayload, ohlcPayload] = await Promise.all([
    fetchJson(`${KRAKEN_API}/Ticker?pair=${pair}`),
    fetchJson(`${KRAKEN_API}/OHLC?pair=${pair}&interval=60`),
  ]);

  const root = tickerPayload as { result?: Record<string, Record<string, unknown>> };
  const pairKeys = Object.keys(root?.result ?? {});
  const market = pairKeys.map((k) => (root?.result as Record<string, Record<string, unknown>>)[k]).find(Boolean);
  const firstPair = market;
  if (!firstPair) throw new Error("Invalid Kraken ticker payload");
  const tickerData = firstPair as {
    c?: Array<number | string>;
    o?: Array<number | string>;
    h?: Array<number | string>;
    l?: Array<number | string>;
    v?: Array<number | string>;
  };

  const price = parseFloat(String((tickerData.c?.[0]) ?? ""));
  const open = parseFloat(String((tickerData.o?.[0]) ?? ""));
  const volume = parseFloat(String((tickerData.v?.[1]) ?? "0"));
  if (!Number.isFinite(price) || !Number.isFinite(open)) throw new Error("Invalid Kraken ticker payload");

  const change24h = open === 0 ? 0 : ((price - open) / open) * 100;
  const chart = (ohlcPayload as { result?: Record<string, [number, string, string, string, string, string, string, string][]> }).result;
  const rawRows = chart ? chart[Object.keys(chart)[0]] ?? [] : [];
  const closes = Array.isArray(rawRows)
    ? rawRows
        .map((row) => {
          const ts = row[0];
          const close = Number(row[4]);
          if (!Number.isFinite(ts) || !Number.isFinite(close)) return null;
          return [ts * 1000, close] as [number, number];
        })
        .filter((p): p is [number, number] => p !== null)
    : [];
  if (closes.length < 10) throw new Error("Invalid Kraken OHLC payload");

  return {
    price,
    change24h,
    volume24h: Number.isFinite(volume) ? volume : 0,
    marketCap: 0,
    prices: closes.slice(-168),
  };
}

export function getRandomMarket(): MarketTicker {
  const pick = Math.random();
  if (pick < 0.65) return "polymarket";

  const nonPolymarket = MARKET_TICKERS.filter((ticker) => ticker !== "polymarket");
  if (nonPolymarket.length === 0) return "polymarket";
  const idx = Math.floor(Math.random() * nonPolymarket.length);
  return nonPolymarket[idx];
}

export async function fetchMarketData(ticker: string): Promise<MarketDataset | null> {
  const safeTicker = normalizeMarketTicker(ticker);
  if (!safeTicker) {
    console.warn(`  [MarketData] Invalid ticker requested: ${ticker}`);
    return null;
  }

  const cacheKey = `market:${safeTicker}`;
  const cached = getCached(cacheKey);
  const cachedData = cached?.data;
  if (cachedData) return cachedData;

  if (getFailureCached(cacheKey)) return null;

  if (safeTicker === "polymarket") {
    const [polymarketSignal, fearGreed] = await Promise.all([
      fetchPolymarketSignal().catch(() => EMPTY_POLYMARKET_SIGNAL),
      fetchFearGreed(),
    ]);

    const nowTs = now();
    const rawQuestion = polymarketSignal.question?.trim() || "";
    const hasPolymarketQuestion = rawQuestion.length > 0;
    const question = hasPolymarketQuestion
      ? rawQuestion
      : "Polymarket question discovery is running. Awaiting strongest active signal.";
    const questionExpiresAt = hasPolymarketQuestion && polymarketSignal.questionExpiresAt
      ? polymarketSignal.questionExpiresAt
      : nowTs + 24 * 60 * 60_000;
    const polymarketSentiment = clampSentiment(polymarketSignal.sentiment);
    const anchorPrice = 100 + polymarketSentiment * 3;
    const prices: [number, number][] = Array.from({ length: 24 }, (_, idx) => {
      const drift = (idx - 23) * 0.01 * polymarketSentiment;
      return [nowTs - ((23 - idx) * 60 * 60 * 1000), anchorPrice + drift];
    });
    const latest = prices[prices.length - 1]?.[1] ?? anchorPrice;
    const high24h = prices.reduce((s, p) => (p[1] > s ? p[1] : s), latest);
    const low24h = prices.reduce((s, p) => (p[1] < s ? p[1] : s), latest);
    const volatility = computeVolatilityAndTrend(prices);
    const dataset: MarketDataset = {
      id: `${safeTicker}-${Date.now()}`,
      ticker: safeTicker,
      name: TICKER_META[safeTicker].name,
      fetchedAt: nowTs,
      price: latest,
      change24h: 0,
      high24h,
      low24h,
      volume24h: 0,
      marketCap: 0,
      priceHistory: prices,
      volatility7d: volatility.volatility7d,
      trend7d: volatility.trend7d,
      supportLevel: volatility.supportLevel,
      resistanceLevel: volatility.resistanceLevel,
      fearGreedValue: fearGreed.value,
      fearGreedLabel: fearGreed.label,
      predictionQuestion: question,
      priceAtQuestion: latest,
      questionExpiresAt,
      newsContext: polymarketSignal.headline,
      newsSentiment: polymarketSentiment,
      newsHeadlines: polymarketSignal.eventInsights.slice(0, 4),
      polymarketQuestionFound: hasPolymarketQuestion,
      polymarketQuestionId: polymarketSignal.questionId,
      polymarketSentiment,
      polymarketContext: polymarketSignal.headline,
      polymarketEventInsights: polymarketSignal.eventInsights,
      polymarketResearch: polymarketSignal.research,
      analysisContext: [
        `Polymarket focus: ${polymarketSignal.headline || "scanning live Polymarket questions"}`,
        `Polymarket sentiment: ${polymarketSentiment.toFixed(2)}`,
        `Research references: ${(polymarketSignal.research?.length || 0)} sources`,
      ].join(" | "),
    };

    setCache(cacheKey, dataset);
    return dataset;
  }

  const meta = TICKER_META[safeTicker];
  if (!meta) {
    setFailed(cacheKey);
    console.warn(`  [MarketData] Unsupported ticker requested: ${ticker}`);
    return null;
  }

  const providerOrder: Array<
    "coingecko" | "coincap" | "coinpaprika" | "binance" | "coinbase" | "kraken"
  > = ["coingecko", "coinbase", "binance", "coincap", "coinpaprika", "kraken"];

  let payload: ProviderMarketData | null = null;
  let lastError: string | null = null;

  for (const provider of providerOrder) {
    try {
      if (provider === "coingecko") {
        payload = await fetchFromCoinGecko(safeTicker);
      } else if (provider === "coincap") {
        payload = await fetchFromCoinCap(safeTicker);
      } else if (provider === "coinpaprika") {
        payload = await fetchFromCoinPaprika(safeTicker);
      } else if (provider === "binance") {
        payload = await fetchFromBinance(safeTicker);
      } else if (provider === "coinbase") {
        payload = await fetchFromCoinbase(safeTicker);
      } else {
        payload = await fetchFromKraken(safeTicker);
      }
      break;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
      continue;
    }
  }

  if (!payload) {
    if (cachedData) {
      return cachedData;
    }
    setFailed(cacheKey);
    if (lastError) console.warn(`  [MarketData] All providers failed for ${ticker}: ${lastError.slice(0, 120)}`);
    return null;
  }

  const { price, change24h, volume24h, marketCap, prices } = payload;
  if (prices.length < 1) {
    setFailed(cacheKey);
    return null;
  }

  const polymarketSignal = await fetchPolymarketSignal().catch(
    () => EMPTY_POLYMARKET_SIGNAL
  );
  const signalSource = "Polymarket question stream";

  const latest = prices[prices.length - 1]?.[1] ?? price;
  const latestHighLowWindow = prices.slice(-24).map((p) => p[1]);
  const high24h = Math.max(...latestHighLowWindow, latest);
  const low24h = Math.min(...latestHighLowWindow, latest);

  const volatility = computeVolatilityAndTrend(prices);
  const fearGreed = await fetchFearGreed();
  const rawPolymarketQuestion = polymarketSignal.question?.trim() || "";
  const hasPolymarketQuestion = rawPolymarketQuestion.length > 0;
  const question = hasPolymarketQuestion
    ? rawPolymarketQuestion
    : "No active Polymarket question is available right now";
  const questionExpiresAt = hasPolymarketQuestion && polymarketSignal.questionExpiresAt
    ? polymarketSignal.questionExpiresAt
    : now() + 24 * 60 * 60_000;

  const polymarketSentiment = clampSentiment(polymarketSignal.sentiment);

  const newsContextLines = [
    `Polymarket signal: ${polymarketSentiment >= 0 ? "risk-on" : "risk-off"} (${polymarketSentiment.toFixed(2)})`,
    `Polymarket context: ${polymarketSignal.headline}`,
    ...(polymarketSignal.eventInsights.length ? [`Polymarket events: ${polymarketSignal.eventInsights.join(" || ")}`] : []),
    ...(polymarketSignal.research?.length ? [`Polymarket research: ${polymarketSignal.research.join(" || ")}`] : []),
    `Signal scope: ${signalSource}`,
  ];

  const dataset: MarketDataset = {
    id: `${safeTicker}-${Date.now()}`,
    ticker: safeTicker,
    name: meta.name,
    fetchedAt: now(),
    price: latest,
    change24h,
    high24h,
    low24h,
    volume24h: Number.isFinite(volume24h) ? volume24h : 0,
    marketCap: Number.isFinite(marketCap) ? marketCap : 0,
    priceHistory: prices.slice(-168),
    volatility7d: volatility.volatility7d,
    trend7d: volatility.trend7d,
    supportLevel: volatility.supportLevel,
    resistanceLevel: volatility.resistanceLevel,
    fearGreedValue: fearGreed.value,
    fearGreedLabel: fearGreed.label,
    predictionQuestion: question,
    priceAtQuestion: latest,
    questionExpiresAt,
    newsContext: newsContextLines.join(" | "),
    newsSentiment: 0,
    newsHeadlines: [],
    polymarketQuestionFound: hasPolymarketQuestion,
    polymarketQuestionId: polymarketSignal.questionId,
    polymarketSentiment,
    polymarketContext: polymarketSignal.headline,
    polymarketEventInsights: polymarketSignal.eventInsights,
    polymarketResearch: polymarketSignal.research,
    analysisContext: [
      `Polymarket context: ${polymarketSignal.headline}`,
      `Polymarket signal: ${polymarketSentiment >= 0 ? "risk-on" : "risk-off"} (${polymarketSentiment.toFixed(2)})`,
      `Question scope: ${signalSource}`,
      `Research references: ${(polymarketSignal.research?.length || 0)} sources`,
    ].join(" | "),
  };

  setCache(cacheKey, dataset);
  return dataset;
}

export async function fetchActivePolymarketQuestions(limit = 5): Promise<PolymarketLiveQuestion[]> {
  const limitSafe = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5;
  const directEndpoints = [
    `${POLY_API}/events?limit=50&active=true`,
    `${POLY_API}/markets?limit=50&active=true`,
    `${POLY_API}/events?limit=50`,
    `${POLY_API}/markets?limit=50`,
  ];

  const directQuestions: PolymarketLiveQuestion[] = [];
  const directPayloads = await Promise.allSettled(directEndpoints.map((url) => fetchJson(url, 10_000)));
  for (const payload of directPayloads) {
    if (payload.status !== "fulfilled") continue;
    collectPolymarketQuestionItems(payload.value, directQuestions);
  }

  const directUnique = dedupePolymarketQuestions(directQuestions).filter((item) => (
    !/no active polymarket question|awaiting/i.test(item.question.toLowerCase())
  ));
  if (directUnique.length > 0) {
    return directUnique.slice(0, limitSafe);
  }

  const signal = await fetchPolymarketSignal().catch(
    () => EMPTY_POLYMARKET_SIGNAL
  );

  const candidates: PolymarketLiveQuestion[] = [];
  for (const q of signal.questions ?? []) {
    const trimmed = q.trim();
    if (!trimmed) continue;
    candidates.push({ question: trimmed, link: "", source: "polymarket-signal" });
  }
  if (signal.question?.trim()) {
    const trimmed = signal.question.trim();
    if (!candidates.some((item) => item.question === trimmed)) {
      candidates.push({ question: trimmed, link: "", source: "polymarket-signal" });
    }
  }

  return dedupePolymarketQuestions(candidates)
    .filter((item) => !/no active polymarket question|awaiting/i.test(item.question.toLowerCase()))
    .slice(0, limitSafe);
}
