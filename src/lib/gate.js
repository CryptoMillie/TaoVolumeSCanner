// v440 Emission Gate — shared pure-math module.
//
// Runtime spec 440 (2026-07-27) replaced the old linear price-based emission
// split with a quantile-gated Hill function. Every tab that ranks, sorts,
// scores, or colors subnets using emission/emission-share/APY must derive
// from `demand` and `ratio` (r = demand / theta) via this module rather than
// computing emission share directly — see NOTES.md and the audit table in
// the project plan for which tabs were reworked and why.
//
// q and h are root-sudo governance parameters and can change on-chain at any
// time. They must never be hardcoded at call sites — always pass them
// through (defaulting to GATE_DEFAULTS) so a governance change only requires
// updating the runtime config (see GateConfigContext.jsx), not this file.

export const GATE_DEFAULTS = { q: 0.61, h: 3 };

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
 * theta = the demand value of the subnet where cumulative demand (sorted
 * descending) first crosses quantile q of total demand. Emission-disabled
 * subnets and non-positive demand are excluded from both the sort and the
 * total — they must not shift the bar.
 */
export function computeTheta(subnets, q = GATE_DEFAULTS.q) {
  const active = subnets.filter(s => s.emissionEnabled && s.demand > 0);
  if (!active.length) return 0;
  const sorted = [...active].sort((a, b) => b.demand - a.demand);
  const total = sorted.reduce((acc, s) => acc + s.demand, 0);
  const target = q * total;
  let cum = 0;
  for (const s of sorted) {
    cum += s.demand;
    if (cum >= target) return s.demand;
  }
  return sorted[sorted.length - 1].demand;
}

/**
 * Applies the gate to every subnet and normalizes to shares. Disabled
 * subnets get gate=0/weight=0/share=0 but are still returned (callers filter
 * as needed) so UI code doesn't have to special-case membership.
 */
export function applyGate(subnets, { q, h } = GATE_DEFAULTS) {
  const theta = computeTheta(subnets, q);
  const withWeight = subnets.map(s => {
    const g = s.emissionEnabled ? gate(s.demand, theta, h) : 0;
    return {
      ...s,
      theta,
      ratio: theta > 0 ? s.demand / theta : 0,
      gate: g,
      weight: s.demand * g,
      elasticity: elasticity(s.demand, theta, h),
    };
  });
  const totalWeight = withWeight.reduce((a, s) => a + s.weight, 0);
  return withWeight.map(s => ({ ...s, share: totalWeight ? s.weight / totalWeight : 0 }));
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
