// Emission-per-cap — a derived signal that doesn't exist on taostats.io.
// taostats shows emission share and market cap as separate sortable
// columns and never divides them. Under v440 the gate reads price and
// ignores supply: two subnets at the same price sit at the same point on
// the gate and earn similar emission share regardless of outstanding
// alpha, but the same emission inflow moves price much further in a
// smaller pool. This module is the shared source of truth for that ratio,
// its disambiguation (genuine opportunity vs falling-knife), and the unit
// conversion needed to get a real USD market cap out of taostats' pool
// data. Added 2026-07-29 after reviewing live taostats data on 2026-07-28.

// Ratio above which a subnet is "elevated" enough to need disambiguating.
// Confirmed against live data: most subnets cluster 0.12-0.23, with a
// 3-5x gap up to a handful of outliers at 0.63-0.73.
export const HIGH = 0.4;

/**
 * emissionPerCap = emissionSharePct / marketCapUsdMillions.
 * Both inputs must already be in matching units (share as a 0-100 percent,
 * cap in millions of USD) — see poolMarketCapUsdMillions() for the cap
 * conversion. Returns null if cap is non-positive (can't divide by it).
 */
export function computeEmissionPerCap(emissionSharePct, marketCapUsdMillions) {
  if (marketCapUsdMillions == null || marketCapUsdMillions <= 0) return null;
  if (emissionSharePct == null) return null;
  return emissionSharePct / marketCapUsdMillions;
}

/**
 * taostats' pool.market_cap is TAO-denominated at rao scale (1e9 per TAO),
 * not USD. Confirmed empirically against a live subnet: market_cap / 1e9
 * (raw -> TAO) x TAO/USD spot price landed within ~3.5% of a same-day
 * reference market cap. There is no USD field in the free API — the TAO/USD
 * spot price has to be fetched separately (see DataContext.jsx
 * `taoUsdPrice`, sourced from CoinGecko's free `bittensor` price).
 */
export function poolMarketCapUsdMillions(marketCapRaw, taoUsdPrice) {
  if (marketCapRaw == null || taoUsdPrice == null || taoUsdPrice <= 0) return null;
  const tao = marketCapRaw / 1e9;
  return (tao * taoUsdPrice) / 1e6;
}

/**
 * Disambiguates a high emissionPerCap reading: a small cap can mean a
 * genuinely young, undervalued subnet (opportunity) or a subnet whose price
 * collapsed and dragged cap down with it (the ratio rising mechanically as
 * it dies). si = sentiment index (0-100, taostats fear_and_greed_index —
 * Fear 0-40 / Neutral 40-60 / Greed 61-80 / Euphoria 80-100).
 * change1M = 1-month price change, as a percent (e.g. 45.4, not 0.454).
 *
 * Returns one of:
 *   "normal"   - ratio <= HIGH, nothing to disambiguate
 *   "healthy"  - ratio > HIGH, si >= 60, change1M > 0 — cheap and rising
 *   "suspect"  - ratio > HIGH, si < 55 OR change1M < -25 — falling knife
 *   "elevated" - ratio > HIGH but neither condition clearly fires — flagged
 *                as worth a look, not classified either way
 *
 * Never filters — the brief is explicit that suspect rows must stay visible
 * (flagged, not hidden) since they're informative about why the screen
 * fired.
 */
export function classifyEmissionPerCap({ ratio, si, change1M }) {
  if (ratio == null || ratio <= HIGH) return "normal";
  const healthy = si != null && change1M != null && si >= 60 && change1M > 0;
  if (healthy) return "healthy";
  const suspect = (si != null && si < 55) || (change1M != null && change1M < -25);
  if (suspect) return "suspect";
  return "elevated";
}

function num(v) {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

/**
 * One-call convenience for the per-tab rollout: takes a subnet + pool record
 * (taostats' native shapes) plus the real (not gated) total network
 * emission and the current TAO/USD price, and returns everything a table
 * column needs. Uses the REAL on-chain emission share as the numerator —
 * the number taostats itself would show — not the client-computed gated
 * share used elsewhere in this app for ranking/scoring purposes. Those are
 * a different concern (see NOTES.md); this is a screen for a mispricing
 * taostats doesn't compute at all, not a re-derivation of the gate.
 */
export function annotateEmissionPerCap(subnet, pool, totalEmission, taoUsdPrice) {
  const emission = num(subnet?.emission);
  const emissionSharePct = totalEmission > 0 ? (emission / totalEmission) * 100 : 0;
  const marketCapUsdMillions = pool ? poolMarketCapUsdMillions(num(pool.market_cap), taoUsdPrice) : null;
  const si = pool && pool.fear_and_greed_index != null ? num(pool.fear_and_greed_index) : null;
  const change1M = pool && pool.price_change_1_month != null ? num(pool.price_change_1_month) : null;
  const emissionPerCap = computeEmissionPerCap(emissionSharePct, marketCapUsdMillions);
  const epcTier = classifyEmissionPerCap({ ratio: emissionPerCap, si, change1M });
  return { emissionSharePct, marketCapUsdMillions, si, change1M, emissionPerCap, epcTier };
}

/**
 * Trend classification comparing current emissionPerCap/price position to a
 * past snapshot (see src/bar/thetaHistory.js `getPastEmissionPerCap`).
 * High emission -> fast alpha issuance -> grows the subnet's own market cap
 * -> decays the ratio back toward the pack, so the level alone goes stale;
 * only the combination with price direction tells you which regime you're in.
 *   "rising-with-price"   - ratio rising AND price rising: strongest signal
 *   "rising-against-price"- ratio rising but price falling: the trap, firing mechanically
 *   "falling"             - ratio falling (decaying back toward the pack)
 *   "unknown"             - not enough history yet
 */
export function classifyEmissionPerCapTrend({ pastRatio, currentRatio, priceChangePct }) {
  if (pastRatio == null || currentRatio == null) return "unknown";
  const ratioRising = currentRatio > pastRatio;
  if (!ratioRising) return "falling";
  if (priceChangePct == null) return "unknown";
  return priceChangePct > 0 ? "rising-with-price" : "rising-against-price";
}
