// Institutional Scoring Engine — Revenue, TAM, PMF (percentile-based)
//
// v440: rev_2 used to be raw emission/totalEmission labeled "yield
// generation" — exactly the APY-adjacent bug the v440 audit flags as highest
// severity, since emission share is now a *gated*, convex function of
// demand (see src/lib/gate.js), not a linear one. rev_2 is now the
// post-gate share. A subnet deep in the tail can show the same raw
// `emission` as one near the bar while its forward share is 1.5-11% of what
// a pre-gate linear read would suggest — do not reintroduce raw emission
// share here.

import { INST_WEIGHTS, INST_TIER_THRESHOLDS } from "./constants.js";
import { GATE_DEFAULTS, applyGate, demandFromPriceAndBurn } from "../lib/gate.js";

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
 * Extract institutional metrics from subnet + pool data.
 *
 * Revenue proxy: total_tao (liquidity depth = capital committed) + emission share
 * TAM proxy: market_cap (current reach) + net_flow_7_days (growth trajectory)
 * PMF proxy: staking ratio (user conviction) + tao_volume_24_hr (actual usage)
 */
function extractMetrics(subnet, pool, gatedShare) {
  const totalTao = pool ? num(pool.total_tao) : 0;
  const marketCap = pool ? num(pool.market_cap) : 0;
  const netFlow7 = num(subnet.net_flow_7_days);
  const volume24 = pool ? num(pool.tao_volume_24_hr) : 0;
  const alphaStaked = pool ? num(pool.alpha_staked) : 0;
  const alphaInPool = pool ? num(pool.alpha_in_pool) : 0;
  const alphaTotal = alphaStaked + alphaInPool;

  // REV: Revenue / Path to Revenue
  const rev_1 = totalTao;    // Liquidity depth (capital deployed)
  const rev_2 = gatedShare;  // Post-gate emission share (yield generation)

  // TAM: Total Addressable Market
  const tam_1 = marketCap;                                        // Current market size
  const tam_2 = netFlow7;                                         // Growth signal (capital inflow)

  // PMF: Product-Market Fit
  const pmf_1 = alphaTotal > 0 ? alphaStaked / alphaTotal : 0;   // Staking conviction (users lock up)
  const pmf_2 = volume24;                                         // Usage/trading activity

  return { rev_1, rev_2, tam_1, tam_2, pmf_1, pmf_2 };
}

/**
 * Score all subnets with institutional metrics.
 * Returns array sorted by composite score descending.
 */
export function scoreInstitutional(subnetsRaw, poolsRaw, meta = {}, gateConfig = GATE_DEFAULTS) {
  const subnets = Array.isArray(subnetsRaw) ? subnetsRaw : (subnetsRaw?.data || []);
  const pools = Array.isArray(poolsRaw) ? poolsRaw : (poolsRaw?.data || []);

  const poolMap = {};
  pools.forEach(p => {
    const id = p.netuid ?? p.subnet_id;
    if (id != null) poolMap[id] = p;
  });

  // Exclude SN0 (root) — it's infrastructure, not a product subnet
  const candidates = subnets.filter(s => (s.netuid ?? s.subnet_id) !== 0);

  // v440 gate pass (taostats-proxy demand — see The Bar tab for the
  // verified on-chain source + reconciliation).
  const demandRows = candidates
    .filter(s => num(s.emission) > 0)
    .map(s => {
      const netuid = s.netuid ?? s.subnet_id;
      const pool = poolMap[netuid] || null;
      const price = pool ? num(pool.price || pool.alpha_price) : 0;
      const burn = num(s.incentive_burn);
      return { netuid, demand: demandFromPriceAndBurn(price, burn), emissionEnabled: true };
    });
  const gated = applyGate(demandRows, gateConfig);
  const gateByNetuid = {};
  gated.forEach(g => { gateByNetuid[g.netuid] = g; });

  const items = candidates.map(s => {
    const netuid = s.netuid ?? s.subnet_id;
    const pool = poolMap[netuid] || null;
    const gate = gateByNetuid[netuid] || null;
    const metrics = extractMetrics(s, pool, gate?.share ?? 0);
    return { subnet: s, pool, netuid, metrics, gate };
  });

  if (items.length === 0) return [];

  // Collect metric arrays for percentile calculation
  const metricKeys = Object.keys(items[0].metrics);
  const metricArrays = {};
  metricKeys.forEach(k => {
    metricArrays[k] = items.map(it => it.metrics[k]);
  });

  const scored = items.map(it => {
    const pctRanks = {};
    metricKeys.forEach(k => {
      pctRanks[k] = percentileRank(it.metrics[k], metricArrays[k]);
    });

    // Dimension scores (average of sub-metrics)
    const REV = (pctRanks.rev_1 + pctRanks.rev_2) / 2;
    const TAM = (pctRanks.tam_1 + pctRanks.tam_2) / 2;
    const PMF = (pctRanks.pmf_1 + pctRanks.pmf_2) / 2;

    const composite = REV * INST_WEIGHTS.REV
                    + TAM * INST_WEIGHTS.TAM
                    + PMF * INST_WEIGHTS.PMF;

    const tier = composite >= INST_TIER_THRESHOLDS.INSTITUTIONAL ? "institutional"
               : composite >= INST_TIER_THRESHOLDS.EMERGING ? "emerging"
               : "speculative";

    // Resolve name
    const pool = it.pool;
    const metaEntry = meta[String(it.netuid)];
    const name = (pool?.name && pool.name !== "Unknown") ? pool.name
               : metaEntry?.name ? metaEntry.name
               : (it.subnet.name && it.subnet.name !== "Unknown") ? it.subnet.name
               : `Subnet ${it.netuid}`;
    const logo = metaEntry?.image_url || null;

    return {
      netuid: it.netuid,
      name,
      logo,
      subnet: it.subnet,
      pool: it.pool,
      dimensions: { REV, TAM, PMF },
      composite: Math.round(composite * 10) / 10,
      tier,
      gateRatio: it.gate?.ratio ?? null,
      gatePct: it.gate?.gate ?? null,
      gateElasticity: it.gate?.elasticity ?? null,
    };
  });

  scored.sort((a, b) => b.composite - a.composite);
  return scored;
}
