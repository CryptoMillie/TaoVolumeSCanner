// Burn Scanner Scoring — Uses incentive_burn (miner_burn) rate + recycled fields from subnet data
// Post v3.4.6: emission_share = price × root_prop × (1 − miner_burn)
// Burning miner emission now directly reduces chain-level emission, not just internal alpha.

import {
  BLOCKS_PER_DAY,
  HISTORY_DAYS,
  HEAVY_BURN_PCT,
  MODERATE_BURN_PCT,
  LIGHT_BURN_PCT,
} from "./constants.js";

/**
 * Classify burn status based on incentive_burn rate (the primary burn signal).
 */
export function classifyBurnStatus(incentiveBurn, recycledLifetime) {
  if (incentiveBurn >= HEAVY_BURN_PCT) return "heavy";
  if (incentiveBurn >= MODERATE_BURN_PCT) return "moderate";
  if (incentiveBurn >= LIGHT_BURN_PCT) return "light";
  // If they have recycled alpha but low/zero incentive burn
  if (recycledLifetime > 0 && incentiveBurn > 0) return "light";
  if (incentiveBurn <= 0 && recycledLifetime <= 0) return "noburn";
  return "minimal";
}

/**
 * Detect manual burn signal.
 *
 * Manual burn = recycled alpha that can't be explained by incentive_burn alone.
 * Only uses recycled_24h (active burning) — recycled_lifetime includes registration
 * burns and protocol-level recycling which aren't manual owner burns.
 *
 * CONFIRMED: 0% incentive burn AND actively burning in last 24h
 * LIKELY: recycled_24h exceeds expected daily from incentive by 2x+
 */
function detectManualBurn(row) {
  const { incentiveBurn, recycled24h, burnPerDay } = row;

  // Must have meaningful 24h burn activity to qualify (>= 0.1 alpha, filters out dust)
  if (recycled24h < 0.1) {
    return { manualSignal: "none", manualAmount24h: 0, manualAmountLifetime: 0, excess24h: 0 };
  }

  // Case 1: Zero incentive burn rate but actively burning in 24h → confirmed manual
  if (incentiveBurn <= 0 && recycled24h >= 0.1) {
    return {
      manualSignal: "confirmed",
      manualAmount24h: recycled24h,
      manualAmountLifetime: 0,
      excess24h: recycled24h,
    };
  }

  // Case 2: Has incentive burn — compare actual 24h recycled vs expected from rate
  const expectedDaily = burnPerDay;
  const excess24h = Math.max(0, recycled24h - expectedDaily);

  // Only flag if excess is at least 2x the expected daily (significant manual activity)
  if (expectedDaily > 0 && excess24h > expectedDaily * 2) {
    return {
      manualSignal: "likely",
      manualAmount24h: excess24h,
      manualAmountLifetime: 0,
      excess24h,
    };
  }

  return { manualSignal: "none", manualAmount24h: 0, manualAmountLifetime: 0, excess24h: 0 };
}

/**
 * Full scoring: compute burn metrics from subnet latest data + pool data.
 */
export function scoreBurns(subnets, pools, meta) {
  const subnetArr = Array.isArray(subnets) ? subnets : (subnets?.data || []);
  const poolArr = Array.isArray(pools) ? pools : (pools?.data || []);

  // Build pool lookup
  const poolMap = {};
  poolArr.forEach((p) => {
    const id = p.netuid ?? p.subnet_id;
    if (id != null) poolMap[id] = p;
  });

  const rows = [];
  const now = Date.now();

  for (const s of subnetArr) {
    const netuid = s.netuid ?? s.subnet_id;
    const emission = parseFloat(s.emission) || 0;
    const emissionPerBlock = emission / 1e9;

    // Skip root network (netuid 0) only
    if (netuid === 0) continue;

    const pool = poolMap[netuid];
    const m = meta?.[String(netuid)] || null;

    // Name resolution
    const name =
      pool?.name && pool.name !== "Unknown"
        ? pool.name
        : m?.name
          ? m.name
          : s.name
            ? s.name
            : `Subnet ${netuid}`;

    // Pool price for TAO value calculation
    const price = pool ? parseFloat(pool.price || pool.alpha_price || 0) : 0;

    // Core burn fields from subnet latest
    const incentiveBurn = parseFloat(s.incentive_burn || 0);
    const recycledLifetime = parseFloat(s.recycled_lifetime || 0) / 1e9; // rao -> alpha
    const recycled24h = parseFloat(s.recycled_24_hours || 0) / 1e9;

    // --- 3-tier 30d burn estimation ---
    // Tier 1: emission-based projection (instantaneous rate * 30d)
    const burnPerBlock = emissionPerBlock * incentiveBurn;
    const burnPerDay = burnPerBlock * BLOCKS_PER_DAY;
    const emissionEst30d = burnPerDay * HISTORY_DAYS;

    // Tier 2: extrapolate recent 24h activity over 30d
    const recycled24hEst30d = recycled24h * HISTORY_DAYS;

    // Tier 3: historical daily average from lifetime recycled / subnet age
    let historicalEst30d = 0;
    const regTs = s.registration_timestamp;
    if (recycledLifetime > 0 && regTs) {
      const ageMs = now - new Date(regTs).getTime();
      const ageInDays = ageMs / (1000 * 86400);
      if (ageInDays > 1) {
        historicalEst30d = (recycledLifetime / ageInDays) * HISTORY_DAYS;
      }
    }

    // Use the best available estimate (highest signal wins)
    const estimated30dBurn = Math.max(emissionEst30d, recycled24hEst30d, historicalEst30d);

    // Track which estimation method was used
    let estimateSource = "none";
    if (estimated30dBurn > 0) {
      if (estimated30dBurn === emissionEst30d) estimateSource = "emission";
      else if (estimated30dBurn === recycled24hEst30d) estimateSource = "recent";
      else estimateSource = "historical";
    }

    // Expected total emission over 30d
    const expected30d = emissionPerBlock * BLOCKS_PER_DAY * HISTORY_DAYS;

    // TAO value of estimated 30d burn
    const taoValue30d = estimated30dBurn * price;

    // TAO value of lifetime recycled
    const taoValueLifetime = recycledLifetime * price;

    // Status classification based on incentive_burn rate
    const status = classifyBurnStatus(incentiveBurn, recycledLifetime);

    // Chain emission penalty: (1 - miner_burn) — under v3.4.6, burning miner
    // emission now directly reduces the subnet's share of chain-level emission.
    // emissionRetention = 1.0 means full emission; 0.0 means zero emission.
    const emissionRetention = 1 - incentiveBurn;

    const row = {
      netuid,
      name,
      incentiveBurn,
      emissionRetention,
      recycledLifetime,
      recycled24h,
      estimated30dBurn,
      estimateSource,
      expected30d,
      burnPerDay,
      taoValue30d,
      taoValueLifetime,
      status,
      price,
      emissionPerBlock,
      emission,
      hasData: true,
    };

    // Detect manual burn signal
    const manual = detectManualBurn(row);
    row.manualSignal = manual.manualSignal;
    row.manualAmount24h = manual.manualAmount24h;
    row.manualAmountLifetime = manual.manualAmountLifetime;
    row.excess24h = manual.excess24h;

    rows.push(row);
  }

  return rows;
}

/**
 * Aggregate summary statistics from scored rows.
 */
export function computeBurnSummary(scored) {
  let heavy = 0, moderate = 0, light = 0, minimal = 0, noburn = 0;
  let totalRecycledLifetime = 0, totalRecycledTaoValue = 0;
  let totalEst30dBurn = 0, totalEst30dTaoValue = 0;
  let incentiveSum = 0, incentiveCount = 0;
  let withBurn = 0;
  let manualConfirmed = 0, manualLikely = 0;

  for (const row of scored) {
    switch (row.status) {
      case "heavy": heavy++; break;
      case "moderate": moderate++; break;
      case "light": light++; break;
      case "minimal": minimal++; break;
      case "noburn": noburn++; break;
      default: noburn++; break;
    }

    totalRecycledLifetime += row.recycledLifetime;
    totalRecycledTaoValue += row.taoValueLifetime;
    totalEst30dBurn += row.estimated30dBurn;
    totalEst30dTaoValue += row.taoValue30d;

    if (row.incentiveBurn > 0) {
      incentiveSum += row.incentiveBurn;
      incentiveCount++;
      withBurn++;
    }

    if (row.manualSignal === "confirmed") manualConfirmed++;
    else if (row.manualSignal === "likely") manualLikely++;
  }

  return {
    heavy,
    moderate,
    light,
    minimal,
    noburn,
    totalRecycledLifetime,
    totalRecycledTaoValue,
    totalEst30dBurn,
    totalEst30dTaoValue,
    avgIncentiveBurn: incentiveCount > 0 ? incentiveSum / incentiveCount : 0,
    withBurn,
    manualConfirmed,
    manualLikely,
    total: scored.length,
  };
}
