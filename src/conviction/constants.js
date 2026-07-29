// Conviction Locks Constants — Lock state classification + maturity curve

export const CACHE_TTL_MS = 15 * 60 * 1000; // 15-min cache — matches all other tabs

// RPC endpoints with failover — try primary → timeout 3s → rotate → log which served
export const FINNEY_WS = "wss://entrypoint-finney.opentensor.ai:443"; // legacy (kept for compatibility)
export const RPC_ENDPOINTS = [
  { url: "wss://entrypoint-finney.opentensor.ai:443", label: "Primary (Finney)" },
  { url: "wss://rpc.blockmachine.io", label: "Blockmachine Free" },
  { url: "wss://entrypoint-finney.opentensor.ai:443", label: "Finney Public" }, // fallback to public
];
export const RPC_TIMEOUT_MS = 3000; // 3-second timeout per endpoint

// Subnet range to scan
export const MAX_NETUIDS = 128;

// Batch config for RPC queries
export const BATCH_SIZE = 25;
export const STAGGER_MS = 200;

// UnlockRate: 90-day half-life = 972,000 blocks (at ~12s/block)
// Updated for Conviction v2 (v3.4.0-411, May 28 2026)
export const UNLOCK_RATE_BLOCKS = 972_000;
export const BLOCKS_PER_DAY = 7200;

// Lock % of pool thresholds — measures skin-in-the-game relative to subnet size
// Conviction v2 migration gave every subnet a lock, so absolute size is meaningless;
// lock as % of total subnet alpha shows actual commitment
export const HEAVY_PCT = 0.20;    // lock >= 20% of total subnet alpha
export const MODERATE_PCT = 0.05; // lock >= 5% of total subnet alpha
export const LIGHT_PCT = 0.001;   // lock >= 0.1% of total subnet alpha

// Challenger conviction ratio thresholds (still organic, not affected by migration)
export const STRONG_THRESHOLD = 0.80;
export const BUILDING_MIN = 0.01;

// Lock status config
export const LOCK_STATUS_CONFIG = {
  heavy: {
    label: "\u{1F7E2} Heavy",
    color: "#33bb66",
    bg: "#0a1a10",
    border: "#1a3a20",
    rowBg: "rgba(51,187,102,0.06)",
  },
  moderate: {
    label: "\u{1F7E1} Moderate",
    color: "#ddaa00",
    bg: "#1a1600",
    border: "#3a3000",
    rowBg: "rgba(221,170,0,0.06)",
  },
  light: {
    label: "\u{1F7E0} Light",
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
  lockPct: "Lock % shows the owner\u2019s locked alpha as a percentage of total subnet alpha (staked + in pool). Higher % = more skin in the game. Conviction v2 gave every subnet a baseline lock; this metric shows which owners are actually committed.",
  locked: "Total alpha locked by the subnet owner. After the Conviction v2 migration, every subnet has a lock \u2014 the absolute amount matters less than the % of pool.",
  lockType: "Perpetual locks keep locked_mass constant and grow conviction toward 100%. Decaying locks lose locked_mass over time with a 90-day half-life \u2014 after 6 months only 12.5% remains.",
  lockStatus: "Heavy (\u226520% of pool) = serious commitment. Moderate (5\u201320%) = meaningful. Light (<5%) = minimal skin in the game. No lock = exposed to emission blocking.",
  buckets: "Owner = subnet owner\u2019s own lock. To-Owner = other coldkeys supporting the owner\u2019s hotkey. Challenger = locks to non-owner hotkeys competing for kingship.",
  daysToKing: "Estimated days until the largest challenger\u2019s conviction overtakes the owner\u2019s total conviction (owner lock + supporter locks). Based on current conviction growth rates.",
  gate: "Whether the combined owner-side conviction (owner + supporters) meets the 10% of alpha-out threshold for full emission flow. This is the LOCK gate — an independent, ownership-based mechanism, NOT the v440 demand/theta gate (see The Bar tab). A subnet can pass this 10% lock gate and still sit well below theta, or fail it while sitting above theta — the two gates compound but do not interact.",
};

// 10% LOCK gate threshold — owner-side conviction must be >= 10% of alpha-out.
// Independent of, and not to be confused with, the v440 demand/theta gate
// (src/lib/gate.js, The Bar tab) — this one is about ownership commitment,
// not demand relative to the network-wide bar. The two compound but neither
// determines the other.
export const GATE_THRESHOLD = 0.10;

// Bucket config for 3-bucket conviction model (Owner / To-Owner / Challenger)
export const BUCKET_CONFIG = {
  owner: {
    label: "Owner",
    color: "#33bb66",
    bg: "#0a1a10",
    border: "#1a3a20",
  },
  toOwner: {
    label: "To-Owner",
    color: "#66aaff",
    bg: "#0a1020",
    border: "#1a2a44",
  },
  challenger: {
    label: "Challenger",
    color: "#ff6644",
    bg: "#1a0e0a",
    border: "#3a2010",
  },
};

// Storage pallet/item names for key computation
export const PALLET = "SubtensorModule";
export const STORAGE_OWNER_LOCK = "OwnerLock";
export const STORAGE_DECAYING_OWNER_LOCK = "DecayingOwnerLock";
export const STORAGE_HOTKEY_LOCK = "HotkeyLock";
export const STORAGE_DECAYING_HOTKEY_LOCK = "DecayingHotkeyLock";
export const STORAGE_SUBNET_OWNER_HOTKEY = "SubnetOwnerHotkey";
