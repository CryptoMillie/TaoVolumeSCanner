// Alpha Signal Scoring Engine — Social + Narrative + On-Chain composite

import { ALPHA_WEIGHTS, ALPHA_TIER_THRESHOLDS } from "./constants.js";

function num(v) {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

function percentileRank(value, allValues) {
  if (allValues.length <= 1) return 50;
  const below = allValues.filter(v => v < value).length;
  const equal = allValues.filter(v => v === value).length;
  return ((below + 0.5 * equal) / allValues.length) * 100;
}

/**
 * Normalize sentiment from LunarCrush (0-100 scale, 50 = neutral)
 * Returns a -1 to +1 score
 */
function normalizeSentiment(raw) {
  if (raw == null) return 0;
  return (num(raw) - 50) / 50; // -1 (bearish) to +1 (bullish)
}

/**
 * Score Bittensor ecosystem coins with social alpha metrics.
 *
 * Each coin gets:
 *   SOCIAL:    interactions + contributors (social momentum)
 *   SENTIMENT: sentiment score (bullish/bearish lean)
 *   NARRATIVE: posts_active + social_dominance (narrative density)
 *   ONCHAIN:   volume + price change (market confirmation)
 */
export function scoreAlphaSignals(coins) {
  if (!coins || !Array.isArray(coins) || coins.length === 0) return [];

  const items = coins.map(c => {
    const interactions = num(c.interactions);
    const contributors = num(c.contributors_active || c.contributors);
    const sentiment = num(c.sentiment);
    const postsActive = num(c.posts_active || c.posts);
    const socialDom = num(c.social_dominance);
    const volume = num(c.volume_24h || c.volume);
    const priceChange = num(c.percent_change_24h || c.price_change_24h);
    const galaxyScore = num(c.galaxy_score);
    const altRank = num(c.alt_rank);
    const marketCap = num(c.market_cap);

    return {
      raw: c,
      symbol: c.symbol || c.s || "???",
      name: c.name || c.n || c.symbol || "Unknown",
      metrics: {
        social_1: interactions,
        social_2: contributors,
        sentiment_1: sentiment,
        sentiment_2: galaxyScore,
        narrative_1: postsActive,
        narrative_2: socialDom,
        onchain_1: volume,
        onchain_2: Math.abs(priceChange),
      },
      display: {
        interactions,
        contributors,
        sentiment,
        postsActive,
        socialDom,
        volume,
        priceChange,
        galaxyScore,
        altRank,
        marketCap,
        price: num(c.close || c.price || c.current_price),
      },
    };
  });

  // Build percentile arrays
  const metricKeys = Object.keys(items[0].metrics);
  const metricArrays = {};
  metricKeys.forEach(k => {
    metricArrays[k] = items.map(it => it.metrics[k]);
  });

  const scored = items.map(it => {
    const pct = {};
    metricKeys.forEach(k => {
      pct[k] = percentileRank(it.metrics[k], metricArrays[k]);
    });

    const SOCIAL = (pct.social_1 + pct.social_2) / 2;
    const SENTIMENT = (pct.sentiment_1 + pct.sentiment_2) / 2;
    const NARRATIVE = (pct.narrative_1 + pct.narrative_2) / 2;
    const ONCHAIN = (pct.onchain_1 + pct.onchain_2) / 2;

    const composite = SOCIAL * ALPHA_WEIGHTS.SOCIAL
                    + SENTIMENT * ALPHA_WEIGHTS.SENTIMENT
                    + NARRATIVE * ALPHA_WEIGHTS.NARRATIVE
                    + ONCHAIN * ALPHA_WEIGHTS.ONCHAIN;

    const tier = composite >= ALPHA_TIER_THRESHOLDS.SIGNAL ? "signal"
               : composite >= ALPHA_TIER_THRESHOLDS.WATCH ? "watch"
               : "noise";

    // Sentiment label
    const sentVal = normalizeSentiment(it.display.sentiment);
    const sentimentLabel = sentVal > 0.2 ? "bullish" : sentVal < -0.2 ? "bearish" : "neutral";

    return {
      ...it.display,
      symbol: it.symbol,
      name: it.name,
      dimensions: { SOCIAL, SENTIMENT, NARRATIVE, ONCHAIN },
      composite: Math.round(composite * 10) / 10,
      tier,
      sentimentLabel,
      sentimentValue: sentVal,
      raw: it.raw,
    };
  });

  scored.sort((a, b) => b.composite - a.composite);
  return scored;
}

/**
 * Extract narrative signals from Desearch AI results.
 * Returns structured signal objects for the UI.
 */
export function extractNarrativeSignals(desearchData) {
  if (!desearchData) return [];

  // Safely convert any value to a string
  function str(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  // Handle different response shapes
  let results = desearchData.results || desearchData.data || desearchData.organic_results || [];

  // If results is not an array, try to wrap it
  if (!Array.isArray(results)) {
    if (typeof results === "object" && results !== null) results = [results];
    else results = [];
  }

  if (results.length > 0) {
    return results.map((r, i) => {
      // r could be a string (from SSE chunks)
      if (typeof r === "string") {
        return { id: i, title: r.substring(0, 120), snippet: r, url: null, source: "ai", timestamp: null, engagement: 0 };
      }
      const content = str(r.content);
      return {
        id: i,
        title: str(r.title) || str(r.text) || content.substring(0, 120) || "Untitled",
        snippet: str(r.snippet) || str(r.description) || str(r.body) || content,
        url: r.url || r.link || r.href || null,
        source: str(r.source) || str(r.network) || str(r.platform) || "web",
        timestamp: r.created_at || r.date || r.timestamp || null,
        engagement: num(r.engagement || r.interactions || r.likes || 0),
      };
    }).filter(s => s.snippet.length > 0 || s.title !== "Untitled");
  }

  // If it's a text summary from AI search
  const summary = str(desearchData.summary || (typeof desearchData === "string" ? desearchData : ""));
  if (summary) {
    return [{
      id: 0,
      title: "AI Narrative Summary",
      snippet: summary,
      url: null,
      source: "ai",
      timestamp: null,
      engagement: 0,
    }];
  }

  return [];
}

/**
 * Extract social posts from LunarCrush topic posts data.
 */
export function extractSocialPosts(postsData) {
  if (!postsData) return [];
  const posts = postsData.data || postsData || [];
  if (!Array.isArray(posts)) return [];

  return posts.slice(0, 15).map((p, i) => ({
    id: p.id || i,
    text: p.title || p.body || p.text || "",
    creator: p.creator_name || p.creator_display_name || p.screen_name || "Unknown",
    network: p.network || p.type || "x",
    interactions: num(p.interactions || p.engagements || 0),
    sentiment: num(p.sentiment || 50),
    timestamp: p.time ? new Date(p.time * 1000).toLocaleString() : p.created_at || null,
    url: p.post_url || p.url || null,
  }));
}
