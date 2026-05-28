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
 * Subnets with 0 commits can ONLY be dormant or overhyped — never gem/established.
 */
function getQuadrant(commits7d, marketCap, medianCommits, medianMcap) {
  // Zero commits = no dev activity, cannot be gem or established
  if (commits7d === 0) {
    return marketCap >= medianMcap ? "overhyped" : "dormant";
  }
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
 * devActivityMap comes from TaoStats /api/dev_activity/latest/v1, keyed by netuid.
 */
export function scoreGems(subnets, pools, meta, devActivityMap, coinGecko) {
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
    const devData = devActivityMap[netuid] || null;
    const cgKey = `sn${netuid}`;
    const cgData = cgMap[cgKey];

    // Name resolution: pool (most current on-chain) -> meta -> subnet API -> fallback
    // Identical priority to SRI, Health, Purity, Intel, Volume scanners
    const name = (pool?.name && pool.name !== "Unknown") ? pool.name
               : metaEntry.name ? metaEntry.name
               : (s.name && s.name !== "Unknown") ? s.name
               : (s.subnet_name && s.subnet_name !== "Unknown") ? s.subnet_name
               : `Subnet ${netuid}`;
    const logo = metaEntry.image_url || null;

    // Dev metrics from TaoStats dev_activity endpoint
    const commits7d = devData ? devData.commits7d : 0;
    const hasRepo = !!(devData?.repoUrl || metaEntry.github);
    const repoUrl = devData?.repoUrl || metaEntry.github || "";

    // Extra dev metrics (available from TaoStats but not from old GitHub scraper)
    const prsMerged7d = devData ? devData.prsMerged7d : 0;
    const uniqueContributors7d = devData ? devData.uniqueContributors7d : 0;
    const daysSinceLastEvent = devData?.daysSinceLastEvent;

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
      repoUrl,
      prsMerged7d,
      uniqueContributors7d,
      daysSinceLastEvent,
      marketCap,
      volume,
      price,
      priceChange24h,
      poolTao,
      volMcRatio,
    };
  }).filter(item => item.marketCap > 0 || item.commits7d > 0);

  if (items.length === 0) return [];

  // Separate subnets with actual commits for proper percentile calculation
  const allCommits = items.map(it => it.commits7d);
  const allMcaps = items.map(it => it.marketCap);

  // Medians for quadrant classification — use non-zero values only
  const nonZeroCommits = allCommits.filter(c => c > 0);
  const medCommits = nonZeroCommits.length > 0 ? median(nonZeroCommits) : 1;
  const medMcap = median(allMcaps.filter(m => m > 0));

  const scored = items.map(it => {
    // Dev Score: 0 commits = 0 dev score, otherwise percentile within non-zero cohort
    let devScore;
    if (it.commits7d === 0) {
      devScore = 0;
    } else if (nonZeroCommits.length <= 1) {
      devScore = 50;
    } else {
      devScore = percentileRank(it.commits7d, nonZeroCommits);
    }

    // Value Score: INVERSE percentile rank of market cap (lower MC = higher score)
    const valueScore = 100 - percentileRank(it.marketCap, allMcaps);

    // Gem Score composite
    const gemScore = Math.round(
      (devScore * GEM_WEIGHTS.DEV + valueScore * GEM_WEIGHTS.VALUE) * 10
    ) / 10;

    // Tier — 0 commits caps you at "mixed" regardless of value score
    let tier;
    if (it.commits7d === 0) {
      tier = "gray";
    } else {
      tier = gemScore >= GEM_TIER_THRESHOLDS.GEM ? "gem"
           : gemScore >= GEM_TIER_THRESHOLDS.MODERATE ? "moderate"
           : gemScore >= GEM_TIER_THRESHOLDS.MIXED ? "mixed"
           : "gray";
    }

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
