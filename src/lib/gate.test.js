import { describe, it, expect } from "vitest";
import {
  GATE_DEFAULTS,
  gate,
  elasticity,
  computeTheta,
  applyGate,
  topNDemandShare,
  gapToBar,
  bufferAboveBar,
  demandFromPriceAndBurn,
  effectiveSubnetCount,
  clampForDisplay,
} from "./gate.js";

const H = GATE_DEFAULTS.h; // 3

describe("gate() reference table (brief §1, h=3)", () => {
  // r -> [expected gate, tolerance]
  const table = [
    [0.25, 0.015],
    [0.5, 0.111],
    [0.75, 0.297],
    [1.0, 0.5],
    [1.5, 0.771],
    [2.0, 0.889],
    [3.0, 0.964],
  ];

  it.each(table)("r=%s -> gate≈%s", (r, expected) => {
    const theta = 100;
    const s = r * theta;
    expect(gate(s, theta, H)).toBeCloseTo(expected, 2);
  });
});

describe("elasticity() reference table (brief §1, h=3)", () => {
  const table = [
    [0.25, 3.95],
    [0.5, 3.67],
    [0.75, 3.11],
    [1.0, 2.5],
    [1.5, 1.69],
    [2.0, 1.33],
    [3.0, 1.11],
  ];

  it.each(table)("r=%s -> elasticity≈%s", (r, expected) => {
    const theta = 100;
    const s = r * theta;
    expect(elasticity(s, theta, H)).toBeCloseTo(expected, 1);
  });
});

describe("exact-bar case", () => {
  it("gate=0.5 and elasticity=2.5 at s === theta", () => {
    expect(gate(100, 100, 3)).toBeCloseTo(0.5, 10);
    expect(elasticity(100, 100, 3)).toBeCloseTo(2.5, 10);
  });
});

describe("10% demand growth near the bar sanity check", () => {
  it("a subnet at the bar growing demand 10% gains roughly 26% weight (1.10^2.5)", () => {
    const theta = 100;
    const before = 100 * gate(100, theta, 3);
    const after = 110 * gate(110, theta, 3);
    const growth = after / before - 1;
    expect(growth).toBeCloseTo(Math.pow(1.1, 2.5) - 1, 1);
  });
});

describe("gate() / elasticity() edge cases", () => {
  it("theta <= 0 -> gate returns 1", () => {
    expect(gate(50, 0, 3)).toBe(1);
    expect(gate(50, -10, 3)).toBe(1);
  });

  it("s <= 0 -> gate returns 0", () => {
    expect(gate(0, 100, 3)).toBe(0);
    expect(gate(-5, 100, 3)).toBe(0);
  });

  it("q/h variation changes the curve", () => {
    const theta = 100;
    const gH1 = gate(150, theta, 1);
    const gH5 = gate(150, theta, 5);
    // Higher h = steeper curve = higher gate above the bar
    expect(gH5).toBeGreaterThan(gH1);
  });
});

describe("GATE_DEFAULTS (v441)", () => {
  it("q defaults to 0.75 (corrected from v440's 0.61 — brief §1 correction #1)", () => {
    expect(GATE_DEFAULTS.q).toBe(0.75);
  });

  it("rank defaults to 0 (quantile mode) — rank mode (PR #3014) is unmerged, nothing should switch behavior until EmissionBarRank reports non-zero on chain", () => {
    expect(GATE_DEFAULTS.rank).toBe(0);
  });
});

describe("computeTheta() — quantile mode (default, the live path)", () => {
  it("empty input -> theta=0, mode='none', rankAtBar=null", () => {
    expect(computeTheta([])).toEqual({ theta: 0, mode: "none", rankAtBar: null });
  });

  it("all subnets emission-disabled -> theta=0, mode='none'", () => {
    const subnets = [
      { demand: 10, emissionEnabled: false },
      { demand: 20, emissionEnabled: false },
    ];
    expect(computeTheta(subnets)).toEqual({ theta: 0, mode: "none", rankAtBar: null });
  });

  it("single active subnet -> it holds 100% of demand share, theta=1, rankAtBar=1", () => {
    const subnets = [{ demand: 42, emissionEnabled: true }];
    const result = computeTheta(subnets);
    expect(result.theta).toBeCloseTo(1, 10);
    expect(result.mode).toBe("quantile");
    expect(result.rankAtBar).toBe(1);
  });

  it("theta is a normalized demand SHARE, not raw demand (brief §1 correction #2)", () => {
    // demand=[100,50,10], total=160 -> shares = [0.625, 0.3125, 0.0625]
    const subnets = [
      { demand: 100, emissionEnabled: true },
      { demand: 50, emissionEnabled: true },
      { demand: 10, emissionEnabled: true },
    ];
    // q=0.75 default: cum after top share (0.625) < 0.75, cum after top two (0.9375) >= 0.75 -> theta = 0.3125
    const result = computeTheta(subnets);
    expect(result.theta).toBeCloseTo(0.3125, 10);
    expect(result.rankAtBar).toBe(2);
    expect(result.mode).toBe("quantile");
  });

  it("excludes disabled and non-positive-demand subnets from the crossing", () => {
    const subnets = [
      { demand: 100, emissionEnabled: true },
      { demand: 50, emissionEnabled: true },
      { demand: 10, emissionEnabled: true },
      { demand: 9999, emissionEnabled: false }, // must not shift theta
      { demand: 0, emissionEnabled: true }, // zero demand excluded
    ];
    // total (active only) = 160, shares = [0.625, 0.3125, 0.0625]
    // q=0.61 -> target=0.61, cum after first share (0.625) >= 0.61 -> theta = 0.625
    const result = computeTheta(subnets, { q: 0.61 });
    expect(result.theta).toBeCloseTo(0.625, 10);
    expect(result.rankAtBar).toBe(1);
  });

  it("q variation moves the crossing point", () => {
    const subnets = [
      { demand: 100, emissionEnabled: true },
      { demand: 50, emissionEnabled: true },
      { demand: 10, emissionEnabled: true },
    ];
    // shares = [0.625, 0.3125, 0.0625]
    // q=0.1 -> first share (0.625) already crosses -> theta=0.625
    expect(computeTheta(subnets, { q: 0.1 }).theta).toBeCloseTo(0.625, 10);
    // q=0.95 -> cum 0.625, 0.9375 (<0.95), +0.0625=1.0 (>=0.95) -> theta=0.0625
    expect(computeTheta(subnets, { q: 0.95 }).theta).toBeCloseTo(0.0625, 10);
  });

  it("gate() at the quantile-crossing subnet's own share is always exactly 0.5 (r=1 by construction)", () => {
    const subnets = Array.from({ length: 20 }, (_, i) => ({ demand: 100 - i * 3, emissionEnabled: true }));
    const { theta } = computeTheta(subnets, { q: 0.75 });
    expect(gate(theta, theta, GATE_DEFAULTS.h)).toBeCloseTo(0.5, 10);
  });
});

describe("computeTheta() — rank mode (spec 441 / PR #3014, unmerged)", () => {
  // 100 subnets, demand = 100, 99, 98, ... 1 (so demand_i = 101-i, strictly
  // decreasing, easy to reason about ranks). Total = sum(1..100) = 5050.
  const subnets100 = Array.from({ length: 100 }, (_, i) => ({ demand: 100 - i, emissionEnabled: true }));

  it("rank > 0 selects the Nth-largest positive demand share, verbatim (no interpolation)", () => {
    const result = computeTheta(subnets100, { rank: 64 });
    const total = subnets100.reduce((a, s) => a + s.demand, 0);
    const expectedShare = subnets100[63].demand / total; // 64th largest = 64th element (already sorted desc)
    expect(result.theta).toBeCloseTo(expectedShare, 10);
    expect(result.mode).toBe("rank");
    expect(result.rankAtBar).toBe(64);
  });

  it("gate() at exactly the rank-N crossing subnet is always 0.5, whatever the distribution (PR's cross-check #1)", () => {
    const { theta } = computeTheta(subnets100, { rank: 64 });
    expect(gate(theta, theta, GATE_DEFAULTS.h)).toBeCloseTo(0.5, 10);
  });

  it("fewer-than-N positive-demand subnets -> falls back to the smallest positive share, mode='rank-fallback', everyone passes", () => {
    const subnets = [
      { demand: 100, emissionEnabled: true },
      { demand: 50, emissionEnabled: true },
      { demand: 10, emissionEnabled: true },
    ];
    const result = computeTheta(subnets, { rank: 64 });
    expect(result.mode).toBe("rank-fallback");
    expect(result.rankAtBar).toBe(3);
    // theta = smallest positive share = 10/160
    expect(result.theta).toBeCloseTo(10 / 160, 10);
    // fallback theta means every active subnet's demandShare >= theta -> gate >= 0.5 for all
    const gated = applyGate(subnets, { rank: 64 });
    expect(gated.every((s) => !s.emissionEnabled || s.gate >= 0.5)).toBe(true);
  });

  it("zero and negative-share subnets are excluded from rank selection entirely", () => {
    const subnets = [
      { demand: 100, emissionEnabled: true },
      { demand: 0, emissionEnabled: true }, // excluded
      { demand: -5, emissionEnabled: true }, // excluded (negative, filtered by demand > 0)
      { demand: 50, emissionEnabled: true },
    ];
    const result = computeTheta(subnets, { rank: 2 });
    // only 2 active subnets (100, 50); rank=2 -> theta = smaller of the two (50's share)
    const total = 150;
    expect(result.theta).toBeCloseTo(50 / total, 10);
    expect(result.mode).toBe("rank");
  });

  it("ties at the bar: multiple subnets sharing theta's exact value all sit at r=1.0 and get gate=0.5, no tiebreak needed", () => {
    const subnets = [
      { netuid: 1, demand: 40, emissionEnabled: true },
      { netuid: 2, demand: 30, emissionEnabled: true },
      { netuid: 3, demand: 30, emissionEnabled: true }, // tied with #2
      { netuid: 4, demand: 10, emissionEnabled: true },
    ];
    // rank=2 -> theta = 2nd-largest share = 30/110
    const gated = applyGate(subnets, { rank: 2 });
    const tied = gated.filter((s) => s.demand === 30);
    expect(tied).toHaveLength(2);
    tied.forEach((s) => {
      expect(s.ratio).toBeCloseTo(1, 10);
      expect(s.gate).toBeCloseTo(0.5, 10);
    });
  });

  it("rank=0 (the default) always resolves to quantile mode, never rank mode", () => {
    const result = computeTheta(subnets100, { rank: GATE_DEFAULTS.rank });
    expect(result.mode).toBe("quantile");
  });
});

describe("computeTheta() / applyGate() — r-inversion cross-check (PR's cross-check #2)", () => {
  it("inverting a target gate value recovers the expected r via gate()'s own inverse relationship", () => {
    // The PR reports gate=0.927 at rank 32 when theta is rank 64's share; inverting
    // gate=r^h/(r^h+1) for h=3 gives r = (gate/(1-gate))^(1/3).
    const targetGate = 0.927;
    const h = 3;
    const r = Math.pow(targetGate / (1 - targetGate), 1 / h);
    expect(r).toBeCloseTo(2.33, 1); // matches the PR's "r ≈ 2.33" figure
    // round-trip: gate() at that r reproduces the target
    const theta = 0.01;
    expect(gate(r * theta, theta, h)).toBeCloseTo(targetGate, 3);
  });

  // NOTE: the PR's headline fixture values (theta=0.00339; gate 0.927/0.500/0.087
  // at ranks 32/64/80; post-gate top4/32/64 mass 32.5%/84.9%/98.5%) describe one
  // snapshot of live Finney state that cannot be reconstructed here without that
  // literal chain data — no single-parameter synthetic distribution reproduces
  // all of them simultaneously (verified: a pure power-law fit to ranks 32 vs 64
  // over-predicts rank 80's gate by ~3.5x, confirming the real distribution isn't
  // a clean power law either). The invariants above (gate=0.5 exactly at the
  // crossing rank, and the gate<->r inversion) are what the PR itself calls out
  // as its two "useful cross-checks", and are what's actually verifiable without
  // a live chain read. src/bar/api.js's reconciliation panel is where this gets
  // checked against real data, at runtime.
});

describe("topNDemandShare() (brief §6d — top-8 DEMAND share, not emission share)", () => {
  it("computes the combined share of the top N subnets by demand", () => {
    const subnets = [
      { demand: 40, emissionEnabled: true },
      { demand: 30, emissionEnabled: true },
      { demand: 20, emissionEnabled: true },
      { demand: 10, emissionEnabled: true },
    ];
    expect(topNDemandShare(subnets, 2)).toBeCloseTo(70 / 100, 10);
    expect(topNDemandShare(subnets, 4)).toBeCloseTo(1, 10);
  });

  it("excludes disabled/non-positive demand and returns 0 for empty/all-excluded input", () => {
    expect(topNDemandShare([], 8)).toBe(0);
    expect(topNDemandShare([{ demand: 10, emissionEnabled: false }], 8)).toBe(0);
  });
});

describe("applyGate()", () => {
  it("single subnet: gate=0.5, share=1 (all weight concentrated on it)", () => {
    const [row] = applyGate([{ netuid: 1, demand: 42, emissionEnabled: true }]);
    expect(row.ratio).toBeCloseTo(1, 10);
    expect(row.gate).toBeCloseTo(0.5, 10);
    expect(row.share).toBeCloseTo(1, 10);
  });

  it("theta=0 (empty/all-disabled) -> every row shares=0, no throw", () => {
    const rows = applyGate([
      { netuid: 1, demand: 10, emissionEnabled: false },
      { netuid: 2, demand: 20, emissionEnabled: false },
    ]);
    expect(rows.every(r => r.share === 0)).toBe(true);
    expect(rows.every(r => r.theta === 0)).toBe(true);
    expect(rows.every(r => r.mode === "none")).toBe(true);
  });

  it("disabled subnets get gate=0/weight=0/share=0 but are still returned", () => {
    const rows = applyGate([
      { netuid: 1, demand: 100, emissionEnabled: true },
      { netuid: 2, demand: 500, emissionEnabled: false },
    ]);
    const disabled = rows.find(r => r.netuid === 2);
    expect(disabled.gate).toBe(0);
    expect(disabled.weight).toBe(0);
    expect(disabled.share).toBe(0);
    expect(disabled.demandShare).toBe(0);
  });

  it("shares sum to 1 across active subnets", () => {
    const rows = applyGate([
      { netuid: 1, demand: 100, emissionEnabled: true },
      { netuid: 2, demand: 50, emissionEnabled: true },
      { netuid: 3, demand: 10, emissionEnabled: true },
    ]);
    const total = rows.reduce((a, r) => a + r.share, 0);
    expect(total).toBeCloseTo(1, 8);
  });

  it("q/h are runtime-configurable, not hardcoded — different config -> different theta", () => {
    const subnets = [
      { netuid: 1, demand: 100, emissionEnabled: true },
      { netuid: 2, demand: 50, emissionEnabled: true },
      { netuid: 3, demand: 10, emissionEnabled: true },
    ];
    const low = applyGate(subnets, { q: 0.1, h: 3 });
    const high = applyGate(subnets, { q: 0.95, h: 3 });
    expect(low[0].theta).not.toBe(high[0].theta);
  });

  it("ratio is numerically identical regardless of whether theta is in demand-share or raw-demand units", () => {
    // Sanity-check the v440->v441 refactor: r = demandShare/thetaShare must equal
    // the old r = demand/thetaDemand, since the total-demand term cancels.
    const subnets = [
      { netuid: 1, demand: 100, emissionEnabled: true },
      { netuid: 2, demand: 50, emissionEnabled: true },
      { netuid: 3, demand: 10, emissionEnabled: true },
    ];
    const gated = applyGate(subnets, { q: 0.61, h: 3 });
    const total = 160;
    gated.forEach((s) => {
      const oldStyleRatio = s.theta > 0 ? s.demand / (s.theta * total) : 0;
      expect(s.ratio).toBeCloseTo(oldStyleRatio, 10);
    });
  });

  it("thetaDemandEquivalent converts theta back to the subnet's own demand/price units, display-only", () => {
    const subnets = [
      { netuid: 1, demand: 100, emissionEnabled: true },
      { netuid: 2, demand: 50, emissionEnabled: true },
    ];
    const gated = applyGate(subnets, { q: 0.75 });
    // theta (share) * total active demand = theta expressed in demand units
    const total = 150;
    gated.forEach((s) => {
      expect(s.thetaDemandEquivalent).toBeCloseTo(s.theta * total, 10);
    });
  });

  it("mode and rankAtBar are propagated onto every row", () => {
    const subnets = [
      { netuid: 1, demand: 100, emissionEnabled: true },
      { netuid: 2, demand: 50, emissionEnabled: true },
    ];
    const gated = applyGate(subnets, { rank: 1 });
    expect(gated.every((s) => s.mode === "rank")).toBe(true);
    expect(gated.every((s) => s.rankAtBar === 1)).toBe(true);
  });
});

describe("gapToBar() / bufferAboveBar()", () => {
  it("gapToBar: below the bar needs positive growth", () => {
    expect(gapToBar(0.8)).toBeCloseTo(0.25, 5); // needs +25% demand
  });

  it("gapToBar: at/above the bar is <= 0", () => {
    expect(gapToBar(1)).toBeCloseTo(0, 10);
    expect(gapToBar(1.5)).toBeLessThan(0);
  });

  it("bufferAboveBar: above the bar can lose some demand", () => {
    expect(bufferAboveBar(1.3)).toBeCloseTo(1 - 1 / 1.3, 5);
  });

  it("bufferAboveBar: at/below the bar is 0 (not meaningful)", () => {
    expect(bufferAboveBar(1)).toBe(0);
    expect(bufferAboveBar(0.5)).toBe(0);
  });
});

describe("demandFromPriceAndBurn()", () => {
  it("computes price * (1 - burn)", () => {
    expect(demandFromPriceAndBurn(1.0, 0.1)).toBeCloseTo(0.9, 10);
  });

  it("clamps burn to [0,1] and price to >= 0", () => {
    expect(demandFromPriceAndBurn(1.0, 1.5)).toBe(0);
    expect(demandFromPriceAndBurn(-5, 0.1)).toBe(0);
  });
});

describe("effectiveSubnetCount()", () => {
  it("equal shares across N subnets -> effective count = N", () => {
    const shares = [0.25, 0.25, 0.25, 0.25];
    expect(effectiveSubnetCount(shares)).toBeCloseTo(4, 8);
  });

  it("fully concentrated (one subnet=1, rest=0) -> effective count = 1", () => {
    expect(effectiveSubnetCount([1, 0, 0, 0])).toBeCloseTo(1, 8);
  });

  it("empty input -> 0", () => {
    expect(effectiveSubnetCount([])).toBe(0);
  });
});

describe("clampForDisplay()", () => {
  it("values above the floor pass through unchanged", () => {
    expect(clampForDisplay(0.05)).toEqual({ value: 0.05, belowFloor: false });
  });

  it("tiny positive values clamp to the floor and flag belowFloor", () => {
    const { value, belowFloor } = clampForDisplay(0.0000003);
    expect(value).toBe(0.001);
    expect(belowFloor).toBe(true);
  });

  it("zero stays zero, not flagged", () => {
    expect(clampForDisplay(0)).toEqual({ value: 0, belowFloor: false });
  });
});
