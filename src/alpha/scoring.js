// Alpha Signal Scoring Engine — CoinGecko market data composite

import { ALPHA_WEIGHTS, ALPHA_TIER_THRESHOLDS } from "./constants.js";
import { annotateEmissionPerCap } from "../lib/emissionPerCap.js";

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
 * Score Bittensor ecosystem coins using CoinGecko market data.
 *
 * Dimensions (mapped from available CoinGecko fields):
 *   MOMENTUM:  price_change_percentage_24h + price_change_percentage_7d
 *   VOLUME:    total_volume + volume/market_cap ratio
 *   MARKET:    market_cap + inverse market_cap_rank (lower rank = better)
 *   ONCHAIN:   ATH proximity + 24h price range utilization
 */
export function scoreAlphaSignals(coins, pools, meta, subnets = [], taoUsdPrice = null) {
  if (!coins || !Array.isArray(coins) || coins.length === 0) return [];

  // Build symbol → pool lookup from TaoStats pool data (same as other tabs)
  const poolBySymbol = {};
  const poolArr = Array.isArray(pools) ? pools : (pools?.data || []);
  poolArr.forEach((p) => {
    const sym = (p.symbol || p.token_symbol || "").toLowerCase();
    if (sym) poolBySymbol[sym] = p;
  });

  // Build netuid → subnet lookup — needed for emission-per-cap (this tab is
  // otherwise pure CoinGecko, no emission data).
  const subnetMap = {};
  const subnetArr = Array.isArray(subnets) ? subnets : (subnets?.data || []);
  subnetArr.forEach((s) => {
    const id = s.netuid ?? s.subnet_id;
    if (id != null) subnetMap[id] = s;
  });
  const totalRealEmission = subnetArr.reduce((sum, s) => sum + num(s.emission), 0);

  // Build netuid → meta lookup
  const metaMap = meta || {};

  const items = coins.map(c => {
    const volume = num(c.total_volume);
    const marketCap = num(c.market_cap);
    const priceChange24h = num(c.price_change_percentage_24h);
    const priceChange7d = num(c.price_change_percentage_7d_in_currency || c.price_change_percentage_7d);
    const mcRank = num(c.market_cap_rank);
    const athChangePct = num(c.ath_change_percentage);
    const high24 = num(c.high_24h);
    const low24 = num(c.low_24h);
    const price = num(c.current_price);
    const circSupply = num(c.circulating_supply);
    const totalSupply = num(c.total_supply);

    // Volume/MC ratio (key anomaly signal)
    const volMcRatio = marketCap > 0 ? (volume / marketCap) * 100 : 0;

    // 24h range utilization: where is price within today's range (0-1)
    const range24h = high24 > low24 ? (price - low24) / (high24 - low24) : 0.5;

    // ATH proximity (closer to ATH = stronger, convert negative % to positive proximity)
    const athProximity = Math.max(0, 100 + athChangePct); // 0 = at ATH, 100 = no drawdown

    // Inverse rank score (lower rank = higher score)
    const rankScore = mcRank > 0 ? Math.max(0, 1000 - mcRank) : 0;

    // Resolve subnet name using same priority as other tabs:
    // pool.name → meta.name → CoinGecko name → fallback
    const sym = (c.symbol || "").toLowerCase();
    const pool = poolBySymbol[sym] || null;
    const netuid = pool ? (pool.netuid ?? pool.subnet_id) : null;
    const m = netuid != null ? metaMap[String(netuid)] : null;
    const resolvedName =
      pool?.name && pool.name !== "Unknown"
        ? pool.name
        : m?.name
          ? m.name
          : c.name
            ? c.name
            : "Unknown";

    return {
      raw: c,
      symbol: c.symbol || "???",
      name: resolvedName,
      netuid,
      pool,
      metrics: {
        momentum_1: Math.abs(priceChange24h), // absolute momentum (direction-agnostic strength)
        momentum_2: Math.abs(priceChange7d),
        volume_1: volume,
        volume_2: volMcRatio,
        market_1: marketCap,
        market_2: rankScore,
        onchain_1: athProximity,
        onchain_2: range24h * 100,
      },
      display: {
        volume,
        marketCap,
        priceChange24h,
        priceChange7d,
        volMcRatio,
        athChangePct,
        range24h,
        mcRank,
        price,
        circSupply,
        totalSupply,
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

    const MOMENTUM = (pct.momentum_1 + pct.momentum_2) / 2;
    const VOLUME = (pct.volume_1 + pct.volume_2) / 2;
    const MARKET = (pct.market_1 + pct.market_2) / 2;
    const ONCHAIN = (pct.onchain_1 + pct.onchain_2) / 2;

    const composite = MOMENTUM * ALPHA_WEIGHTS.MOMENTUM
                    + VOLUME * ALPHA_WEIGHTS.VOLUME
                    + MARKET * ALPHA_WEIGHTS.MARKET
                    + ONCHAIN * ALPHA_WEIGHTS.ONCHAIN;

    const tier = composite >= ALPHA_TIER_THRESHOLDS.SIGNAL ? "signal"
               : composite >= ALPHA_TIER_THRESHOLDS.WATCH ? "watch"
               : "noise";

    // Sentiment label derived from 24h price action
    const sentimentLabel = it.display.priceChange24h > 5 ? "bullish"
                         : it.display.priceChange24h < -5 ? "bearish"
                         : "neutral";

    const subnet = it.netuid != null ? subnetMap[it.netuid] : null;
    const epc = subnet ? annotateEmissionPerCap(subnet, it.pool, totalRealEmission, taoUsdPrice) : {};

    return {
      ...it.display,
      symbol: it.symbol,
      name: it.name,
      netuid: it.netuid,
      dimensions: { MOMENTUM, VOLUME, MARKET, ONCHAIN },
      composite: Math.round(composite * 10) / 10,
      tier,
      sentimentLabel,
      raw: it.raw,
      emissionPerCap: epc.emissionPerCap ?? null,
      epcTier: epc.epcTier ?? "normal",
      si: epc.si ?? null,
      change1M: epc.change1M ?? null,
    };
  });

  scored.sort((a, b) => b.composite - a.composite);
  return scored;
}

/**
 * Extract narrative signals from Desearch AI results.
 */
export function extractNarrativeSignals(desearchData) {
  if (!desearchData) return [];

  function str(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  let results = desearchData.results || desearchData.data || desearchData.organic_results || [];

  if (!Array.isArray(results)) {
    if (typeof results === "object" && results !== null) results = [results];
    else results = [];
  }

  if (results.length > 0) {
    return results.map((r, i) => {
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
