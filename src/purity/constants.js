// Purity Scanner Constants — Coordinated Staking Detection (post-TaoFlow)
// Note: TaoFlow EMA-based emission was replaced by price-based emission in v3.4.6.
// The EMA cycling exploit is dead, but coordinated staking patterns remain useful
// signals for detecting manufactured demand and pump-and-dump behavior.

// Signal weights (all 4 signals active)
export const SIGNAL_WEIGHTS = {
  S1: 0.40, // Pool Size vs Emission Share
  S2: 0.25, // Staking Concentration (temporal pattern)
  S3: 0.20, // Wallet Concentration (coldkey distribution)
  S4: 0.15, // Age vs Emission Share
};

export const SIGNAL_LABELS = {
  S1: "Pool Size vs Emission Share",
  S2: "Staking Concentration",
  S3: "Wallet Concentration",
  S4: "Age vs Emission Share",
};

// Thresholds for pump detection flag
export const PUMP_THRESHOLDS = {
  S1_RATIO: 0.01,          // emission_share_pct / pool_tao — above this is suspicious
  S2_CONCENTRATION: 0.65,  // flow_7d / flow_30d — above this means recent spike
};

// Purity tier thresholds
export const PURITY_TIERS = {
  ORGANIC: 75,   // 75-100
  MIXED: 40,     // 40-74
  // Below 40 = Suspicious
};

export const PURITY_TIER_CONFIG = {
  organic:    { color: "#33bb66", bg: "#0a1a10", border: "#1a3a20", label: "ORGANIC",    icon: "\uD83D\uDFE2" },
  mixed:      { color: "#ddaa00", bg: "#1a1600", border: "#3a3000", label: "MIXED",      icon: "\uD83D\uDFE1" },
  suspicious: { color: "#ff4455", bg: "#1a0010", border: "#3a0020", label: "SUSPICIOUS", icon: "\uD83D\uDD34" },
};

// Signal 4: Age thresholds
export const AGE_THRESHOLDS = {
  NEW_DAYS: 14,   // Subnets under 14 days = high risk if high emission
  OLD_DAYS: 90,   // Subnets over 90 days = lower risk
};

// Flow trend thresholds
export const FLOW_TREND = {
  RISING: 0.05,   // net_flow_7d / pool_tao > 5% = rising
  FALLING: -0.05, // < -5% = falling
  // Between = flat
};

// Cache TTL (reuse existing 15-min cache from sri)
export const CACHE_TTL_MS = 15 * 60 * 1000;

// RAO conversion
export const RAO_PER_TAO = 1e9;
