// Alpha API Layer — CoinGecko (free) + Desearch with caching + rate-limit handling

import { CACHE_TTL_MS, DS_BASE } from "./constants.js";

const DS_KEY = import.meta.env.VITE_DESEARCH_API_KEY || "";

// ─── Cache ─────────────────────────────────────────────────
const cache = {};

function getCached(key) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    delete cache[key];
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache[key] = { data, ts: Date.now() };
}

// ─── Retry wrapper ─────────────────────────────────────────
async function fetchWithRetry(url, opts = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, opts);
    if (res.ok) return res;
    if (i < retries && [429, 500, 502, 503].includes(res.status)) {
      await new Promise(r => setTimeout(r, 1000 * 2 ** i));
    } else {
      throw new Error(`${res.status}: ${res.statusText}`);
    }
  }
}

// ─── CoinGecko (replaces LunarCrush) ──────────────────────

async function cgFetch(path) {
  const url = `https://api.coingecko.com/api/v3${path}`;
  const res = await fetchWithRetry(url);
  return res.json();
}

/**
 * Fetch Bittensor ecosystem coins from CoinGecko free tier.
 * Returns market data that we map into alpha scoring dimensions.
 */
export async function fetchBittensorCoins() {
  const key = "cg_bittensor_coins";
  const cached = getCached(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    vs_currency: "usd",
    category: "bittensor-subnets",
    order: "volume_desc",
    per_page: "100",
    page: "1",
    sparkline: "false",
    price_change_percentage: "24h,7d",
  });
  const data = await cgFetch(`/coins/markets?${params}`);
  setCache(key, data);
  return data;
}

/**
 * Fetch trending meme coins from CoinGecko free tier.
 */
export async function fetchMemeCoins() {
  const key = "cg_meme_coins";
  const cached = getCached(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    vs_currency: "usd",
    category: "meme-token",
    order: "volume_desc",
    per_page: "20",
    page: "1",
    sparkline: "false",
    price_change_percentage: "24h,7d",
  });
  const data = await cgFetch(`/coins/markets?${params}`);
  setCache(key, data);
  return data;
}

/**
 * Fetch CoinGecko trending coins/categories for narrative signals.
 */
export async function fetchTrending() {
  const key = "cg_trending";
  const cached = getCached(key);
  if (cached) return cached;

  const data = await cgFetch("/search/trending");
  setCache(key, data);
  return data;
}

// ─── Desearch ──────────────────────────────────────────────

/**
 * Parse Desearch AI SSE stream into structured data.
 */
function parseDesearchSSE(text) {
  const tweets = [];
  const webResults = [];
  const sources = [];
  const sentiments = {};
  let summary = "";

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) continue;
    const jsonStr = trimmed.slice(6);
    if (jsonStr === "[DONE]") break;

    let parsed;
    try { parsed = JSON.parse(jsonStr); } catch { continue; }
    if (!parsed) continue;

    if (parsed.type) {
      if (parsed.type === "Description" || parsed.type === "Queries") continue;
      if (parsed.type === "Sources" && Array.isArray(parsed.content)) {
        sources.push(...parsed.content);
        continue;
      }
      if (parsed.type === "Summary" && typeof parsed.content === "string") {
        summary = parsed.content;
        continue;
      }
      continue;
    }

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item.user && item.user.username) {
          tweets.push({
            id: item.id || item.user.id,
            username: item.user.username,
            name: item.user.name || item.user.username,
            url: item.user.url || `https://x.com/${item.user.username}`,
            text: item.text || item.description || item.user.description || "",
            created_at: item.created_at || null,
            followers: item.user.followers_count || 0,
          });
          continue;
        }
        if (item.title && item.link) {
          webResults.push({
            title: item.title,
            url: item.link,
            snippet: item.snippet || "",
          });
          continue;
        }
      }
      continue;
    }

    if (typeof parsed === "object" && !Array.isArray(parsed) && !parsed.type) {
      const values = Object.values(parsed);
      if (values.length > 0 && typeof values[0] === "string" &&
          ["POSITIVE", "NEGATIVE", "MEDIUM", "NEUTRAL"].includes(values[0].toUpperCase())) {
        Object.assign(sentiments, parsed);
        continue;
      }
    }
  }

  return { tweets, webResults, sources, sentiments, summary };
}

/**
 * AI contextual search across X and web via Desearch
 */
export async function desearchAI(query) {
  const key = `ds_ai_${query}`;
  const cached = getCached(key);
  if (cached) return cached;

  const url = `${DS_BASE}/desearch/ai/search`;
  const headers = { "Content-Type": "application/json" };
  if (DS_KEY) headers["Authorization"] = DS_KEY;

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt: query,
      tools: ["twitter", "web"],
      count: 10,
    }),
  });

  const text = await res.text();
  const data = parseDesearchSSE(text);
  setCache(key, data);
  return data;
}

/**
 * X/Twitter search via Desearch
 */
export async function desearchTwitter(query, sort = "Top", count = 15) {
  const key = `ds_x_${query}_${sort}_${count}`;
  const cached = getCached(key);
  if (cached) return cached;

  const params = new URLSearchParams({ query, sort, count: String(count) });
  const url = `${DS_BASE}/twitter?${params}`;
  const headers = {};
  if (DS_KEY) headers["Authorization"] = DS_KEY;

  const res = await fetchWithRetry(url, { headers });
  const data = await res.json();
  setCache(key, data);
  return data;
}

/**
 * Fetch all alpha data — CoinGecko + Desearch in parallel
 */
export async function fetchAllAlphaData() {
  const results = {
    bittensorCoins: null,
    memeCoins: null,
    trending: null,
    desearchAI: null,
    desearchTwitter: null,
    errors: [],
  };

  // All calls in parallel — no staggering needed since we use
  // CoinGecko (generous free tier) + Desearch (no rate limit issues)
  const settled = await Promise.allSettled([
    fetchBittensorCoins(),
    fetchMemeCoins(),
    fetchTrending(),
    desearchTwitter("$TAO OR bittensor subnet", "Top", 15),
    desearchAI("bittensor subnet trending alpha signals this week"),
  ]);

  const keys = ["bittensorCoins", "memeCoins", "trending", "desearchTwitter", "desearchAI"];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      results[keys[i]] = result.value;
    } else {
      results.errors.push({ source: keys[i], error: result.reason?.message || "Unknown" });
    }
  });

  return results;
}
