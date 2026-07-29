import { describe, it, expect } from "vitest";
import {
  HIGH,
  computeEmissionPerCap,
  poolMarketCapUsdMillions,
  classifyEmissionPerCap,
  classifyEmissionPerCapTrend,
  annotateEmissionPerCap,
} from "./emissionPerCap.js";

describe("computeEmissionPerCap() — brief's worked examples", () => {
  it("Affine SN120: 9.72% / $41.44M ≈ 0.2345 (normal cluster range)", () => {
    const ratio = computeEmissionPerCap(9.72, 41.44);
    expect(ratio).toBeCloseTo(0.2345, 3);
    expect(ratio).toBeLessThan(HIGH);
  });

  it("Minos SN107: 9.16% / $14.49M ≈ 0.632 (within the 0.63-0.73 outlier band)", () => {
    const ratio = computeEmissionPerCap(9.16, 14.49);
    expect(ratio).toBeCloseTo(0.632, 2);
    expect(ratio).toBeGreaterThan(HIGH);
  });

  it("returns null when market cap is non-positive (can't divide)", () => {
    expect(computeEmissionPerCap(9.72, 0)).toBeNull();
    expect(computeEmissionPerCap(9.72, -5)).toBeNull();
    expect(computeEmissionPerCap(9.72, null)).toBeNull();
  });

  it("returns null when emission share is missing", () => {
    expect(computeEmissionPerCap(null, 41.44)).toBeNull();
  });
});

describe("poolMarketCapUsdMillions() — rao-scale TAO to USD millions", () => {
  it("matches the live SN107 reference used to derive the conversion (market_cap raw / 1e9 * TAO_USD)", () => {
    // Live values fetched 2026-07-29: pool.market_cap=73295070606934,
    // TAO/USD=190.90 -> ~$14.0M, within ~3.5% of the brief's $14.49M
    // same-subnet reference from a day earlier (expected drift, not error).
    const usdMillions = poolMarketCapUsdMillions(73295070606934, 190.9);
    expect(usdMillions).toBeCloseTo(14.0, 0);
  });

  it("returns null without a TAO/USD price", () => {
    expect(poolMarketCapUsdMillions(73295070606934, null)).toBeNull();
    expect(poolMarketCapUsdMillions(73295070606934, 0)).toBeNull();
  });

  it("returns null without a market cap", () => {
    expect(poolMarketCapUsdMillions(null, 190.9)).toBeNull();
  });
});

describe("classifyEmissionPerCap() — brief's worked examples", () => {
  it("Minos SN107 pattern: high ratio, SI 86, +45.4% 1M -> healthy", () => {
    expect(classifyEmissionPerCap({ ratio: 0.63, si: 86, change1M: 45.4 })).toBe("healthy");
  });

  it("ORO SN15 pattern: high ratio, SI 50, -39.7% 1M -> suspect (falling knife)", () => {
    expect(classifyEmissionPerCap({ ratio: 0.68, si: 50, change1M: -39.7 })).toBe("suspect");
  });

  it("ratio at or below HIGH is always normal regardless of SI/change", () => {
    expect(classifyEmissionPerCap({ ratio: 0.4, si: 10, change1M: -90 })).toBe("normal");
    expect(classifyEmissionPerCap({ ratio: 0.2, si: 90, change1M: 90 })).toBe("normal");
  });

  it("high ratio with weak SI alone (below 55) is suspect even with positive momentum", () => {
    expect(classifyEmissionPerCap({ ratio: 0.5, si: 40, change1M: 10 })).toBe("suspect");
  });

  it("high ratio with a 1M crash alone (below -25%) is suspect even with strong SI", () => {
    expect(classifyEmissionPerCap({ ratio: 0.5, si: 90, change1M: -30 })).toBe("suspect");
  });

  it("high ratio in the ambiguous gap (SI 55-59, change1M <= 0) is elevated, not classified either way", () => {
    expect(classifyEmissionPerCap({ ratio: 0.5, si: 57, change1M: -5 })).toBe("elevated");
  });

  it("high ratio with SI >= 60 but non-positive 1M change is elevated (not healthy — needs both)", () => {
    expect(classifyEmissionPerCap({ ratio: 0.5, si: 70, change1M: -1 })).toBe("elevated");
  });

  it("missing SI/change1M never classifies as healthy, falls to elevated if not otherwise suspect", () => {
    expect(classifyEmissionPerCap({ ratio: 0.5, si: null, change1M: null })).toBe("elevated");
  });

  it("suspect never gets filtered — the function only classifies, callers must not drop rows", () => {
    const result = classifyEmissionPerCap({ ratio: 0.68, si: 50, change1M: -39.7 });
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();
  });
});

describe("annotateEmissionPerCap() — end-to-end from taostats-shaped records", () => {
  const subnet = { emission: "10" };
  const totalEmission = 100; // 10% share
  const pool = { market_cap: 73295070606934, fear_and_greed_index: "86.6", price_change_1_month: "44.28" };

  it("computes all fields from raw taostats-shaped subnet/pool records", () => {
    const r = annotateEmissionPerCap(subnet, pool, totalEmission, 190.9);
    expect(r.emissionSharePct).toBeCloseTo(10, 5);
    expect(r.marketCapUsdMillions).toBeCloseTo(14.0, 0);
    expect(r.si).toBeCloseTo(86.6, 5);
    expect(r.change1M).toBeCloseTo(44.28, 5);
    expect(r.emissionPerCap).toBeCloseTo(10 / r.marketCapUsdMillions, 5);
    expect(r.epcTier).toBe("healthy"); // si>=60, change1M>0, ratio ~0.71 > HIGH
  });

  it("handles missing pool gracefully", () => {
    const r = annotateEmissionPerCap(subnet, null, totalEmission, 190.9);
    expect(r.marketCapUsdMillions).toBeNull();
    expect(r.emissionPerCap).toBeNull();
    expect(r.si).toBeNull();
    expect(r.change1M).toBeNull();
  });

  it("handles zero total emission without dividing by zero", () => {
    const r = annotateEmissionPerCap(subnet, pool, 0, 190.9);
    expect(r.emissionSharePct).toBe(0);
    expect(r.emissionPerCap).toBe(0 / r.marketCapUsdMillions); // 0, not null — market cap is still valid
  });

  it("handles missing TAO/USD price (can't convert market cap)", () => {
    const r = annotateEmissionPerCap(subnet, pool, totalEmission, null);
    expect(r.marketCapUsdMillions).toBeNull();
    expect(r.emissionPerCap).toBeNull();
  });
});

describe("classifyEmissionPerCapTrend()", () => {
  it("rising ratio + rising price -> strongest signal", () => {
    expect(classifyEmissionPerCapTrend({ pastRatio: 0.3, currentRatio: 0.5, priceChangePct: 10 })).toBe("rising-with-price");
  });

  it("rising ratio + falling price -> the trap", () => {
    expect(classifyEmissionPerCapTrend({ pastRatio: 0.3, currentRatio: 0.5, priceChangePct: -10 })).toBe("rising-against-price");
  });

  it("falling ratio -> decaying back toward the pack, regardless of price", () => {
    expect(classifyEmissionPerCapTrend({ pastRatio: 0.5, currentRatio: 0.3, priceChangePct: 10 })).toBe("falling");
  });

  it("no history yet -> unknown", () => {
    expect(classifyEmissionPerCapTrend({ pastRatio: null, currentRatio: 0.5, priceChangePct: 10 })).toBe("unknown");
  });
});
