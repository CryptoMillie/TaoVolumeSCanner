// v440/v441 Emission Gate — shared pure-math module.
//
// Runtime spec 440 (2026-07-27) replaced the old linear price-based emission
// split with a quantile-gated Hill function. Every tab that ranks, sorts,
// scores, or colors subnets using emission/emission-share/APY must derive
// from `demand`/`ratio` (r = demandShare / theta) via this module rather than
// computing emission share directly — see NOTES.md and the audit table in
// the project plan for which tabs were reworked and why.
//
// Spec 441 (pending — RaoFoundation/subtensor PR #3014, unmerged as of
// 2026-07-29) adds a second theta-selection mode: rank-pinned
// (`EmissionBarRank`), which pins theta to the Nth-largest positive demand
// share instead of a quantile crossing. Quantile mode is the only LIVE path
// today — rank mode is built behind the same interface so nothing has to
// change if/when #3014 merges. `rank > 0` selects rank mode; `rank === 0`
// (the default here) keeps quantile mode. Never infer which mode is active
// from spec_version — read the live `EmissionBarRank` storage value instead
// (see bar/api.js) and pass it through as `rank`.
//
// q, h, and rank are root-sudo governance parameters and can change on-chain
// at any time. They must never be hardcoded at call sites — always pass them
// through (defaulting to GATE_DEFAULTS) so a governance change only requires
// updating the runtime config (see GateConfigContext.jsx), not this file.
//
// theta is expressed natively in normalized demand SHARE units (all active
// subnets' shares sum to 1), not raw demand/price — a price-like number is a
// display-only convenience derived from theta, never the unit theta itself
// is computed or compared in.

export const GATE_DEFAULTS = { q: 0.75, h: 3, rank: 0 };

// Floor for displayed gate/share values so deep-tail subnets render as
// "<0.1%" instead of a noisy near-zero float (Math.pow(r, h) underflow for
// small r). Only applied at display time — raw values stay unclamped for
// math (ranking, elasticity, reconciliation).
export const DISPLAY_FLOOR = 0.001;

/**
 * gate(s) = s^h / (s^h + theta^h), expressed via r = s/theta so the
 * absolute demand units cancel — only proximity to the bar matters.
 */
export function gate(s, theta, h = GATE_DEFAULTS.h) {
  if (theta <= 0) return 1;
  if (s <= 0) return 0;
  const r = s / theta;
  const rh = Math.pow(r, h);
  if (!isFinite(rh)) return 1; // r >> 1 underflow-to-infinity guard
  return rh / (rh + 1);
}

/**
 * elasticity = 1 + h * (1 - gate). How much extra emission a 1% demand gain
 * buys, at the current position relative to the bar.
 */
export function elasticity(s, theta, h = GATE_DEFAULTS.h) {
  return 1 + h * (1 - gate(s, theta, h));
}

/**
 * Sum of raw `demand` across active subnets (emission-enabled, positive
 * demand) — the denominator used to normalize demand into shares.
 */
function activeDemandTotal(subnets) {
  return subnets
    .filter(s => s.emissionEnabled && s.demand > 0)
    .reduce((acc, s) => acc + s.demand, 0);
}

/**
 * theta selection, dual-mode. Operates on normalized demand SHARES (sum to
 * 1 across active subnets), never raw demand/price — see module header.
 *
 * Quantile mode (rank <= 0, the live path as of 2026-07-29): theta = the
 * demand-share value of the subnet where cumulative share (sorted
 * descending) first crosses quantile q of total share.
 *
 * Rank mode (rank > 0, spec 441 / PR #3014, unmerged): theta = the Nth-
 * largest positive demand share, verbatim, no interpolation. If fewer than N
 * subnets have positive demand, falls back to the smallest positive share so
 * emissions are never stranded — everyone passes the gate in that case.
 *
 * Emission-disabled subnets and non-positive demand are excluded from both
 * modes' sort and total. Returns { theta, mode, rankAtBar }; mode is one of
 * 'none' | 'quantile' | 'rank' | 'rank-fallback'.
 */
export function computeTheta(subnets, { q, rank } = GATE_DEFAULTS) {
  if (q === undefined) q = GATE_DEFAULTS.q;
  if (rank === undefined) rank = GATE_DEFAULTS.rank;

  const active = subnets.filter(s => s.emissionEnabled && s.demand > 0);
  if (!active.length) return { theta: 0, mode: "none", rankAtBar: null };

  const total = active.reduce((acc, s) => acc + s.demand, 0);
  const sorted = [...active].sort((a, b) => b.demand - a.demand);
  const shares = sorted.map(s => s.demand / total);

  if (rank > 0) {
    if (shares.length < rank) {
      const lastShare = shares[shares.length - 1];
      return { theta: lastShare, mode: "rank-fallback", rankAtBar: shares.length };
    }
    return { theta: shares[rank - 1], mode: "rank", rankAtBar: rank };
  }

  const target = q; // shares sum to 1, so the quantile target is just q
  let cum = 0;
  for (let i = 0; i < shares.length; i++) {
    cum += shares[i];
    if (cum >= target) {
      return { theta: shares[i], mode: "quantile", rankAtBar: i + 1 };
    }
  }
  const lastShare = shares[shares.length - 1];
  return { theta: lastShare, mode: "quantile", rankAtBar: shares.length };
}

/**
 * Applies the gate to every subnet and normalizes to shares. Disabled
 * subnets get gate=0/weight=0/share=0 but are still returned (callers filter
 * as needed) so UI code doesn't have to special-case membership.
 *
 * `ratio` (r = demandShare / theta) is numerically identical whether theta
 * is expressed in demand-share or raw-demand units (the total-demand term
 * cancels), so this refactor from v440's raw-demand theta to v441's
 * demand-share theta does not change any r-derived output (gate, elasticity,
 * gapToBar, bufferAboveBar, zone boundaries) — only the absolute `theta`
 * value's unit changes, from a price-like number to a share fraction.
 */
export function applyGate(subnets, config = GATE_DEFAULTS) {
  const q = config.q === undefined ? GATE_DEFAULTS.q : config.q;
  const h = config.h === undefined ? GATE_DEFAULTS.h : config.h;
  const rank = config.rank === undefined ? GATE_DEFAULTS.rank : config.rank;

  const { theta, mode, rankAtBar } = computeTheta(subnets, { q, rank });
  const totalActiveDemand = activeDemandTotal(subnets);

  const withWeight = subnets.map(s => {
    const demandShare = (s.emissionEnabled && s.demand > 0 && totalActiveDemand > 0)
      ? s.demand / totalActiveDemand
      : 0;
    const g = s.emissionEnabled ? gate(demandShare, theta, h) : 0;
    return {
      ...s,
      theta,
      mode,
      rankAtBar,
      demandShare,
      // display-only convenience: theta expressed back in the subnet's own
      // demand/price units, for humans — never the unit theta is computed in.
      thetaDemandEquivalent: totalActiveDemand > 0 ? theta * totalActiveDemand : 0,
      ratio: theta > 0 ? demandShare / theta : 0,
      gate: g,
      weight: demandShare * g,
      elasticity: elasticity(demandShare, theta, h),
    };
  });
  const totalWeight = withWeight.reduce((a, s) => a + s.weight, 0);
  return withWeight.map(s => ({ ...s, share: totalWeight ? s.weight / totalWeight : 0 }));
}

/** Top-N subnets' combined demand share (not emission share) — the honest
 * concentration measure and leading indicator for bar drift (brief §6d). */
export function topNDemandShare(subnets, n) {
  const active = subnets.filter(s => s.emissionEnabled && s.demand > 0);
  const total = active.reduce((acc, s) => acc + s.demand, 0);
  if (total <= 0) return 0;
  const sorted = [...active].sort((a, b) => b.demand - a.demand);
  return sorted.slice(0, n).reduce((acc, s) => acc + s.demand, 0) / total;
}

/** % demand growth needed to reach the bar. Negative/zero = already at or above. */
export function gapToBar(ratio) {
  if (ratio <= 0) return Infinity;
  return (1 / ratio) - 1;
}

/** % demand a subnet can lose before falling under the bar. 0 if not above. */
export function bufferAboveBar(ratio) {
  return ratio > 1 ? 1 - (1 / ratio) : 0;
}

/** demand_i = p_i * (1 - b_i) — the shared demand formula every fetch layer must use. */
export function demandFromPriceAndBurn(price, burn) {
  return Math.max(0, price) * (1 - Math.max(0, Math.min(1, burn)));
}

/** Inverse Simpson index: "the network behaves like N subnets" figure. */
export function effectiveSubnetCount(shares) {
  const sumSq = shares.reduce((acc, s) => acc + s * s, 0);
  return sumSq > 0 ? 1 / sumSq : 0;
}

/**
 * Display-safe clamp for gate/share fractions. Returns the raw value when
 * it's above the floor, otherwise the floor with a `belowFloor` flag so
 * callers can render "<0.1%" instead of "0.0000003%".
 */
export function clampForDisplay(value, floor = DISPLAY_FLOOR) {
  if (value > 0 && value < floor) return { value: floor, belowFloor: true };
  return { value, belowFloor: false };
}
