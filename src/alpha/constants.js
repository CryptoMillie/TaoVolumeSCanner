// Alpha Signals Constants — Market Intelligence via CoinGecko + Desearch

export const CACHE_TTL_MS = 5 * 60 * 1000; // 5-min cache for market data

// Desearch API
export const DS_BASE = "https://api.desearch.ai";

// Alpha Signal composite weights — adapted for CoinGecko market data
// MOMENTUM: price action strength (24h + 7d changes)
// VOLUME:   volume anomaly (vol/mc ratio + raw volume)
// MARKET:   market positioning (market cap rank + circulating supply ratio)
// ONCHAIN:  price structure (ATH discount + 24h range utilization)
export const ALPHA_WEIGHTS = {
  MOMENTUM: 0.30,
  VOLUME: 0.25,
  MARKET: 0.25,
  ONCHAIN: 0.20,
};

export const ALPHA_DIMENSION_LABELS = {
  MOMENTUM: "Momentum",
  VOLUME: "Volume",
  MARKET: "Market",
  ONCHAIN: "On-Chain",
};

// Tier thresholds
export const ALPHA_TIER_THRESHOLDS = {
  SIGNAL: 70,
  WATCH: 40,
};

export const ALPHA_TIER_CONFIG = {
  signal: { color: "#33bb66", bg: "#0a1a10", border: "#1a3a20", label: "STRONG SIGNAL" },
  watch:  { color: "#ddaa00", bg: "#1a1600", border: "#3a3000", label: "WATCHLIST" },
  noise:  { color: "#555577", bg: "#0a0a14", border: "#1a1a2e", label: "NOISE" },
};

// Sentiment color mapping
export const SENTIMENT_COLORS = {
  bullish:  "#33bb66",
  neutral:  "#ddaa00",
  bearish:  "#ff4455",
};

// Desearch search queries for narrative intel
export const DS_QUERIES = [
  "bittensor subnet trending alpha",
  "TAO bittensor new subnet launch",
  "bittensor miner validator update",
];
