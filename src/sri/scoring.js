// SRI Scoring Engine — Percentile ranking, dimension scoring, composite calc

import { DIMENSION_WEIGHTS, TIER_THRESHOLDS } from "./constants.js";

/**
 * Compute percentile rank of value within array (0–100).
 * Higher value = higher percentile (better).
 */
function percentileRank(value, allValues) {
  if (allValues.length <= 1) return 50;
  const below = allValues.filter(v => v < value).length;
  const equal = allValues.filter(v => v === value).length;
  return ((below + 0.5 * equal) / allValues.length) * 100;
}

/**
 * Safely parse a numeric field that might be a string, null, or undefined.
 */
function num(v) {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

/**
 * Extract raw metrics from subnet + pool data for a single subnet.
 */
function extractMetrics(subnet, pool, totalEmission, mechData = null) {
  const src = mechData || subnet;
  const emission = num(subnet.emission);
  const activeMiners = num(src.active_miners) || 1;
  const activeValidators = num(src.active_validators) || 0;
  const maxValidators = num(subnet.max_validators) || 1;
  const validators = num(subnet.validators) || 1;
  const registrations = num(src.neuron_registrations_this_interval);

  const totalTao = pool ? num(pool.total_tao) : 0;
  const alphaStaked = pool ? num(pool.alpha_staked) : 0;
  const alphaInPool = pool ? num(pool.alpha_in_pool) : 0;
  const poolRank = pool ? num(pool.rank) : 999;

  // D1: Emission Viability
  const m1_1 = num(subnet.net_flow_7_days);
  const m1_2 = totalEmission > 0 ? emission / totalEmission : 0;
  const m1_3 = poolRank;
  const netFlow30 = num(subnet.net_flow_30_days);
  const m1_4 = totalTao > 0 ? netFlow30 / totalTao : 0;

  // D2: Market Structure
  const m2_1 = totalTao;
  const alphaTotal = alphaStaked + alphaInPool;
  const m2_2 = alphaTotal > 0 ? alphaStaked / alphaTotal : 0;
  const m2_3 = emission / activeMiners;

  // D3: Economic Sustainability
  const projectedEmission = num(subnet.projected_emission || emission);
  const m3_1 = projectedEmission / activeMiners;
  const m3_2 = registrations / activeMiners;
  const m3_3 = maxValidators > 0 ? activeValidators / maxValidators : 0;

  // D4: Governance & Ops
  const m4_1 = activeValidators;
  const m4_2 = validators > 0 ? activeValidators / validators : 0;

  return {
    m1_1, m1_2, m1_3, m1_4,
    m2_1, m2_2, m2_3,
    m3_1, m3_2, m3_3,
    m4_1, m4_2,
  };
}

/**
 * Resolve friendly name for a subnet.
 * Priority: pool name (most current on-chain) > GitHub meta > API name > "Subnet {netuid}"
 * Filters out "Unknown" values.
 */
function resolveName(subnet, pool, netuid, meta) {
  if (pool?.name && pool.name !== "Unknown") return pool.name;
  const metaEntry = meta[String(netuid)];
  if (metaEntry?.name) return metaEntry.name;
  if (subnet.name && subnet.name !== "Unknown") return subnet.name;
  if (subnet.subnet_name && subnet.subnet_name !== "Unknown") return subnet.subnet_name;
  return `Subnet ${netuid}`;
}

/**
 * Resolve logo URL for a subnet.
 */
function resolveLogo(netuid, meta) {
  const metaEntry = meta[String(netuid)];
  return metaEntry?.image_url || null;
}

/**
 * Score all subnets. Returns { scored, unscored }.
 * - scored: subnets with emission > 0, ranked by composite
 * - unscored: subnets with emission == 0, shown with null composite
 */
export function scoreSubnets(subnetsRaw, poolsRaw, meta = {}, mechDataMap = {}) {
  const subnets = Array.isArray(subnetsRaw) ? subnetsRaw : (subnetsRaw?.data || []);
  const pools = Array.isArray(poolsRaw) ? poolsRaw : (poolsRaw?.data || []);

  // Build pool lookup by netuid
  const poolMap = {};
  pools.forEach(p => {
    const id = p.netuid ?? p.subnet_id;
    if (id != null) poolMap[id] = p;
  });

  const activeSubnets = [];
  const inactiveSubnets = [];

  subnets.forEach(s => {
    const em = num(s.emission);
    if (em > 0) {
      activeSubnets.push(s);
    } else {
      inactiveSubnets.push(s);
    }
  });

  // Build unscored list (zero-emission subnets)
  const unscored = inactiveSubnets.map(s => {
    const netuid = s.netuid ?? s.subnet_id;
    const pool = poolMap[netuid] || null;
    return {
      netuid,
      name: resolveName(s, pool, netuid, meta),
      logo: resolveLogo(netuid, meta),
      subnet: s,
      pool,
      metrics: null,
      pctRanks: null,
      dimensions: null,
      composite: null,
      tier: null,
    };
  });

  if (activeSubnets.length === 0) return { scored: [], unscored };

  const totalEmission = activeSubnets.reduce((sum, s) => sum + num(s.emission), 0);

  const items = activeSubnets.map(s => {
    const netuid = s.netuid ?? s.subnet_id;
    const pool = poolMap[netuid] || null;
    const mechData = mechDataMap[netuid] || null;
    const metrics = extractMetrics(s, pool, totalEmission, mechData);
    return { subnet: s, pool, netuid, metrics };
  });

  const metricKeys = Object.keys(items[0].metrics);
  const metricArrays = {};
  metricKeys.forEach(k => {
    metricArrays[k] = items.map(it => it.metrics[k]);
  });

  const invertedMetrics = new Set(["m3_2"]);

  const scored = items.map(it => {
    const pctRanks = {};
    metricKeys.forEach(k => {
      let pct = percentileRank(it.metrics[k], metricArrays[k]);
      if (invertedMetrics.has(k)) pct = 100 - pct;
      pctRanks[k] = pct;
    });

    const d1 = (pctRanks.m1_1 + pctRanks.m1_2 + pctRanks.m1_3 + pctRanks.m1_4) / 4;
    const d2 = (pctRanks.m2_1 + pctRanks.m2_2 + pctRanks.m2_3) / 3;
    const d3 = (pctRanks.m3_1 + pctRanks.m3_2 + pctRanks.m3_3) / 3;
    const d4 = (pctRanks.m4_1 + pctRanks.m4_2) / 2;

    const composite = d1 * DIMENSION_WEIGHTS.D1
                    + d2 * DIMENSION_WEIGHTS.D2
                    + d3 * DIMENSION_WEIGHTS.D3
                    + d4 * DIMENSION_WEIGHTS.D4;

    const tier = composite >= TIER_THRESHOLDS.GREEN ? "green"
               : composite >= TIER_THRESHOLDS.AMBER ? "amber"
               : "red";

    return {
      netuid: it.netuid,
      name: resolveName(it.subnet, it.pool, it.netuid, meta),
      logo: resolveLogo(it.netuid, meta),
      subnet: it.subnet,
      pool: it.pool,
      metrics: it.metrics,
      pctRanks,
      dimensions: { D1: d1, D2: d2, D3: d3, D4: d4 },
      composite: Math.round(composite * 10) / 10,
      tier,
    };
  });

  scored.sort((a, b) => b.composite - a.composite);
  return { scored, unscored };
}
