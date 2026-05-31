// Conviction Locks Scoring — Lock % of pool classification + summary stats
// Post Conviction v2: every subnet has a lock, so we measure lock as % of total subnet alpha

import { HEAVY_PCT, MODERATE_PCT, LIGHT_PCT, STRONG_THRESHOLD, BUILDING_MIN } from "./constants.js";

function num(v) {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

/**
 * Classify lock status by lock % of total subnet alpha
 * Returns: "heavy" | "moderate" | "light" | "nolock" | "error"
 */
export function classifyLockStatus(entry) {
  if (entry.rpcError) return "error";
  if (!entry.hasLock || entry.locked_mass <= 0) return "nolock";
  if (!entry.alphaTotal || entry.alphaTotal <= 0) {
    // No pool data — fall back to absolute: if lock exists, call it light
    return entry.locked_mass > 0 ? "light" : "nolock";
  }

  const pct = entry.locked_mass / entry.alphaTotal;
  if (pct >= HEAVY_PCT) return "heavy";
  if (pct >= MODERATE_PCT) return "moderate";
  if (pct >= LIGHT_PCT) return "light";
  return "light"; // has lock but < 0.1% of pool
}

/**
 * Classify lock status for a challenger hotkey lock
 * Challengers still use conviction/locked_mass ratio (organic, not affected by migration)
 * Returns: "strong" | "building" | "zero"
 */
export function classifyChallengerStatus(challenger) {
  if (challenger.locked_mass <= 0) return "zero";
  if (challenger.conviction <= 0) return "zero";
  const ratio = challenger.conviction / challenger.locked_mass;
  if (ratio >= STRONG_THRESHOLD) return "strong";
  if (ratio >= BUILDING_MIN) return "building";
  return "zero";
}

/**
 * Get lock % of pool (0-1) for display
 */
export function getLockPct(entry) {
  if (!entry.hasLock || entry.locked_mass <= 0) return 0;
  if (!entry.alphaTotal || entry.alphaTotal <= 0) return 0;
  return entry.locked_mass / entry.alphaTotal;
}

/**
 * Process raw conviction data into scored/classified entries
 */
export function scoreConviction(convictionData, poolData, subnetMeta) {
  if (!convictionData?.results) return [];

  // Build pool lookup
  const poolMap = {};
  const poolArr = Array.isArray(poolData) ? poolData : (poolData?.data || []);
  poolArr.forEach((p) => {
    const id = p.netuid ?? p.subnet_id;
    if (id != null) poolMap[id] = p;
  });

  return convictionData.results.map((entry) => {
    const pool = poolMap[entry.netuid];
    const meta = subnetMeta?.[String(entry.netuid)] || null;

    // Name resolution: pool -> meta -> entry -> fallback (same priority as all tabs)
    const name =
      pool?.name && pool.name !== "Unknown"
        ? pool.name
        : meta?.name
          ? meta.name
          : entry.name
            ? entry.name
            : `Subnet ${entry.netuid}`;

    // Compute total subnet alpha — pool API returns rao, locked_mass is already in alpha (rao / 1e9)
    const alphaStaked = pool ? num(pool.alpha_staked) / 1e9 : 0;
    const alphaInPool = pool ? num(pool.alpha_in_pool) / 1e9 : 0;
    const alphaTotal = alphaStaked + alphaInPool;

    // Enrich entry with pool context
    const enriched = {
      ...entry,
      name,
      alphaTotal,
    };

    const lockPct = getLockPct(enriched);
    const status = classifyLockStatus(enriched);

    // Score challenger locks for this subnet (still uses conviction ratio)
    const scoredChallengers = (entry.challengers || []).map((c) => ({
      ...c,
      status: classifyChallengerStatus(c),
      ratio: c.locked_mass > 0 && c.conviction > 0
        ? Math.min(c.conviction / c.locked_mass, 1)
        : 0,
    }));

    return {
      ...enriched,
      lockPct,
      status,
      challengers: scoredChallengers,
    };
  });
}

/**
 * Compute summary statistics for the conviction data
 */
export function computeSummary(scored) {
  const totalWithLock = scored.filter((s) => s.hasLock && s.locked_mass > 0).length;
  const totalLocked = scored.reduce(
    (sum, s) => sum + (s.hasLock ? s.locked_mass : 0),
    0
  );
  const noLock = scored.filter((s) => s.status === "nolock").length;
  const heavy = scored.filter((s) => s.status === "heavy").length;
  const moderate = scored.filter((s) => s.status === "moderate").length;
  const light = scored.filter((s) => s.status === "light").length;

  // Average lock % (only for subnets with locks and pool data)
  const withPct = scored.filter((s) => s.hasLock && s.alphaTotal > 0);
  const avgLockPct = withPct.length > 0
    ? withPct.reduce((sum, s) => sum + s.lockPct, 0) / withPct.length
    : 0;

  // Challenger stats
  let challengerCount = 0;
  let totalChallengerLocked = 0;
  for (const s of scored) {
    if (s.challengers && s.challengers.length > 0) {
      challengerCount += s.challengers.length;
      totalChallengerLocked += s.challengers.reduce((sum, c) => sum + c.locked_mass, 0);
    }
  }

  return {
    totalWithLock,
    totalLocked,
    noLock,
    heavy,
    moderate,
    light,
    avgLockPct,
    challengerCount,
    totalChallengerLocked,
    totalSubnets: scored.length,
  };
}
