// Conviction Locks Scoring — Lock % of pool classification + summary stats
// Post Conviction v2: every subnet has a lock, so we measure lock as % of total subnet alpha

import { HEAVY_PCT, MODERATE_PCT, LIGHT_PCT, STRONG_THRESHOLD, BUILDING_MIN, GATE_THRESHOLD } from "./constants.js";
import { annotateEmissionPerCap } from "../lib/emissionPerCap.js";

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
 * Categorize hotkey locks into buckets relative to owner hotkey.
 * Returns { owner, toOwner, challenger, gate, daysToKing, ownerSideConviction, ownerSideLockedMass, hasOwnerHotkey }
 */
export function categorizeBuckets(entry) {
  const ownerHotkey = entry.ownerHotkey;
  const ownerConviction = entry.conviction || 0;
  const ownerLockedMass = entry.locked_mass || 0;

  // Owner bucket — from OwnerLock storage directly
  const owner = {
    locked_mass: ownerLockedMass,
    conviction: ownerConviction,
  };

  // Split hotkey locks by whether they target the owner's hotkey
  let toOwnerLocks = [];
  let challengerLocks = [];

  if (ownerHotkey) {
    for (const ch of (entry.challengers || [])) {
      if (ch.hotkey && ch.hotkey.toLowerCase() === ownerHotkey.toLowerCase()) {
        toOwnerLocks.push(ch);
      } else {
        challengerLocks.push(ch);
      }
    }
  } else {
    // No owner hotkey data — all go to challenger (backward compatible)
    challengerLocks = entry.challengers || [];
  }

  const toOwner = {
    locked_mass: toOwnerLocks.reduce((s, c) => s + c.locked_mass, 0),
    conviction: toOwnerLocks.reduce((s, c) => s + c.conviction, 0),
    locks: toOwnerLocks,
  };

  const challenger = {
    locked_mass: challengerLocks.reduce((s, c) => s + c.locked_mass, 0),
    conviction: challengerLocks.reduce((s, c) => s + c.conviction, 0),
    locks: challengerLocks,
  };

  // Owner-side totals = owner + supporters
  const ownerSideConviction = ownerConviction + toOwner.conviction;
  const ownerSideLockedMass = ownerLockedMass + toOwner.locked_mass;

  // 10% Gate check
  const alphaTotal = entry.alphaTotal || 0;
  const gate = alphaTotal > 0
    ? ownerSideConviction >= (alphaTotal * GATE_THRESHOLD)
    : null;

  // Days-to-King estimate
  let daysToKing = null;
  if (challengerLocks.length > 0 && ownerSideConviction > 0) {
    const topChallenger = challengerLocks.reduce((best, c) =>
      c.conviction > best.conviction ? c : best, challengerLocks[0]);

    if (topChallenger.conviction >= ownerSideConviction) {
      daysToKing = 0; // already overtaken
    } else if (topChallenger.conviction > 0 && topChallenger.locked_mass > 0) {
      const gap = ownerSideConviction - topChallenger.conviction;
      const remaining = topChallenger.locked_mass - topChallenger.conviction;

      if (remaining > gap) {
        // Growth rate: locked_mass * ln(2) / 90 * (1 - conviction/locked_mass)
        const ratio = topChallenger.conviction / topChallenger.locked_mass;
        const rate = topChallenger.locked_mass * Math.LN2 / 90 * (1 - ratio);
        if (rate > 0) {
          daysToKing = Math.ceil(gap / rate);
          if (daysToKing > 9999) daysToKing = null;
        }
      }
    }
  }

  return {
    owner,
    toOwner,
    challenger,
    gate,
    daysToKing,
    ownerSideConviction,
    ownerSideLockedMass,
    hasOwnerHotkey: !!ownerHotkey,
  };
}

/**
 * Process raw conviction data into scored/classified entries
 */
export function scoreConviction(convictionData, poolData, subnetMeta, subnetsRaw = [], taoUsdPrice = null) {
  if (!convictionData?.results) return [];

  // Build pool lookup
  const poolMap = {};
  const poolArr = Array.isArray(poolData) ? poolData : (poolData?.data || []);
  poolArr.forEach((p) => {
    const id = p.netuid ?? p.subnet_id;
    if (id != null) poolMap[id] = p;
  });

  // Build subnet lookup — needed for emission-per-cap (not otherwise used
  // by this tab, whose focus is lock/ownership, not emission).
  const subnetMap = {};
  const subnetArr = Array.isArray(subnetsRaw) ? subnetsRaw : (subnetsRaw?.data || []);
  subnetArr.forEach((s) => {
    const id = s.netuid ?? s.subnet_id;
    if (id != null) subnetMap[id] = s;
  });
  const totalRealEmission = subnetArr.reduce((sum, s) => sum + num(s.emission), 0);

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

    // Categorize into Owner / To-Owner / Challenger buckets
    const withChallengers = { ...enriched, challengers: scoredChallengers };
    const buckets = categorizeBuckets(withChallengers);

    const subnet = subnetMap[entry.netuid] || null;
    const epc = subnet ? annotateEmissionPerCap(subnet, pool, totalRealEmission, taoUsdPrice) : {};

    return {
      ...withChallengers,
      lockPct,
      status,
      buckets,
      emissionPerCap: epc.emissionPerCap ?? null,
      epcTier: epc.epcTier ?? "normal",
      si: epc.si ?? null,
      change1M: epc.change1M ?? null,
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

  // Bucket-level aggregates
  let gatePassCount = 0;
  let gateTotalChecked = 0;
  let subnetsWithChallengers = 0;

  for (const s of scored) {
    if (s.buckets) {
      if (s.buckets.gate !== null) {
        gateTotalChecked++;
        if (s.buckets.gate) gatePassCount++;
      }
      if (s.buckets.challenger?.locks?.length > 0) {
        subnetsWithChallengers++;
      }
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
    gatePassCount,
    gateTotalChecked,
    subnetsWithChallengers,
  };
}
