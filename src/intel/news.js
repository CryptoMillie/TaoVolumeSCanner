// Intel News Engine — Rule-based move summaries (no external API needed)

import { SPIKE_THRESHOLD_PCT, MIN_VOLUME_USD } from "./constants.js";

function num(v) {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

/**
 * Detect volume spikes by comparing current vs previous scan volumes.
 * Returns array of alert objects for subnets with >SPIKE_THRESHOLD_PCT increase.
 */
export function detectSpikes(currentData, previousVolumes) {
  if (!previousVolumes || Object.keys(previousVolumes).length === 0) return [];

  const alerts = [];
  currentData.forEach(item => {
    const prev = previousVolumes[item.id || item.symbol];
    if (!prev || prev < MIN_VOLUME_USD) return;
    const current = item.total_volume || 0;
    if (current < MIN_VOLUME_USD) return;

    const pctChange = ((current - prev) / prev) * 100;
    if (pctChange >= SPIKE_THRESHOLD_PCT) {
      alerts.push({
        id: item.id || item.symbol,
        name: item.name,
        symbol: item.symbol,
        volume: current,
        prevVolume: prev,
        spikePct: pctChange,
        priceChange24h: item.price_change_percentage_24h || 0,
        price: item.current_price || 0,
        direction: (item.price_change_percentage_24h || 0) >= 0 ? "up" : "down",
        timestamp: new Date().toLocaleTimeString(),
      });
    }
  });

  return alerts.sort((a, b) => b.spikePct - a.spikePct);
}

/**
 * Generate a short paragraph summary explaining why a subnet is moving.
 * Uses on-chain data signals — no external AI API needed.
 */
export function generateMoveSummary(name, cgData, pool) {
  const priceChange = num(cgData?.price_change_percentage_24h);
  const volume = num(cgData?.total_volume);
  const marketCap = num(cgData?.market_cap) || num(cgData?.fully_diluted_valuation) || 1;
  const volMcRatio = (volume / marketCap) * 100;
  const netFlow7 = pool ? num(pool.net_flow_7_days) : 0;
  const alphaStaked = pool ? num(pool.alpha_staked) : 0;
  const alphaInPool = pool ? num(pool.alpha_in_pool) : 0;
  const alphaTotal = alphaStaked + alphaInPool;
  const stakingRatio = alphaTotal > 0 ? alphaStaked / alphaTotal : 0;
  const totalTao = pool ? num(pool.total_tao) : 0;
  const buys = pool ? num(pool.buys_24_hr) : 0;
  const sells = pool ? num(pool.sells_24_hr) : 0;
  const buyPressure = (buys + sells) > 0 ? buys / (buys + sells) : 0.5;

  const direction = priceChange >= 0 ? "up" : "down";
  const magnitude = Math.abs(priceChange);
  const parts = [];

  // Main thesis based on direction + volume
  if (direction === "up" && volMcRatio > 20) {
    parts.push(`Heavy accumulation detected — ${name} seeing ${volMcRatio.toFixed(0)}% volume-to-market-cap ratio with ${magnitude.toFixed(1)}% price appreciation.`);
  } else if (direction === "up" && volMcRatio > 5) {
    parts.push(`Buying momentum building — ${name} up ${magnitude.toFixed(1)}% on elevated volume (${volMcRatio.toFixed(1)}% Vol/MC).`);
  } else if (direction === "down" && volMcRatio > 20) {
    parts.push(`Distribution event underway — ${name} dropping ${magnitude.toFixed(1)}% on extreme volume (${volMcRatio.toFixed(0)}% Vol/MC). Likely large holder exit.`);
  } else if (direction === "down" && volMcRatio > 5) {
    parts.push(`Sell pressure emerging — ${name} down ${magnitude.toFixed(1)}% with ${volMcRatio.toFixed(1)}% volume ratio signaling active distribution.`);
  } else if (direction === "up") {
    parts.push(`${name} grinding higher +${magnitude.toFixed(1)}% on moderate volume.`);
  } else {
    parts.push(`${name} drifting lower -${magnitude.toFixed(1)}% on thin activity.`);
  }

  // Supporting signals
  if (netFlow7 > 0 && direction === "up") {
    parts.push(`Capital inflows confirm the move — net +${netFlow7.toFixed(0)} TAO over 7 days.`);
  } else if (netFlow7 < 0 && direction === "down") {
    parts.push(`Capital outflows accelerating — net ${netFlow7.toFixed(0)} TAO lost over 7 days.`);
  } else if (netFlow7 > 0 && direction === "down") {
    parts.push(`Despite price decline, net capital still flowing in (+${netFlow7.toFixed(0)} TAO/7d) — potential accumulation by informed participants.`);
  }

  if (stakingRatio > 0.7) {
    parts.push(`Strong conviction: ${(stakingRatio * 100).toFixed(0)}% of supply staked, reducing circulating pressure.`);
  } else if (stakingRatio < 0.2 && alphaTotal > 0) {
    parts.push(`Low staking ratio (${(stakingRatio * 100).toFixed(0)}%) — holders not locked in, susceptible to further selling.`);
  }

  if (totalTao < 500 && volume > 5000) {
    parts.push(`Thin liquidity (${totalTao.toFixed(0)} TAO in pool) amplifying price moves — expect outsized volatility.`);
  }

  if (buyPressure > 0.7 && direction === "up") {
    parts.push(`Buy-side dominant: ${(buyPressure * 100).toFixed(0)}% of 24h trades are buys.`);
  } else if (buyPressure < 0.3 && direction === "down") {
    parts.push(`Sell-side dominant: ${((1 - buyPressure) * 100).toFixed(0)}% of 24h trades are sells.`);
  }

  return parts.slice(0, 3).join(" ");
}

/**
 * Get top movers from CoinGecko data, sorted by absolute price change.
 */
export function getTopMovers(cgData, pools, count = 10) {
  const poolMap = {};
  const poolArr = Array.isArray(pools) ? pools : (pools?.data || []);
  poolArr.forEach(p => {
    const sym = p.symbol?.toLowerCase();
    if (sym) poolMap[sym] = p;
    const name = p.name?.toLowerCase();
    if (name) poolMap[name] = p;
  });

  return cgData
    .filter(s => s.total_volume > MIN_VOLUME_USD && Math.abs(s.price_change_percentage_24h || 0) > 2)
    .sort((a, b) => Math.abs(b.price_change_percentage_24h || 0) - Math.abs(a.price_change_percentage_24h || 0))
    .slice(0, count)
    .map(s => {
      const pool = poolMap[s.symbol] || poolMap[s.name?.toLowerCase()] || null;
      return {
        ...s,
        pool,
        summary: generateMoveSummary(s.name, s, pool),
        direction: (s.price_change_percentage_24h || 0) >= 0 ? "up" : "down",
      };
    });
}
