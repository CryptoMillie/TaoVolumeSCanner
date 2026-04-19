// SRI Flag Evaluation — F1–F5 independent of composite score

import {
  LIQUIDITY_DESERT_TAO,
  RAO_PER_TAO,
  DELIST_BOTTOM_N,
  VALIDATION_ABANDON_RATIO,
} from "./constants.js";

function num(v) {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

/**
 * Evaluate all flags for scored subnets.
 * Returns a Map of netuid -> array of active flag keys (e.g., ["F1", "F3"]).
 */
export function evaluateFlags(scoredSubnets) {
  const flagMap = {};

  // Pre-compute bottom N by pool rank for F2
  const withPoolRank = scoredSubnets
    .filter(s => s.pool && num(s.pool.rank) > 0)
    .map(s => ({ netuid: s.netuid, rank: num(s.pool.rank) }))
    .sort((a, b) => a.rank - b.rank);

  const bottomNetuids = new Set(
    withPoolRank.slice(0, DELIST_BOTTOM_N).map(s => s.netuid)
  );

  scoredSubnets.forEach(s => {
    const flags = [];
    const subnet = s.subnet;
    const pool = s.pool;

    // F1: Zero Emissions
    const emission = num(subnet.emission);
    if (emission === 0) {
      flags.push("F1");
    }

    // F2: Delisting Proximity — bottom 5 non-immune by pool rank
    if (bottomNetuids.has(s.netuid)) {
      flags.push("F2");
    }

    // F3: Liquidity Desert — total_tao < 2000 TAO
    if (pool) {
      const totalTao = num(pool.total_tao);
      // total_tao may be in rao (raw units) or TAO depending on API
      // Check if value looks like rao (very large) or TAO
      const taoValue = totalTao > 1e6 ? totalTao / RAO_PER_TAO : totalTao;
      if (taoValue < LIQUIDITY_DESERT_TAO) {
        flags.push("F3");
      }
    } else {
      // No pool data = definitely a liquidity desert
      flags.push("F3");
    }

    // F4: Governance Capture — only 1 active validator
    const activeValidators = num(subnet.active_validators);
    if (activeValidators <= 1) {
      flags.push("F4");
    }

    // F5: Validation Abandonment — active/total validators < 30%
    const totalValidators = num(subnet.validators);
    if (totalValidators > 0 && activeValidators / totalValidators < VALIDATION_ABANDON_RATIO) {
      flags.push("F5");
    }

    flagMap[s.netuid] = flags;
  });

  return flagMap;
}
