// Conviction Locks Scoring — Lock status classification + summary stats

import { STRONG_THRESHOLD, BUILDING_MIN } from "./constants.js";

/**
 * Classify lock status for a single subnet
 * Returns: "strong" | "building" | "zero" | "nolock" | "error"
 */
export function classifyLockStatus(entry) {
  if (entry.rpcError) return "error";
  if (!entry.hasLock) return "nolock";
  if (entry.locked_mass <= 0) return "nolock";

  if (entry.conviction <= 0) return "zero";

  const ratio = entry.conviction / entry.locked_mass;
  if (ratio >= STRONG_THRESHOLD) return "strong";
  if (ratio >= BUILDING_MIN) return "building";
  return "zero";
}

/**
 * Classify lock status for a challenger hotkey lock
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
 * Get conviction ratio (0-1) for display
 */
export function getConvictionRatio(entry) {
  if (!entry.hasLock || entry.locked_mass <= 0) return 0;
  if (entry.conviction <= 0) return 0;
  return Math.min(entry.conviction / entry.locked_mass, 1);
}

/**
 * Process raw conviction data into scored/classified entries
 */
export function scoreConviction(convictionData, poolData, subnetMeta) {
  if (!convictionData?.results) return [];

  // Build pool name lookup
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

    const status = classifyLockStatus(entry);
    const ratio = getConvictionRatio(entry);

    // Score challenger locks for this subnet
    const scoredChallengers = (entry.challengers || []).map((c) => ({
      ...c,
      status: classifyChallengerStatus(c),
      ratio: c.locked_mass > 0 && c.conviction > 0
        ? Math.min(c.conviction / c.locked_mass, 1)
        : 0,
    }));

    return {
      ...entry,
      name,
      status,
      ratio,
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
  const zeroConviction = scored.filter((s) => s.status === "zero").length;
  const noLock = scored.filter((s) => s.status === "nolock").length;
  const strong = scored.filter((s) => s.status === "strong").length;
  const building = scored.filter((s) => s.status === "building").length;

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
    zeroConviction,
    noLock,
    strong,
    building,
    challengerCount,
    totalChallengerLocked,
    totalSubnets: scored.length,
  };
}
