// Subnet Health Scoring Engine — Universal scoring for all subnets (emission-independent)

import { HEALTH_WEIGHTS, HEALTH_TIER_THRESHOLDS } from "./constants.js";

function percentileRank(value, allValues) {
  if (allValues.length <= 1) return 50;
  const below = allValues.filter(v => v < value).length;
  const equal = allValues.filter(v => v === value).length;
  return ((below + 0.5 * equal) / allValues.length) * 100;
}

function num(v) {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

/**
 * Resolve friendly name for a subnet.
 * Priority: pool name (most current) > GitHub meta > fallback
 */
function resolveName(subnet, pool, netuid, meta) {
  if (pool?.name && pool.name !== "Unknown") return pool.name;
  const metaEntry = meta[String(netuid)];
  if (metaEntry?.name) return metaEntry.name;
  if (subnet.name && subnet.name !== "Unknown") return subnet.name;
  return `Subnet ${netuid}`;
}

function resolveLogo(netuid, meta) {
  const metaEntry = meta[String(netuid)];
  return metaEntry?.image_url || null;
}

/**
 * Extract health metrics from subnet + pool data.
 * All metrics are emission-independent.
 */
function extractMetrics(subnet, pool, mechData = null) {
  const src = mechData || subnet;
  const activeValidators = num(src.active_validators);
  const maxValidators = num(subnet.max_validators) || 1;
  const activeMiners = num(src.active_miners);
  const maxNeurons = num(subnet.max_neurons) || 1;
  const activeKeys = num(src.active_keys);
  const registrations = num(src.neuron_registrations_this_interval);

  const totalTao = pool ? num(pool.total_tao) : 0;
  const alphaStaked = pool ? num(pool.alpha_staked) : 0;
  const alphaInPool = pool ? num(pool.alpha_in_pool) : 0;
  const volume24 = pool ? num(pool.tao_volume_24_hr) : 0;
  const marketCap = pool ? num(pool.market_cap) : 0;

  const priceChange1w = pool ? num(pool.price_change_1_week) : 0;
  const buys = pool ? num(pool.buys_24_hr) : 0;
  const sells = pool ? num(pool.sells_24_hr) : 0;
  const netFlow7 = num(subnet.net_flow_7_days);

  // D1: Network Health
  const h1_1 = maxValidators > 0 ? activeValidators / maxValidators : 0;  // Validator Activity
  const h1_2 = maxNeurons > 0 ? activeMiners / maxNeurons : 0;            // Miner Saturation
  const h1_3 = maxNeurons > 0 ? activeKeys / maxNeurons : 0;              // Key Utilization
  const h1_4 = registrations;                                              // Registration Demand

  // D2: Market Confidence
  const h2_1 = totalTao;                                                   // Liquidity Depth
  const alphaTotal = alphaStaked + alphaInPool;
  const h2_2 = alphaTotal > 0 ? alphaStaked / alphaTotal : 0;             // Staking Ratio
  const h2_3 = volume24;                                                   // Trading Activity
  const h2_4 = marketCap;                                                  // Market Cap

  // D3: Stability
  const h3_1 = Math.abs(priceChange1w);                                    // Price Volatility (INVERTED — lower = better)
  const h3_2 = netFlow7;                                                   // Capital Flow
  const totalTrades = buys + sells;
  const h3_3 = totalTrades > 0 ? buys / totalTrades : 0.5;                // Buy Pressure

  return {
    h1_1, h1_2, h1_3, h1_4,
    h2_1, h2_2, h2_3, h2_4,
    h3_1, h3_2, h3_3,
  };
}

/**
 * Score all subnets with emission-independent health metrics.
 * Returns array of scored subnets (ALL subnets, no inactive split).
 */
export function scoreHealth(subnetsRaw, poolsRaw, meta = {}, mechDataMap = {}) {
  const subnets = Array.isArray(subnetsRaw) ? subnetsRaw : (subnetsRaw?.data || []);
  const pools = Array.isArray(poolsRaw) ? poolsRaw : (poolsRaw?.data || []);

  // Build pool lookup by netuid
  const poolMap = {};
  pools.forEach(p => {
    const id = p.netuid ?? p.subnet_id;
    if (id != null) poolMap[id] = p;
  });

  if (subnets.length === 0) return [];

  // Extract metrics for ALL subnets
  const items = subnets.map(s => {
    const netuid = s.netuid ?? s.subnet_id;
    const pool = poolMap[netuid] || null;
    const mechData = mechDataMap[netuid] || null;
    const metrics = extractMetrics(s, pool, mechData);
    return { subnet: s, pool, netuid, metrics };
  });

  // Collect metric arrays for percentile calculation
  const metricKeys = Object.keys(items[0].metrics);
  const metricArrays = {};
  metricKeys.forEach(k => {
    metricArrays[k] = items.map(it => it.metrics[k]);
  });

  // Metrics where LOWER is better (inverted percentile)
  const invertedMetrics = new Set(["h3_1"]); // Price Volatility: lower = more stable = better

  const scored = items.map(it => {
    const pctRanks = {};
    metricKeys.forEach(k => {
      let pct = percentileRank(it.metrics[k], metricArrays[k]);
      if (invertedMetrics.has(k)) pct = 100 - pct;
      pctRanks[k] = pct;
    });

    // Dimension scores
    const d1 = (pctRanks.h1_1 + pctRanks.h1_2 + pctRanks.h1_3 + pctRanks.h1_4) / 4;
    const d2 = (pctRanks.h2_1 + pctRanks.h2_2 + pctRanks.h2_3 + pctRanks.h2_4) / 4;
    const d3 = (pctRanks.h3_1 + pctRanks.h3_2 + pctRanks.h3_3) / 3;

    // Weighted composite
    const composite = d1 * HEALTH_WEIGHTS.D1
                    + d2 * HEALTH_WEIGHTS.D2
                    + d3 * HEALTH_WEIGHTS.D3;

    const tier = composite >= HEALTH_TIER_THRESHOLDS.GREEN ? "green"
               : composite >= HEALTH_TIER_THRESHOLDS.AMBER ? "amber"
               : "red";

    return {
      netuid: it.netuid,
      name: resolveName(it.subnet, it.pool, it.netuid, meta),
      logo: resolveLogo(it.netuid, meta),
      subnet: it.subnet,
      pool: it.pool,
      metrics: it.metrics,
      pctRanks,
      dimensions: { D1: d1, D2: d2, D3: d3 },
      composite: Math.round(composite * 10) / 10,
      tier,
      hasEmission: num(it.subnet.emission) > 0,
    };
  });

  scored.sort((a, b) => b.composite - a.composite);
  return scored;
}
