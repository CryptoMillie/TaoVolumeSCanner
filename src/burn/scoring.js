// Burn Scanner Scoring — Derive burns from pool history vs expected emission

import {
  BLOCKS_PER_DAY,
  HISTORY_DAYS,
  HEAVY_BURN_PCT,
  MODERATE_BURN_PCT,
  LIGHT_BURN_PCT,
} from "./constants.js";

/**
 * Compute burn metrics for a single subnet from its pool history.
 * @param {Array} historyArray — snapshots from pool/history endpoint
 * @param {number} emissionPerBlock — alpha emission per block (already divided by 1e9)
 * @returns {object} burn metrics
 */
export function computeSubnetBurn(historyArray, emissionPerBlock) {
  if (!historyArray || historyArray.length < 2 || emissionPerBlock <= 0) {
    return null;
  }

  // Sort by timestamp ascending
  const sorted = [...historyArray].sort(
    (a, b) => new Date(a.timestamp || a.created_at).getTime() - new Date(b.timestamp || b.created_at).getTime()
  );

  const oldest = sorted[0];
  const latest = sorted[sorted.length - 1];

  // Calculate days of data
  const oldestTime = new Date(oldest.timestamp || oldest.created_at).getTime();
  const latestTime = new Date(latest.timestamp || latest.created_at).getTime();
  const daysOfData = Math.max(1, (latestTime - oldestTime) / (1000 * 60 * 60 * 24));
  const cappedDays = Math.min(daysOfData, HISTORY_DAYS);

  // Expected emission over the period
  const expected30d = emissionPerBlock * BLOCKS_PER_DAY * cappedDays;

  // Actual change in total alpha
  const oldestAlpha = parseFloat(oldest.total_alpha || oldest.alpha_in_pool || 0) / 1e9;
  const latestAlpha = parseFloat(latest.total_alpha || latest.alpha_in_pool || 0) / 1e9;
  const actualChange = latestAlpha - oldestAlpha;

  // Derived burn = expected - actual (if positive, alpha was removed)
  const derivedBurn = Math.max(0, expected30d - actualChange);

  // Burn percentage relative to expected emission
  const burnPct = expected30d > 0 ? derivedBurn / expected30d : 0;

  // Count burn days (day-over-day where actual < expected daily)
  const expectedDaily = emissionPerBlock * BLOCKS_PER_DAY;
  let burnDays = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prevAlpha = parseFloat(sorted[i - 1].total_alpha || sorted[i - 1].alpha_in_pool || 0) / 1e9;
    const currAlpha = parseFloat(sorted[i].total_alpha || sorted[i].alpha_in_pool || 0) / 1e9;
    const dayChange = currAlpha - prevAlpha;
    if (dayChange < expectedDaily * 0.9) {
      burnDays++;
    }
  }

  // Daily burn rate
  const dailyRate = cappedDays > 0 ? derivedBurn / cappedDays : 0;

  return {
    derivedBurn,
    burnPct,
    burnDays,
    expected30d,
    actualChange,
    daysOfData: cappedDays,
    dataPoints: sorted.length,
    dailyRate,
    emissionPerBlock,
  };
}

/**
 * Classify burn status from burn percentage.
 */
export function classifyBurnStatus(burnPct) {
  if (burnPct == null || isNaN(burnPct)) return "nodata";
  if (burnPct >= HEAVY_BURN_PCT) return "heavy";
  if (burnPct >= MODERATE_BURN_PCT) return "moderate";
  if (burnPct >= LIGHT_BURN_PCT) return "light";
  return "minimal";
}

/**
 * Full scoring: combine pool history with subnet/pool data.
 * @param {object} historyMap — netuid -> historyArray
 * @param {Array|object} subnets — subnet latest data
 * @param {Array|object} pools — pool latest data
 * @param {object} meta — subnet metadata
 * @returns {Array} scored rows
 */
export function scoreBurns(historyMap, subnets, pools, meta) {
  const subnetArr = Array.isArray(subnets) ? subnets : (subnets?.data || []);
  const poolArr = Array.isArray(pools) ? pools : (pools?.data || []);

  // Build pool lookup
  const poolMap = {};
  poolArr.forEach((p) => {
    const id = p.netuid ?? p.subnet_id;
    if (id != null) poolMap[id] = p;
  });

  // Build subnet lookup
  const subnetMap = {};
  subnetArr.forEach((s) => {
    const id = s.netuid ?? s.subnet_id;
    if (id != null) subnetMap[id] = s;
  });

  const rows = [];

  for (const s of subnetArr) {
    const netuid = s.netuid ?? s.subnet_id;
    const emission = parseFloat(s.emission) || 0;
    const emissionPerBlock = emission / 1e9;

    // Skip zero-emission subnets
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

    // Incentive burn from subnet data
    const incentiveBurn = parseFloat(s.incentive_burn || 0);

    // Compute burn from history
    const history = historyMap?.[netuid];
    const burnMetrics = computeSubnetBurn(history, emissionPerBlock);

    const derivedBurn = burnMetrics?.derivedBurn || 0;
    const burnPct = burnMetrics?.burnPct || 0;
    const burnDays = burnMetrics?.burnDays || 0;
    const taoValue = derivedBurn * price;

    const status = burnMetrics ? classifyBurnStatus(burnPct) : "nodata";

    rows.push({
      netuid,
      name,
      derivedBurn,
      burnPct,
      burnDays,
      incentiveBurn,
      taoValue,
      status,
      price,
      emissionPerBlock,
      expected30d: burnMetrics?.expected30d || 0,
      actualChange: burnMetrics?.actualChange || 0,
      daysOfData: burnMetrics?.daysOfData || 0,
      dataPoints: burnMetrics?.dataPoints || 0,
      dailyRate: burnMetrics?.dailyRate || 0,
      hasData: !!burnMetrics,
    });
  }

  return rows;
}

/**
 * Aggregate summary statistics from scored rows.
 */
export function computeBurnSummary(scored) {
  let heavy = 0, moderate = 0, light = 0, minimal = 0, nodata = 0;
  let totalBurned = 0, totalTaoValue = 0;
  let burnPctSum = 0, burnPctCount = 0;
  let incentiveSum = 0, incentiveCount = 0;
  let withData = 0;

  for (const row of scored) {
    switch (row.status) {
      case "heavy": heavy++; break;
      case "moderate": moderate++; break;
      case "light": light++; break;
      case "minimal": minimal++; break;
      default: nodata++; break;
    }

    if (row.hasData) {
      withData++;
      totalBurned += row.derivedBurn;
      totalTaoValue += row.taoValue;
      burnPctSum += row.burnPct;
      burnPctCount++;
    }

    if (row.incentiveBurn > 0) {
      incentiveSum += row.incentiveBurn;
      incentiveCount++;
    }
  }

  return {
    heavy,
    moderate,
    light,
    minimal,
    nodata,
    totalBurned,
    totalTaoValue,
    avgBurnPct: burnPctCount > 0 ? burnPctSum / burnPctCount : 0,
    avgIncentiveBurn: incentiveCount > 0 ? incentiveSum / incentiveCount : 0,
    withData,
    total: scored.length,
  };
}
