// Burn Scanner Scoring — Uses incentive_burn rate + recycled fields from subnet data

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
  // If they have recycled alpha but low incentive burn, still light
  if (recycledLifetime > 0 && incentiveBurn > 0) return "light";
  if (recycledLifetime > 0) return "minimal";
  return "minimal";
}

/**
 * Full scoring: compute burn metrics from subnet latest data + pool data.
 * No pool history needed — uses incentive_burn, recycled_lifetime, recycled_24h.
 *
 * @param {Array|object} subnets — subnet latest data
 * @param {Array|object} pools — pool latest data
 * @param {object} meta — subnet metadata
 * @returns {Array} scored rows
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

  for (const s of subnetArr) {
    const netuid = s.netuid ?? s.subnet_id;
    const emission = parseFloat(s.emission) || 0;
    const emissionPerBlock = emission / 1e9;

    // Skip zero-emission subnets (root network etc.)
    if (emissionPerBlock <= 0) continue;

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

    // Estimated burn rate: emission * incentive_burn = alpha burned per block
    const burnPerBlock = emissionPerBlock * incentiveBurn;
    const burnPerDay = burnPerBlock * BLOCKS_PER_DAY;
    const estimated30dBurn = burnPerDay * HISTORY_DAYS;

    // Expected total emission over 30d
    const expected30d = emissionPerBlock * BLOCKS_PER_DAY * HISTORY_DAYS;

    // TAO value of estimated 30d burn
    const taoValue30d = estimated30dBurn * price;

    // TAO value of lifetime recycled
    const taoValueLifetime = recycledLifetime * price;

    // Status classification based on incentive_burn rate
    const status = classifyBurnStatus(incentiveBurn, recycledLifetime);

    rows.push({
      netuid,
      name,
      incentiveBurn,
      recycledLifetime,
      recycled24h,
      estimated30dBurn,
      expected30d,
      burnPerDay,
      taoValue30d,
      taoValueLifetime,
      status,
      price,
      emissionPerBlock,
      emission,
      hasData: true,
    });
  }

  return rows;
}

/**
 * Aggregate summary statistics from scored rows.
 */
export function computeBurnSummary(scored) {
  let heavy = 0, moderate = 0, light = 0, minimal = 0, nodata = 0;
  let totalRecycledLifetime = 0, totalRecycledTaoValue = 0;
  let totalEst30dBurn = 0, totalEst30dTaoValue = 0;
  let incentiveSum = 0, incentiveCount = 0;
  let withBurn = 0;

  for (const row of scored) {
    switch (row.status) {
      case "heavy": heavy++; break;
      case "moderate": moderate++; break;
      case "light": light++; break;
      case "minimal": minimal++; break;
      default: nodata++; break;
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
  }

  return {
    heavy,
    moderate,
    light,
    minimal,
    nodata,
    totalRecycledLifetime,
    totalRecycledTaoValue,
    totalEst30dBurn,
    totalEst30dTaoValue,
    avgIncentiveBurn: incentiveCount > 0 ? incentiveSum / incentiveCount : 0,
    withBurn,
    total: scored.length,
  };
}
