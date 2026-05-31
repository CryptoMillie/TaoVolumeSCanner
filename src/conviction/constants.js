// Conviction Locks Constants — Lock state classification + maturity curve

export const CACHE_TTL_MS = 15 * 60 * 1000; // 15-min cache — matches all other tabs

// RPC endpoint
export const FINNEY_WS = "wss://entrypoint-finney.opentensor.ai:443";

// Subnet range to scan
export const MAX_NETUIDS = 128;

// Batch config for RPC queries
export const BATCH_SIZE = 25;
export const STAGGER_MS = 200;

// UnlockRate: 90-day half-life = 972,000 blocks (at ~12s/block)
// Updated for Conviction v2 (v3.4.0-411, May 28 2026)
export const UNLOCK_RATE_BLOCKS = 972_000;
export const BLOCKS_PER_DAY = 7200;

// Lock status thresholds
export const STRONG_THRESHOLD = 0.80; // conviction >= 80% of locked_mass
export const BUILDING_MIN = 0.01;     // conviction >= 1% of locked_mass

// Minimum locked_mass (in alpha) to consider a lock "real" vs auto-locked dust
// Conviction v2 auto-locks owner emission cuts, creating tiny OwnerLock entries for all subnets
export const MIN_LOCK_THRESHOLDS = [
  { label: "All", value: 0 },
  { label: "> 1 \u03B1", value: 1 },
  { label: "> 10 \u03B1", value: 10 },
  { label: "> 100 \u03B1", value: 100 },
  { label: "> 1k \u03B1", value: 1000 },
];

// Lock status config
export const LOCK_STATUS_CONFIG = {
  strong: {
    label: "\u{1F7E2} Strong conviction",
    color: "#33bb66",
    bg: "#0a1a10",
    border: "#1a3a20",
    rowBg: "rgba(51,187,102,0.06)",
  },
  building: {
    label: "\u{1F7E1} Building",
    color: "#ddaa00",
    bg: "#1a1600",
    border: "#3a3000",
    rowBg: "rgba(221,170,0,0.06)",
  },
  zero: {
    label: "\u{1F534} Zero conviction",
    color: "#ff8833",
    bg: "#1a0e00",
    border: "#3a2000",
    rowBg: "rgba(255,136,51,0.06)",
  },
  nolock: {
    label: "\u26A0\uFE0F No lock",
    color: "#ff4455",
    bg: "#1a0010",
    border: "#3a0020",
    rowBg: "rgba(255,68,85,0.06)",
  },
  error: {
    label: "RPC error",
    color: "#555577",
    bg: "#0a0a14",
    border: "#1a1a2e",
    rowBg: "transparent",
  },
};

// Conviction maturity curve — perpetual lock to non-owner hotkey, 90-day half-life
// Updated for Conviction v2 (v3.4.0-411, May 28 2026)
export const MATURITY_CURVE = [
  { days: 0,   pct: "0%" },
  { days: 7,   pct: "~5.3%" },
  { days: 30,  pct: "~20.6%" },
  { days: 60,  pct: "~37.0%" },
  { days: 90,  pct: "50%" },
  { days: 120, pct: "~60.3%" },
  { days: 180, pct: "75%" },
  { days: 365, pct: "~93.9%" },
];

// Tooltips
export const TOOLTIPS = {
  conviction: "Conviction score reflects how long the owner has committed to the subnet. Locking to the owner\u2019s hotkey gives instant conviction. Locking to any other hotkey follows a 90-day maturity curve (Conviction v2). Zero conviction with an active lock means the lock just started.",
  lockType: "Perpetual locks keep locked_mass constant and grow conviction toward 100%. Decaying locks lose locked_mass over time with a 90-day half-life \u2014 after 6 months only 12.5% remains. Perpetual is opt-in via set_perpetual_lock.",
  lockStatus: "Subnets with no active lock are exposed to Const\u2019s May 24 2026 emission blocking announcement targeting subnets with no clear path to adding value.",
};

// Storage pallet/item names for key computation
export const PALLET = "SubtensorModule";
export const STORAGE_OWNER_LOCK = "OwnerLock";
export const STORAGE_DECAYING_OWNER_LOCK = "DecayingOwnerLock";
export const STORAGE_HOTKEY_LOCK = "HotkeyLock";
export const STORAGE_DECAYING_HOTKEY_LOCK = "DecayingHotkeyLock";
