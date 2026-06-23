// Burn Scanner Constants — Alpha burn classification + thresholds

export const CACHE_TTL_MS = 15 * 60 * 1000; // 15-min cache — matches all other tabs

// Batch config for API queries
export const BATCH_SIZE = 25;
export const STAGGER_MS = 200;

// Chain constants
export const BLOCKS_PER_DAY = 7200;
export const HISTORY_DAYS = 30;

// Burn level thresholds (% of expected emission burned)
export const HEAVY_BURN_PCT = 0.50;    // >= 50% of emission burned
export const MODERATE_BURN_PCT = 0.20; // >= 20% of emission burned
export const LIGHT_BURN_PCT = 0.05;    // >= 5% of emission burned

// Incentive burn thresholds
export const HIGH_INCENTIVE_PCT = 0.50;  // >= 50%
export const MEDIUM_INCENTIVE_PCT = 0.10; // >= 10%

// Burn status config — label/color/bg/border/rowBg per level
export const BURN_STATUS_CONFIG = {
  heavy: {
    label: "\uD83D\uDD25 Heavy",
    color: "#ff6633",
    bg: "#1a0e00",
    border: "#3a2000",
    rowBg: "rgba(255,102,51,0.06)",
  },
  moderate: {
    label: "\uD83D\uDFE1 Moderate",
    color: "#ddaa00",
    bg: "#1a1600",
    border: "#3a3000",
    rowBg: "rgba(221,170,0,0.06)",
  },
  light: {
    label: "\uD83D\uDFE0 Light",
    color: "#ff8833",
    bg: "#1a0e00",
    border: "#3a2000",
    rowBg: "rgba(255,136,51,0.06)",
  },
  minimal: {
    label: "\u26AA Minimal",
    color: "#555577",
    bg: "#0a0a14",
    border: "#1a1a2e",
    rowBg: "transparent",
  },
  noburn: {
    label: "\u2014 No Burn",
    color: "#333355",
    bg: "#0a0a14",
    border: "#1a1a2e",
    rowBg: "transparent",
  },
};

// Tooltips for column headers
export const TOOLTIPS = {
  burnPct: "Burn % shows how much of the expected 30-day emission was manually burned by the subnet owner. Higher % = more alpha removed from circulation = more deflationary pressure.",
  burned30d: "Total alpha derived as burned over the last 30 days. Calculated as expected emission minus actual pool alpha change.",
  taoValue: "Estimated TAO value of the burned alpha, based on current pool price.",
  burnDays: "Number of days (out of 30) where the actual alpha change was less than expected emission, indicating manual burns occurred.",
  incentiveBurn: "The miner_burn rate (incentive_burn). Under v3.4.6, this directly reduces chain-level emission via (1 - miner_burn). A 50% burn rate means the subnet receives only 50% of its potential chain emission.",
  emissionRetention: "Chain emission retention = (1 - miner_burn). Shows what fraction of potential chain emission this subnet actually receives. 100% = full emission, 0% = zero emission.",
  status: "Heavy (\u226550% burned) = severe emission penalty. Moderate (20-50%) = meaningful reduction. Light (5-20%) = minor impact. Minimal (<5%) = negligible.",
};
