// Alpha Signals Constants — Social Sentiment + Narrative Intelligence

export const CACHE_TTL_MS = 5 * 60 * 1000; // 5-min cache for social data (more volatile)

// LunarCrush API
export const LC_BASE = "https://lunarcrush.com/api4/public";

// Desearch API
export const DS_BASE = "https://api.desearch.ai";

// Alpha Signal composite weights
export const ALPHA_WEIGHTS = {
  SOCIAL: 0.30,    // Social momentum (interactions + contributors growth)
  SENTIMENT: 0.25, // Sentiment delta vs baseline
  NARRATIVE: 0.25, // Narrative density (post count + relevance)
  ONCHAIN: 0.20,   // On-chain confirmation (vol/mc, capital flows)
};

export const ALPHA_DIMENSION_LABELS = {
  SOCIAL: "Social Momentum",
  SENTIMENT: "Sentiment",
  NARRATIVE: "Narrative",
  ONCHAIN: "On-Chain",
};

// Tier thresholds
export const ALPHA_TIER_THRESHOLDS = {
  SIGNAL: 70,     // Strong alpha signal
  WATCH: 40,      // On the radar
  // Below 40 = NOISE
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

// Tracked topics for narrative scanning
export const BITTENSOR_TOPICS = [
  "bittensor", "$tao", "bittensor subnet",
];

export const MEME_TOPICS = [
  "meme coin", "memecoin", "degen",
];

// LunarCrush sectors to monitor
export const LC_SECTORS = {
  bittensor: "bittensor-ecosystem",
  meme: "meme",
  ai: "ai",
  aiAgents: "ai-agents",
  depin: "depin",
};

// Desearch search queries for narrative intel
export const DS_QUERIES = [
  "bittensor subnet trending alpha",
  "TAO bittensor new subnet launch",
  "bittensor miner validator update",
];
