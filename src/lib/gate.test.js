import { describe, it, expect } from "vitest";
import {
  GATE_DEFAULTS,
  gate,
  elasticity,
  computeTheta,
  applyGate,
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

describe("computeTheta()", () => {
  it("empty input -> theta = 0", () => {
    expect(computeTheta([])).toBe(0);
  });

  it("all subnets emission-disabled -> theta = 0", () => {
    const subnets = [
      { demand: 10, emissionEnabled: false },
      { demand: 20, emissionEnabled: false },
    ];
    expect(computeTheta(subnets)).toBe(0);
  });

  it("single active subnet -> theta = that subnet's own demand", () => {
    const subnets = [{ demand: 42, emissionEnabled: true }];
    expect(computeTheta(subnets)).toBe(42);
  });

  it("excludes disabled and non-positive-demand subnets from the crossing", () => {
    const subnets = [
      { demand: 100, emissionEnabled: true },
      { demand: 50, emissionEnabled: true },
      { demand: 10, emissionEnabled: true },
      { demand: 9999, emissionEnabled: false }, // must not shift theta
      { demand: 0, emissionEnabled: true }, // zero demand excluded
    ];
    // total = 160, q=0.61 -> target = 97.6
    // sorted desc: 100 (cum=100 >= 97.6) -> theta = 100
    expect(computeTheta(subnets, 0.61)).toBe(100);
  });

  it("q variation moves the crossing point", () => {
    const subnets = [
      { demand: 100, emissionEnabled: true },
      { demand: 50, emissionEnabled: true },
      { demand: 10, emissionEnabled: true },
    ];
    // total = 160
    // q=0.1 -> target=16 -> first subnet (100) already crosses -> theta=100
    expect(computeTheta(subnets, 0.1)).toBe(100);
    // q=0.95 -> target=152 -> cum after 100+50=150 (<152), +10=160 (>=152) -> theta=10
    expect(computeTheta(subnets, 0.95)).toBe(10);
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
