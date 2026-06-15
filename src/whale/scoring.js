// Whale Scoring Engine — Holder Concentration & Price Impact Analysis

import {
  WHALE_TIERS,
  WHALE_SIGNAL_WEIGHTS,
  RED_FLAG_THRESHOLDS,
  IMPACT_SEVERITY,
  RAO_PER_TAO,
} from "./constants.js";

function num(v) {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

function toTao(raw) {
  const v = num(raw);
  return v > 1e6 ? v / RAO_PER_TAO : v;
}

function percentileRank(value, allValues) {
  if (allValues.length <= 1) return 50;
  const below = allValues.filter(v => v < value).length;
  const equal = allValues.filter(v => v === value).length;
  return ((below + 0.5 * equal) / allValues.length) * 100;
}

function resolveName(subnet, pool, netuid, meta) {
  if (pool?.name && pool.name !== "Unknown") return pool.name;
  const metaEntry = meta[String(netuid)];
  if (metaEntry?.name) return metaEntry.name;
  if (subnet.name && subnet.name !== "Unknown") return subnet.name;
  if (subnet.subnet_name && subnet.subnet_name !== "Unknown") return subnet.subnet_name;
  return `Subnet ${netuid}`;
}

function resolveLogo(netuid, meta) {
  const metaEntry = meta[String(netuid)];
  return metaEntry?.image_url || null;
}

/**
 * Calculate Herfindahl-Hirschman Index from coldkey entries.
 * HHI = sum of (market_share_i)^2 * 10000
 * Range: ~0 (perfectly distributed) to 10000 (single holder)
 */
function calculateHHI(entries, totalCount) {
  if (!entries || entries.length === 0 || totalCount <= 0) return 0;
  let hhi = 0;
  for (const entry of entries) {
    const share = (entry.count || 0) / totalCount;
    hhi += share * share;
  }
  return hhi * 10000;
}

/**
 * Calculate top-N holder share as a fraction (0-1).
 */
function topNShare(sortedEntries, n, totalCount) {
  if (!sortedEntries || sortedEntries.length === 0 || totalCount <= 0) return 0;
  const topN = sortedEntries.slice(0, n);
  const topSum = topN.reduce((sum, e) => sum + (e.count || 0), 0);
  return topSum / totalCount;
}

/**
 * Estimate price impact if top whale exits using AMM constant-product model.
 * Simplified formula: impact = whale_share * (2 - whale_share)
 * This is derived from the constant-product AMM formula where removing
 * a fraction of liquidity causes disproportionate price movement.
 */
function estimatePriceImpact(whaleShare) {
  if (whaleShare <= 0) return 0;
  if (whaleShare >= 1) return 1;
  return whaleShare * (2 - whaleShare);
}

function impactSeverity(impactPct) {
  if (impactPct > IMPACT_SEVERITY.CRITICAL) return "CRITICAL";
  if (impactPct > IMPACT_SEVERITY.HIGH) return "HIGH";
  if (impactPct > IMPACT_SEVERITY.MODERATE) return "MODERATE";
  return "LOW";
}

/**
 * Score all subnets for whale concentration risk.
 *
 * For each subnet with coldkey data:
 * - Sort entries by count (descending) to identify top holders
 * - Calculate Top 1 / Top 5 / Top 10 holder % of total registrations
 * - Calculate HHI for concentration measurement
 * - Estimate price impact if top whale exits using AMM constant-product model
 * - Generate red flags
 * - Assign concentration tier
 *
 * @param {object} subnetsRaw - Subnet data from TaoStats
 * @param {object} poolsRaw - Pool data from TaoStats
 * @param {object} meta - GitHub subnet metadata
 * @param {object} coldkeyMap - Map of netuid -> { uniqueColdkeys, totalCount, entries[] }
 */
export function scoreWhales(subnetsRaw, poolsRaw, meta = {}, coldkeyMap = {}) {
  const subnets = Array.isArray(subnetsRaw) ? subnetsRaw : (subnetsRaw?.data || []);
  const pools = Array.isArray(poolsRaw) ? poolsRaw : (poolsRaw?.data || []);

  const poolMap = {};
  pools.forEach(p => {
    const id = p.netuid ?? p.subnet_id;
    if (id != null) poolMap[id] = p;
  });

  const activeSubnets = subnets.filter(s => num(s.emission) > 0);
  if (activeSubnets.length === 0) return [];

  // Build raw items for each subnet that has coldkey data
  const items = [];

  for (const s of activeSubnets) {
    const netuid = s.netuid ?? s.subnet_id;
    const ckData = coldkeyMap[netuid];
    if (!ckData || !ckData.entries || ckData.entries.length === 0 || ckData.totalCount <= 0) continue;

    const pool = poolMap[netuid] || null;
    const poolTao = pool ? toTao(pool.total_tao) : 0;
    const marketCap = pool ? num(pool.market_cap) : 0;
    const alphaInPool = pool ? toTao(pool.alpha_in_pool || pool.alpha_reserve || 0) : 0;

    // Sort entries by count descending to identify top holders
    const sortedEntries = [...ckData.entries].sort((a, b) => (b.count || 0) - (a.count || 0));
    const totalCount = ckData.totalCount;

    // Calculate top holder shares
    const top1Share = topNShare(sortedEntries, 1, totalCount);
    const top5Share = topNShare(sortedEntries, 5, totalCount);
    const top10Share = topNShare(sortedEntries, 10, totalCount);

    // Calculate HHI
    const hhi = calculateHHI(sortedEntries, totalCount);

    // Estimate price impact if top whale dumps
    const impactFraction = estimatePriceImpact(top1Share);
    const impactPct = impactFraction * 100;

    // Generate red flags
    const flags = [];
    if (top1Share > RED_FLAG_THRESHOLDS.SINGLE_WHALE) {
      flags.push({ id: "SINGLE_WHALE", label: "SINGLE WHALE", desc: `Top holder controls ${(top1Share * 100).toFixed(1)}% of registrations` });
    }
    if (top5Share > RED_FLAG_THRESHOLDS.TOP_HEAVY) {
      flags.push({ id: "TOP_HEAVY", label: "TOP HEAVY", desc: `Top 5 holders control ${(top5Share * 100).toFixed(1)}% of registrations` });
    }
    if ((top1Share > 0.30 || hhi > 1500) && poolTao < RED_FLAG_THRESHOLDS.THIN_LIQUIDITY_TAO) {
      flags.push({ id: "THIN_LIQUIDITY", label: "THIN LIQUIDITY", desc: `High concentration with only ${poolTao.toFixed(0)} TAO in pool` });
    }
    if (hhi > RED_FLAG_THRESHOLDS.HHI_CONCENTRATED) {
      flags.push({ id: "CONCENTRATION_RISK", label: "HHI RISK", desc: `HHI of ${Math.round(hhi)} exceeds DOJ antitrust threshold (2500)` });
    }

    items.push({
      netuid,
      subnet: s,
      pool,
      poolTao,
      marketCap,
      alphaInPool,
      sortedEntries,
      totalCount,
      uniqueColdkeys: ckData.uniqueColdkeys,
      top1Share,
      top5Share,
      top10Share,
      hhi,
      impactPct,
      impactSeverity: impactSeverity(impactPct),
      flags,
    });
  }

  if (items.length === 0) return [];

  // Collect arrays for percentile ranking (inverted: higher concentration = worse = lower score)
  const top1Values = items.map(it => it.top1Share);
  const top5Values = items.map(it => it.top5Share);
  const hhiValues = items.map(it => it.hhi);
  const impactValues = items.map(it => it.impactPct);

  const scored = items.map(it => {
    // INVERTED percentile: lower concentration = higher score = safer
    const top1Score = 100 - percentileRank(it.top1Share, top1Values);
    const top5Score = 100 - percentileRank(it.top5Share, top5Values);
    const hhiScore = 100 - percentileRank(it.hhi, hhiValues);
    const impactScore = 100 - percentileRank(it.impactPct, impactValues);

    // Composite whale score (0-100, higher = safer/more distributed)
    const composite =
      top1Score * WHALE_SIGNAL_WEIGHTS.TOP1 +
      top5Score * WHALE_SIGNAL_WEIGHTS.TOP5 +
      hhiScore * WHALE_SIGNAL_WEIGHTS.HHI +
      impactScore * WHALE_SIGNAL_WEIGHTS.IMPACT;

    // Assign tier
    const tier = composite >= WHALE_TIERS.DISTRIBUTED ? "distributed"
               : composite >= WHALE_TIERS.MODERATE ? "moderate"
               : composite >= WHALE_TIERS.CONCENTRATED ? "concentrated"
               : "whale-dominated";

    // Build plain-English explanation
    const explanation = [];

    if (it.top1Share > 0.50) {
      explanation.push(`Single whale dominance: Top holder controls ${(it.top1Share * 100).toFixed(1)}% of all registrations. Extreme concentration risk.`);
    } else if (it.top1Share > 0.30) {
      explanation.push(`Significant whale presence: Top holder controls ${(it.top1Share * 100).toFixed(1)}% of registrations.`);
    } else if (it.top1Share > 0.15) {
      explanation.push(`Moderate top holder share at ${(it.top1Share * 100).toFixed(1)}%.`);
    }

    if (it.top5Share > 0.80) {
      explanation.push(`Top-heavy distribution: Top 5 holders control ${(it.top5Share * 100).toFixed(1)}% of registrations. Very few participants hold significant stake.`);
    } else if (it.top5Share > 0.60) {
      explanation.push(`Top 5 holders control ${(it.top5Share * 100).toFixed(1)}% — above-average concentration.`);
    }

    if (it.hhi > 2500) {
      explanation.push(`HHI of ${Math.round(it.hhi)} indicates highly concentrated ownership (above DOJ antitrust threshold of 2500).`);
    } else if (it.hhi > 1500) {
      explanation.push(`HHI of ${Math.round(it.hhi)} indicates moderately concentrated ownership.`);
    }

    if (it.impactPct > 30) {
      explanation.push(`CRITICAL: If the top whale exits, estimated price impact is ${it.impactPct.toFixed(1)}% — would likely cause a severe crash.`);
    } else if (it.impactPct > 15) {
      explanation.push(`High price impact risk: Top whale exit could cause a ${it.impactPct.toFixed(1)}% price drop.`);
    } else if (it.impactPct > 5) {
      explanation.push(`Moderate price impact: Top whale exit estimated at ${it.impactPct.toFixed(1)}% price movement.`);
    }

    if (it.flags.some(f => f.id === "THIN_LIQUIDITY")) {
      explanation.push(`Low pool liquidity (${it.poolTao.toFixed(0)} TAO) amplifies whale exit risk.`);
    }

    if (explanation.length === 0) {
      if (tier === "distributed") {
        explanation.push("Holder distribution is healthy. No single entity dominates, HHI is low, and estimated whale exit impact is minimal.");
      } else {
        explanation.push("Some concentration present but no individual metric strongly triggered. Score reflects moderate risk across dimensions.");
      }
    }

    // Top 5 holders breakdown for expanded view
    const topHolders = it.sortedEntries.slice(0, 5).map(e => ({
      coldkey: e.coldkey || e.address || "unknown",
      count: e.count || 0,
      share: it.totalCount > 0 ? (e.count || 0) / it.totalCount : 0,
    }));

    return {
      netuid: it.netuid,
      name: resolveName(it.subnet, it.pool, it.netuid, meta),
      logo: resolveLogo(it.netuid, meta),
      whaleScore: Math.round(composite * 10) / 10,
      tier,
      top1Pct: it.top1Share * 100,
      top5Pct: it.top5Share * 100,
      top10Pct: it.top10Share * 100,
      hhi: Math.round(it.hhi),
      impactPct: Math.round(it.impactPct * 10) / 10,
      impactSeverity: it.impactSeverity,
      flags: it.flags,
      explanation,
      topHolders,
      totalCount: it.totalCount,
      uniqueColdkeys: it.uniqueColdkeys,
      poolTao: it.poolTao,
      marketCap: it.marketCap,
      alphaInPool: it.alphaInPool,
      signals: {
        top1: { score: Math.round((100 - percentileRank(it.top1Share, top1Values)) * 10) / 10 },
        top5: { score: Math.round((100 - percentileRank(it.top5Share, top5Values)) * 10) / 10 },
        hhi: { score: Math.round((100 - percentileRank(it.hhi, hhiValues)) * 10) / 10 },
        impact: { score: Math.round((100 - percentileRank(it.impactPct, impactValues)) * 10) / 10 },
      },
    };
  });

  scored.sort((a, b) => a.whaleScore - b.whaleScore); // lowest score (most whale-dominated) first
  return scored;
}
