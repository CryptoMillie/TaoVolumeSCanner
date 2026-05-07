// Alpha API Layer — LunarCrush v4 + Desearch with caching + rate-limit handling

import { CACHE_TTL_MS, LC_BASE, DS_BASE } from "./constants.js";

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

// ─── Helpers ───────────────────────────────────────────────
function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
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
 * Fetch Bittensor ecosystem coins sorted by social metrics
 */
export async function fetchBittensorSocial(sort = "interactions") {
  const key = `lc_bittensor_${sort}`;
  const cached = getCached(key);
  if (cached) return cached;

  const data = await lcFetch(`/coins/list/v2?sector=bittensor-ecosystem&sort=${sort}&limit=50`);
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

  const data = await lcFetch(`/coins/list/v2?sector=meme&sort=${sort}&limit=20`);
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

// ─── Desearch ──────────────────────────────────────────────

/**
 * Desearch AI search — returns SSE stream, we parse it into collected results
 */
export async function desearchAI(query) {
  const key = `ds_ai_${query}`;
  const cached = getCached(key);
  if (cached) return cached;

  const url = `${DS_BASE}/desearch/ai/search`;
  const headers = { "Content-Type": "application/json" };
  if (DS_KEY) headers["Authorization"] = DS_KEY;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt: query,
      tools: ["twitter", "web"],
      count: 10,
    }),
  });
  if (!res.ok) throw new Error(`Desearch AI ${res.status}: ${res.statusText}`);

  // AI search returns SSE stream (text/event-stream) — read as text and parse
  const text = await res.text();
  const results = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) continue;
    const jsonStr = trimmed.slice(6); // strip "data: "
    if (jsonStr === "[DONE]") break;
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed) results.push(parsed);
    } catch {
      // skip unparseable chunks
    }
  }

  // Flatten into a usable structure
  const data = { results, raw_count: results.length };
  setCache(key, data);
  return data;
}

/**
 * X/Twitter search via Desearch — uses GET with query params
 */
export async function desearchTwitter(query, sort = "Top", count = 15) {
  const key = `ds_x_${query}_${sort}_${count}`;
  const cached = getCached(key);
  if (cached) return cached;

  const params = new URLSearchParams({ query, sort, count: String(count) });
  const url = `${DS_BASE}/twitter?${params}`;
  const headers = {};
  if (DS_KEY) headers["Authorization"] = DS_KEY;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Desearch X ${res.status}: ${res.statusText}`);
  const data = await res.json();
  setCache(key, data);
  return data;
}

/**
 * Web search via Desearch — uses GET
 */
export async function desearchWeb(query) {
  const key = `ds_web_${query}`;
  const cached = getCached(key);
  if (cached) return cached;

  const params = new URLSearchParams({ query });
  const url = `${DS_BASE}/web?${params}`;
  const headers = {};
  if (DS_KEY) headers["Authorization"] = DS_KEY;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Desearch Web ${res.status}: ${res.statusText}`);
  const data = await res.json();
  setCache(key, data);
  return data;
}

/**
 * Fetch all alpha data — staggered LunarCrush calls to avoid 429 rate limits
 */
export async function fetchAllAlphaData() {
  const results = {
    bittensorCoins: null,
    memeCoins: null,
    taoTopic: null,
    taoPosts: null,
    taoNews: null,
    desearchNarrative: null,
    desearchTwitter: null,
    errors: [],
  };

  // --- Desearch calls (no rate limit issues, fire together) ---
  const dsSettled = await Promise.allSettled([
    desearchTwitter("$TAO OR bittensor subnet", "Top", 15),
    desearchAI("bittensor subnet trending alpha signals this week"),
  ]);

  if (dsSettled[0].status === "fulfilled") results.desearchTwitter = dsSettled[0].value;
  else results.errors.push({ source: "desearchTwitter", error: dsSettled[0].reason?.message || "Unknown" });

  if (dsSettled[1].status === "fulfilled") results.desearchNarrative = dsSettled[1].value;
  else results.errors.push({ source: "desearchNarrative", error: dsSettled[1].reason?.message || "Unknown" });

  // --- LunarCrush calls — stagger to avoid 429 ---
  const lcTasks = [
    { key: "bittensorCoins", fn: () => fetchBittensorSocial("interactions") },
    { key: "taoTopic", fn: () => fetchTopicSummary("bittensor") },
    { key: "memeCoins", fn: () => fetchMemeSocial("interactions") },
    { key: "taoPosts", fn: () => fetchTopicPosts("bittensor", 15) },
    { key: "taoNews", fn: () => fetchTopicNews("bittensor", 10) },
  ];

  for (const task of lcTasks) {
    try {
      results[task.key] = await task.fn();
    } catch (e) {
      results.errors.push({ source: task.key, error: e.message });
    }
    // 500ms gap between LunarCrush calls to stay under rate limit
    await delay(500);
  }

  return results;
}
