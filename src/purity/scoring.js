// Purity Scoring Engine — Detects coordinated pump-and-dump vs organic staking patterns
// Post v3.4.6: TaoFlow EMA cycling exploit is dead (price-based emission is symmetric).
// Flow pattern analysis remains valuable for detecting manufactured demand.

import {
  SIGNAL_WEIGHTS,
  PUMP_THRESHOLDS,
  PURITY_TIERS,
  AGE_THRESHOLDS,
  FLOW_TREND,
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

/**
 * Percentile rank: higher value = higher percentile.
 */
function percentileRank(value, allValues) {
  if (allValues.length <= 1) return 50;
  const below = allValues.filter(v => v < value).length;
  const equal = allValues.filter(v => v === value).length;
  return ((below + 0.5 * equal) / allValues.length) * 100;
}

/**
 * Resolve subnet name. Priority: pool > meta > subnet > fallback.
 */
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
 * Determine flow trend direction.
 */
function flowTrend(netFlow7d, poolTao) {
  if (poolTao <= 0) return "flat";
  const ratio = netFlow7d / poolTao;
  if (ratio > FLOW_TREND.RISING) return "rising";
  if (ratio < FLOW_TREND.FALLING) return "falling";
  return "flat";
}

/**
 * Estimate subnet age in days from registration fields.
 * Tries: registered_at, created_at, registration_block (estimated at ~12s per block).
 */
function estimateAgeDays(subnet) {
  // Try timestamp fields first
  for (const field of ["registered_at", "created_at", "registration_timestamp"]) {
    const val = subnet[field];
    if (val) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        return Math.max(0, (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
      }
    }
  }
  // Try block-based estimation (~12 seconds per block on Bittensor)
  const block = num(subnet.registration_block || subnet.registered_block || subnet.reg_block);
  if (block > 0) {
    const currentBlock = num(subnet.current_block || subnet.block);
    if (currentBlock > block) {
      return (currentBlock - block) * 12 / (60 * 60 * 24);
    }
  }
  return null; // Age unknown
}

/**
 * Score all subnets for purity.
 *
 * Signal 1 — Pool Size vs Emission Share (40% weight)
 *   Ratio = emission_share_pct / pool_size_tao
 *   Higher ratio = suspicious (small pool, disproportionate emission)
 *   Inverted for purity: lower ratio = purer
 *
 * Signal 2 — Staking Concentration (25% weight)
 *   Measures: net_flow_7d / net_flow_30d (temporal concentration of staking)
 *   Values near 1.0 = most 30d inflow happened recently = coordination signal
 *   Values near 0.23 (7/30) = uniform gradual flow = organic
 *   Note: Post-TaoFlow, this no longer detects EMA cycling (that exploit is dead),
 *   but concentrated staking bursts remain a valid signal for manufactured demand.
 *
 * Signal 3 — Wallet Concentration (20% weight)
 *   Uses coldkey distribution from TaoStats /subnet/distribution/coldkey/v1
 *   Diversity ratio: unique_coldkeys / total_registrations
 *   Higher ratio = more organic, Lower ratio = concentrated = suspicious
 *
 * Signal 4 — Age vs Emission Share (15% weight)
 *   New subnets (<14 days) with high emission share = suspicious
 *   Old subnets (>90 days) = lower risk baseline
 *
 * @param {object} subnetsRaw - Subnet data from TaoStats
 * @param {object} poolsRaw - Pool data from TaoStats
 * @param {object} meta - GitHub subnet metadata
 * @param {object} coldkeyMap - Map of netuid -> { uniqueColdkeys, totalCount, entries[] }
 */
export function scorePurity(subnetsRaw, poolsRaw, meta = {}, coldkeyMap = {}) {
  const subnets = Array.isArray(subnetsRaw) ? subnetsRaw : (subnetsRaw?.data || []);
  const pools = Array.isArray(poolsRaw) ? poolsRaw : (poolsRaw?.data || []);

  const poolMap = {};
  pools.forEach(p => {
    const id = p.netuid ?? p.subnet_id;
    if (id != null) poolMap[id] = p;
  });

  // Only score subnets with emission > 0 (zero-emission subnets have no staking incentive to manipulate)
  const activeSubnets = subnets.filter(s => num(s.emission) > 0);
  if (activeSubnets.length === 0) return [];

  const totalEmission = activeSubnets.reduce((sum, s) => sum + num(s.emission), 0);

  // Extract raw signals for each subnet
  const items = activeSubnets.map(s => {
    const netuid = s.netuid ?? s.subnet_id;
    const pool = poolMap[netuid] || null;
    const poolTao = pool ? toTao(pool.total_tao) : 0;
    const emissionSharePct = totalEmission > 0 ? (num(s.emission) / totalEmission) * 100 : 0;
    const netFlow7d = num(s.net_flow_7_days);
    const netFlow30d = num(s.net_flow_30_days);
    const ageDays = estimateAgeDays(s);
    const marketCap = pool ? num(pool.market_cap) : 0;

    // Signal 1: Emission/Pool ratio (higher = more suspicious)
    const s1_ratio = poolTao > 0 ? emissionSharePct / poolTao : (emissionSharePct > 0 ? 999 : 0);

    // Signal 2: Flow spike recency (higher = more concentrated in recent window)
    let s2_concentration = 7 / 30; // ~0.23 = expected uniform baseline (neutral)
    if (netFlow30d > 0 && netFlow7d > 0) {
      s2_concentration = netFlow7d / netFlow30d;
    } else if (netFlow30d > 0 && netFlow7d <= 0) {
      s2_concentration = 0.45;
    }

    // Signal 3: Wallet concentration (coldkey diversity)
    const ckData = coldkeyMap[netuid];
    let s3_diversityRatio = null;
    let s3_uniqueColdkeys = null;
    let s3_totalCount = null;
    if (ckData && ckData.uniqueColdkeys > 0 && ckData.totalCount > 0) {
      s3_uniqueColdkeys = ckData.uniqueColdkeys;
      s3_totalCount = ckData.totalCount;
      // Diversity ratio: unique coldkeys / total registrations
      // 1.0 = every coldkey has exactly 1 registration = maximally distributed
      // Low values = few coldkeys control many registrations = concentrated
      s3_diversityRatio = ckData.uniqueColdkeys / ckData.totalCount;
    }

    // Signal 4: Age risk
    let s4_ageScore = null;
    if (ageDays !== null) {
      const ageFactor = Math.min(ageDays / AGE_THRESHOLDS.OLD_DAYS, 1.0);
      const emissionFactor = 1 - Math.min(emissionSharePct / 10, 1.0);
      s4_ageScore = ageFactor * 0.6 + emissionFactor * 0.4;
    }

    return {
      netuid,
      subnet: s,
      pool,
      poolTao,
      emissionSharePct,
      netFlow7d,
      netFlow30d,
      ageDays,
      marketCap,
      s1_ratio,
      s2_concentration,
      s3_diversityRatio,
      s3_uniqueColdkeys,
      s3_totalCount,
      s4_ageScore,
      trend: flowTrend(netFlow7d, poolTao),
    };
  });

  // Collect arrays for percentile ranking
  const s1_ratios = items.map(it => it.s1_ratio);
  const s2_concentrations = items.map(it => it.s2_concentration);
  const s3_diversities = items.filter(it => it.s3_diversityRatio !== null).map(it => it.s3_diversityRatio);
  const s4_scores = items.filter(it => it.s4_ageScore !== null).map(it => it.s4_ageScore);

  const s3_available_global = s3_diversities.length > 0;

  const scored = items.map(it => {
    // Signal 1: INVERT percentile (lower ratio = purer = higher score)
    const s1_pct = 100 - percentileRank(it.s1_ratio, s1_ratios);

    // Signal 2: INVERT percentile (lower concentration = more organic = higher score)
    const s2_pct = 100 - percentileRank(it.s2_concentration, s2_concentrations);

    // Signal 3: Direct percentile (higher diversity = more organic = higher score)
    const s3_has_data = it.s3_diversityRatio !== null && s3_available_global;
    const s3_pct = s3_has_data
      ? percentileRank(it.s3_diversityRatio, s3_diversities)
      : null;

    // Signal 4: Direct percentile (higher age score = safer)
    const s4_pct = it.s4_ageScore !== null
      ? percentileRank(it.s4_ageScore, s4_scores)
      : 50;

    const s4_available = it.s4_ageScore !== null;

    // Compute composite — redistribute unavailable signal weights proportionally
    let composite;
    const activeWeights = [];
    const activeScores = [];

    // S1 always available
    activeWeights.push(SIGNAL_WEIGHTS.S1);
    activeScores.push(s1_pct);

    // S2 always available
    activeWeights.push(SIGNAL_WEIGHTS.S2);
    activeScores.push(s2_pct);

    // S3 available if coldkey data exists for this subnet
    if (s3_has_data) {
      activeWeights.push(SIGNAL_WEIGHTS.S3);
      activeScores.push(s3_pct);
    }

    // S4 available if age could be estimated
    if (s4_available) {
      activeWeights.push(SIGNAL_WEIGHTS.S4);
      activeScores.push(s4_pct);
    }

    const totalWeight = activeWeights.reduce((a, b) => a + b, 0);
    composite = activeScores.reduce((sum, score, i) => sum + score * (activeWeights[i] / totalWeight), 0);

    const tier = composite >= PURITY_TIERS.ORGANIC ? "organic"
               : composite >= PURITY_TIERS.MIXED ? "mixed"
               : "suspicious";

    // Pump detection: S1 AND S2 both breach thresholds simultaneously
    const s1_breach = it.s1_ratio > PUMP_THRESHOLDS.S1_RATIO;
    const s2_breach = it.s2_concentration > PUMP_THRESHOLDS.S2_CONCENTRATION;
    const pumpDetected = s1_breach && s2_breach;

    // Build plain-English explanation of which signals fired
    const signals = [];

    if (s1_pct < 30) {
      signals.push(`Emission share (${it.emissionSharePct.toFixed(2)}%) is disproportionately high for pool size (${it.poolTao.toFixed(0)} TAO). Small pool capturing outsized rewards.`);
    } else if (s1_pct < 50) {
      signals.push(`Emission-to-pool ratio is elevated. Pool holds ${it.poolTao.toFixed(0)} TAO with ${it.emissionSharePct.toFixed(2)}% emission share.`);
    }

    if (s2_pct < 30) {
      const concPct = (it.s2_concentration * 100).toFixed(0);
      if (it.netFlow30d > 0 && it.netFlow7d > 0) {
        signals.push(`${concPct}% of 30-day inflow arrived in the last 7 days — suggests a recent coordinated staking spike rather than gradual organic accumulation.`);
      } else if (it.netFlow30d > 0 && it.netFlow7d <= 0) {
        signals.push(`Positive 30-day inflow but recent 7-day outflows — possible dump phase after earlier coordinated staking.`);
      }
    } else if (s2_pct < 50) {
      signals.push(`Inflow pattern is somewhat front-loaded toward recent days. Monitoring for coordination patterns.`);
    }

    if (s3_has_data && s3_pct < 30) {
      signals.push(`Low wallet diversity: only ${it.s3_uniqueColdkeys} unique coldkeys across ${it.s3_totalCount} registrations (ratio: ${it.s3_diversityRatio.toFixed(3)}). Staking is concentrated in few wallets — suggests manufactured demand.`);
    } else if (s3_has_data && s3_pct < 50) {
      signals.push(`Moderate wallet concentration: ${it.s3_uniqueColdkeys} coldkeys across ${it.s3_totalCount} registrations. Some concentration present.`);
    }

    if (s4_available && s4_pct < 30) {
      const age = it.ageDays < 1 ? "less than 1 day" : `${Math.round(it.ageDays)} days`;
      signals.push(`Subnet is ${age} old with ${it.emissionSharePct.toFixed(2)}% emission share — new subnets with high emission share are higher risk for manufactured demand.`);
    }

    if (pumpDetected) {
      signals.unshift("PUMP PATTERN: Both emission/pool ratio AND flow spike signals triggered simultaneously. High probability of coordinated staking exploit.");
    }

    if (signals.length === 0) {
      if (tier === "organic") {
        signals.push("All signals indicate organic staking behavior. Pool size is proportionate to emission share, flows are gradual, wallet distribution is healthy, and no coordination patterns detected.");
      } else {
        signals.push("No individual signal strongly triggered. Score reflects moderate risk across multiple dimensions.");
      }
    }

    return {
      netuid: it.netuid,
      name: resolveName(it.subnet, it.pool, it.netuid, meta),
      logo: resolveLogo(it.netuid, meta),
      subnet: it.subnet,
      pool: it.pool,
      purityScore: Math.round(composite * 10) / 10,
      tier,
      pumpDetected,
      signals: {
        s1: { score: Math.round(s1_pct * 10) / 10, ratio: it.s1_ratio, breach: s1_breach },
        s2: { score: Math.round(s2_pct * 10) / 10, concentration: it.s2_concentration, breach: s2_breach },
        s3: {
          available: s3_has_data,
          score: s3_has_data ? Math.round(s3_pct * 10) / 10 : null,
          uniqueColdkeys: it.s3_uniqueColdkeys,
          totalCount: it.s3_totalCount,
          diversityRatio: it.s3_diversityRatio,
        },
        s4: { score: s4_available ? Math.round(s4_pct * 10) / 10 : null, ageDays: it.ageDays, available: s4_available },
      },
      explanation: signals,
      poolTao: it.poolTao,
      emissionSharePct: it.emissionSharePct,
      trend: it.trend,
      marketCap: it.marketCap,
      netFlow7d: it.netFlow7d,
      netFlow30d: it.netFlow30d,
    };
  });

  scored.sort((a, b) => b.purityScore - a.purityScore);
  return scored;
}
