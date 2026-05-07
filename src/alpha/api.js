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

export async function fetchBittensorSocial(sort = "interactions") {
  const key = `lc_bittensor_${sort}`;
  const cached = getCached(key);
  if (cached) return cached;
  const data = await lcFetch(`/coins/list/v2?sector=bittensor-ecosystem&sort=${sort}&limit=50`);
  setCache(key, data);
  return data;
}

export async function fetchMemeSocial(sort = "interactions") {
  const key = `lc_meme_${sort}`;
  const cached = getCached(key);
  if (cached) return cached;
  const data = await lcFetch(`/coins/list/v2?sector=meme&sort=${sort}&limit=20`);
  setCache(key, data);
  return data;
}

export async function fetchTopicSummary(topic) {
  const key = `lc_topic_${topic}`;
  const cached = getCached(key);
  if (cached) return cached;
  const data = await lcFetch(`/topic/${encodeURIComponent(topic)}/v1`);
  setCache(key, data);
  return data;
}

export async function fetchTopicPosts(topic, limit = 10) {
  const key = `lc_posts_${topic}_${limit}`;
  const cached = getCached(key);
  if (cached) return cached;
  const data = await lcFetch(`/topic/${encodeURIComponent(topic)}/posts/v1?limit=${limit}`);
  setCache(key, data);
  return data;
}

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
 * Parse Desearch AI SSE stream into structured data.
 * SSE chunks have types: Description, Queries, Sources, plus raw data arrays.
 * We extract: tweets (with user objects), web results (title/link/snippet), sentiment.
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

    // Typed chunk from AI search pipeline
    if (parsed.type) {
      // Skip status/progress messages
      if (parsed.type === "Description" || parsed.type === "Queries") continue;

      // Source URLs
      if (parsed.type === "Sources" && Array.isArray(parsed.content)) {
        sources.push(...parsed.content);
        continue;
      }

      // Summary text
      if (parsed.type === "Summary" && typeof parsed.content === "string") {
        summary = parsed.content;
        continue;
      }

      continue;
    }

    // Raw data arrays — tweets or web results
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        // Tweet: has user object with username
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
        // Web result: has title + link + snippet
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

    // Sentiment object: { "tweet_id": "MEDIUM", ... }
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

  const text = await res.text();
  const data = parseDesearchSSE(text);
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
 * Fetch all alpha data — staggered LunarCrush, parallel Desearch
 */
export async function fetchAllAlphaData() {
  const results = {
    bittensorCoins: null,
    memeCoins: null,
    taoTopic: null,
    taoPosts: null,
    taoNews: null,
    desearchAI: null,
    desearchTwitter: null,
    errors: [],
  };

  // --- Desearch calls (parallel, no rate limit issues) ---
  const dsSettled = await Promise.allSettled([
    desearchTwitter("$TAO OR bittensor subnet", "Top", 15),
    desearchAI("bittensor subnet trending alpha signals this week"),
  ]);

  if (dsSettled[0].status === "fulfilled") results.desearchTwitter = dsSettled[0].value;
  else results.errors.push({ source: "desearchTwitter", error: dsSettled[0].reason?.message || "Unknown" });

  if (dsSettled[1].status === "fulfilled") results.desearchAI = dsSettled[1].value;
  else results.errors.push({ source: "desearchAI", error: dsSettled[1].reason?.message || "Unknown" });

  // --- LunarCrush calls — staggered, skip on 402 (paid tier required) ---
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
      // Only show as error if it's not a known 402 payment issue
      if (e.message?.includes("402")) {
        results.errors.push({ source: task.key, error: "Paid plan required" });
      } else {
        results.errors.push({ source: task.key, error: e.message });
      }
    }
    await delay(500);
  }

  return results;
}
