// Gem Scanner Scoring Engine — Dev Activity vs Market Cap composite

import { GEM_WEIGHTS, GEM_TIER_THRESHOLDS } from "./constants.js";

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
 * Determine quadrant for a subnet based on commit count and market cap
 * relative to the cohort medians.
 */
function getQuadrant(commits7d, marketCap, medianCommits, medianMcap) {
  const highDev = commits7d >= medianCommits;
  const highMcap = marketCap >= medianMcap;
  if (highDev && highMcap) return "established";
  if (highDev && !highMcap) return "gem";
  if (!highDev && highMcap) return "overhyped";
  return "dormant";
}

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Score all subnets with Gem Score.
 *
 * @param {Array} subnets - TaoStats subnet data
 * @param {Array} pools - TaoStats pool data
 * @param {Object} meta - GitHub subnet metadata
 * @param {Object} githubMap - Map<netuid, { commits7d, owner, repo, repoUrl }>
 * @param {Array} coinGecko - CoinGecko market data
 * @returns {Array} Scored subnet objects sorted by Gem Score desc
 */
export function scoreGems(subnets, pools, meta, githubMap, coinGecko) {
  const subnetArr = Array.isArray(subnets) ? subnets : (subnets?.data || []);
  const poolArr = Array.isArray(pools) ? pools : (pools?.data || []);

  // Build pool lookup: netuid -> pool
  const poolMap = {};
  poolArr.forEach(p => {
    const id = p.netuid ?? p.subnet_id;
    if (id != null) poolMap[id] = p;
  });

  // Build CoinGecko lookup: "sn{id}" symbol -> market data
  const cgMap = {};
  if (Array.isArray(coinGecko)) {
    coinGecko.forEach(c => {
      if (c.symbol) cgMap[c.symbol.toLowerCase()] = c;
    });
  }

  // Build items with all metrics
  const items = subnetArr.map(s => {
    const netuid = s.netuid ?? s.subnet_id;
    const metaEntry = meta[String(netuid)] || {};
    const pool = poolMap[netuid];
    const ghData = githubMap[netuid];
    const cgKey = `sn${netuid}`;
    const cgData = cgMap[cgKey];

    const name = metaEntry.name || pool?.name || `Subnet ${netuid}`;
    const logo = metaEntry.image_url || null;

    // Dev metrics
    const commits7d = ghData ? ghData.commits7d : 0;
    const hasRepo = !!ghData;
    const rateLimited = ghData?.rateLimited || false;
    const repoUrl = ghData?.repoUrl || metaEntry.github || "";

    // Market metrics from CoinGecko
    const marketCap = num(cgData?.market_cap);
    const volume = num(cgData?.total_volume);
    const price = num(cgData?.current_price);
    const priceChange24h = num(cgData?.price_change_percentage_24h);

    // Pool TAO for Vol/MC ratio
    const poolTao = num(pool?.tao_reserve || pool?.tao_in_pool);

    // Vol/MC ratio (reuse logic from Volume Scanner)
    const volMcRatio = marketCap > 0 ? (volume / marketCap) * 100 : 0;

    return {
      netuid,
      name,
      logo,
      commits7d,
      hasRepo,
      rateLimited,
      repoUrl,
      marketCap,
      volume,
      price,
      priceChange24h,
      poolTao,
      volMcRatio,
    };
  }).filter(item => item.marketCap > 0 || item.commits7d > 0); // Exclude subnets with zero data

  if (items.length === 0) return [];

  // Calculate percentile ranks
  const allCommits = items.map(it => it.commits7d);
  const allMcaps = items.map(it => it.marketCap);

  // Medians for quadrant classification
  const medCommits = median(allCommits.filter(c => c > 0)); // median of non-zero
  const medMcap = median(allMcaps.filter(m => m > 0));

  const scored = items.map(it => {
    // Dev Score: percentile rank of commits (higher = better)
    const devScore = percentileRank(it.commits7d, allCommits);

    // Value Score: INVERSE percentile rank of market cap (lower MC = higher score)
    const valueScore = 100 - percentileRank(it.marketCap, allMcaps);

    // Gem Score composite
    const gemScore = Math.round(
      (devScore * GEM_WEIGHTS.DEV + valueScore * GEM_WEIGHTS.VALUE) * 10
    ) / 10;

    // Tier
    const tier = gemScore >= GEM_TIER_THRESHOLDS.GEM ? "gem"
               : gemScore >= GEM_TIER_THRESHOLDS.MODERATE ? "moderate"
               : gemScore >= GEM_TIER_THRESHOLDS.MIXED ? "mixed"
               : "gray";

    // Quadrant
    const quadrant = getQuadrant(it.commits7d, it.marketCap, medCommits, medMcap);

    return {
      ...it,
      devScore: Math.round(devScore * 10) / 10,
      valueScore: Math.round(valueScore * 10) / 10,
      gemScore,
      tier,
      quadrant,
    };
  });

  scored.sort((a, b) => b.gemScore - a.gemScore);
  return scored;
}
