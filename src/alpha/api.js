// Alpha API Layer — LunarCrush v4 + Desearch with caching

import { CACHE_TTL_MS, LC_BASE, DS_BASE, LC_SECTORS } from "./constants.js";

const LC_KEY = import.meta.env.VITE_LUNARCRUSH_API_KEY || "";
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

// ─── LunarCrush v4 ────────────────────────────────────────
async function lcFetch(path) {
  const url = `${LC_BASE}${path}`;
  const headers = {};
  if (LC_KEY) headers["Authorization"] = `Bearer ${LC_KEY}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`LunarCrush ${res.status}: ${res.statusText}`);
  return res.json();
}

/**
 * Fetch trending topics across all categories
 */
export async function fetchTrendingTopics() {
  const key = "lc_trending";
  const cached = getCached(key);
  if (cached) return cached;

  const data = await lcFetch("/topics/list/v1?sort=interactions&limit=20");
  setCache(key, data);
  return data;
}

/**
 * Fetch Bittensor ecosystem coins sorted by social metrics
 */
export async function fetchBittensorSocial(sort = "interactions") {
  const key = `lc_bittensor_${sort}`;
  const cached = getCached(key);
  if (cached) return cached;

  const data = await lcFetch(`/coins/list/v2?sector=${LC_SECTORS.bittensor}&sort=${sort}&limit=50`);
  setCache(key, data);
  return data;
}

/**
 * Fetch meme sector coins sorted by social metrics
 */
export async function fetchMemeSocial(sort = "interactions") {
  const key = `lc_meme_${sort}`;
  const cached = getCached(key);
  if (cached) return cached;

  const data = await lcFetch(`/coins/list/v2?sector=${LC_SECTORS.meme}&sort=${sort}&limit=20`);
  setCache(key, data);
  return data;
}

/**
 * Fetch AI sector coins
 */
export async function fetchAISocial(sort = "interactions") {
  const key = `lc_ai_${sort}`;
  const cached = getCached(key);
  if (cached) return cached;

  const data = await lcFetch(`/coins/list/v2?sector=${LC_SECTORS.ai}&sort=${sort}&limit=20`);
  setCache(key, data);
  return data;
}

/**
 * Fetch topic summary (sentiment, galaxy score, interactions, etc.)
 */
export async function fetchTopicSummary(topic) {
  const key = `lc_topic_${topic}`;
  const cached = getCached(key);
  if (cached) return cached;

  const data = await lcFetch(`/topic/${encodeURIComponent(topic)}/v1`);
  setCache(key, data);
  return data;
}

/**
 * Fetch top posts for a topic
 */
export async function fetchTopicPosts(topic, limit = 10) {
  const key = `lc_posts_${topic}_${limit}`;
  const cached = getCached(key);
  if (cached) return cached;

  const data = await lcFetch(`/topic/${encodeURIComponent(topic)}/posts/v1?limit=${limit}`);
  setCache(key, data);
  return data;
}

/**
 * Fetch topic time series (sentiment over time)
 */
export async function fetchTopicTimeSeries(topic, interval = "1w") {
  const key = `lc_ts_${topic}_${interval}`;
  const cached = getCached(key);
  if (cached) return cached;

  const data = await lcFetch(`/topic/${encodeURIComponent(topic)}/time-series/v2?interval=${interval}`);
  setCache(key, data);
  return data;
}

/**
 * Fetch topic news
 */
export async function fetchTopicNews(topic, limit = 10) {
  const key = `lc_news_${topic}_${limit}`;
  const cached = getCached(key);
  if (cached) return cached;

  const data = await lcFetch(`/topic/${encodeURIComponent(topic)}/news/v1?limit=${limit}`);
  setCache(key, data);
  return data;
}

/**
 * Fetch category-level data (e.g., cryptocurrencies)
 */
export async function fetchCategoryTopics(category = "cryptocurrencies") {
  const key = `lc_cat_${category}`;
  const cached = getCached(key);
  if (cached) return cached;

  const data = await lcFetch(`/category/${category}/topics/v1?sort=interactions&limit=30`);
  setCache(key, data);
  return data;
}

// ─── Desearch ──────────────────────────────────────────────

async function dsFetch(endpoint, body) {
  const url = `${DS_BASE}${endpoint}`;
  const headers = { "Content-Type": "application/json" };
  if (DS_KEY) headers["Authorization"] = DS_KEY;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Desearch ${res.status}: ${res.statusText}`);
  return res.json();
}

/**
 * AI contextual search across X, Reddit, and web
 */
export async function desearchAI(query) {
  const key = `ds_ai_${query}`;
  const cached = getCached(key);
  if (cached) return cached;

  const data = await dsFetch("/desearch/ai/search", {
    prompt: query,
    tools: ["twitter", "reddit", "web"],
    count: 10,
  });
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

  const data = await dsFetch("/twitter/search", {
    query,
    sort,
    count,
  });
  setCache(key, data);
  return data;
}

/**
 * Fetch all alpha data in parallel
 */
export async function fetchAllAlphaData() {
  const results = {
    bittensorCoins: null,
    memeCoins: null,
    aiCoins: null,
    taoTopic: null,
    taoPosts: null,
    taoNews: null,
    trending: null,
    desearchNarrative: null,
    desearchTwitter: null,
    errors: [],
  };

  const tasks = [
    { key: "bittensorCoins", fn: () => fetchBittensorSocial("interactions") },
    { key: "memeCoins", fn: () => fetchMemeSocial("interactions") },
    { key: "aiCoins", fn: () => fetchAISocial("interactions") },
    { key: "taoTopic", fn: () => fetchTopicSummary("bittensor") },
    { key: "taoPosts", fn: () => fetchTopicPosts("bittensor", 15) },
    { key: "taoNews", fn: () => fetchTopicNews("bittensor", 10) },
    { key: "trending", fn: () => fetchTrendingTopics() },
    { key: "desearchNarrative", fn: () => desearchAI("bittensor subnet trending alpha signals this week") },
    { key: "desearchTwitter", fn: () => desearchTwitter("$TAO OR bittensor subnet OR bittensor alpha", "Top", 15) },
  ];

  const settled = await Promise.allSettled(tasks.map(t => t.fn()));

  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      results[tasks[i].key] = result.value;
    } else {
      results.errors.push({ source: tasks[i].key, error: result.reason?.message || "Unknown error" });
    }
  });

  return results;
}
