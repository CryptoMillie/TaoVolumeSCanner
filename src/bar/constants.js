// The Bar — constants for the v440 emission gate tab.
//
// Storage item names below are verified against the live subtensor source
// (opentensor/subtensor main branch, pallets/subtensor/src/coinbase/
// subnet_emissions.rs + lib.rs, fetched 2026-07-28) — see NOTES.md. They are
// NOT guesses: `EmissionGateBar`/`EmissionBarQuantile`/`EmissionGateExponent`
// are theta/q/h respectively, stored as single StorageValues (no per-netuid
// enumeration needed), and `MinerBurned` (not a generic "incentive burn"
// field) is the real per-tempo withheld-proportion map.
export const PALLET = "SubtensorModule";
export const STORAGE_SUBNET_MOVING_PRICE = "SubnetMovingPrice"; // MAP(netuid) -> I96F32
export const STORAGE_MINER_BURNED = "MinerBurned"; // MAP(netuid) -> U96F32
export const STORAGE_SUBNET_EMISSION_ENABLED = "SubnetEmissionEnabled"; // MAP(netuid) -> bool, default true
export const STORAGE_EMISSION_GATE_BAR = "EmissionGateBar"; // StorageValue U64F64 (theta)
export const STORAGE_EMISSION_BAR_QUANTILE = "EmissionBarQuantile"; // StorageValue U64F64 (q)
export const STORAGE_EMISSION_GATE_EXPONENT = "EmissionGateExponent"; // StorageValue U64F64 (h)

// Tempo = 360 blocks (EMISSION_BAR_UPDATE_INTERVAL on-chain) at ~12s/block ≈ 72 min.
export const TEMPO_BLOCKS = 360;
export const TEMPO_MS = 72 * 60 * 1000;

// Cache chain data for one tempo — refetching per-block would flap near the
// boundary and burn the user's connection for no benefit (the bar only
// recomputes once per tempo on-chain anyway).
export const CACHE_TTL_MS = TEMPO_MS;

// theta history: cap the rolling localStorage buffer at ~30 days of tempo
// snapshots (30 * 24 * 60 / 72 ≈ 600).
export const THETA_HISTORY_MAX_ENTRIES = 600;
export const THETA_HISTORY_KEY = "tao_bar_theta_history";

// r-axis zones (brief §5 "Visual")
export const ZONES = [
  { key: "dead", label: "DEAD", min: 0, max: 0.5, color: "#3a2020", text: "#663333" },
  { key: "lottery", label: "LOTTERY", min: 0.5, max: 0.8, color: "#3a2a00", text: "#aa7733" },
  { key: "sweet", label: "SWEET SPOT", min: 0.8, max: 1.5, color: "#0a2a1a", text: "#33bb77" },
  { key: "carry", label: "CARRY", min: 1.5, max: 3, color: "#0a1a3a", text: "#4488ff" },
];

// Panel r-ranges (brief §5 "Main view")
export const PANEL_A_RANGE = { min: 1.0, max: 1.6 }; // just above — most precarious first
export const PANEL_B_RANGE = { min: 0.4, max: 1.0 }; // just below — closest to breaking through

// Flag miner burn above this as suppressing the demand signal (brief §5 columns)
export const MINER_BURN_FLAG_THRESHOLD = 0.10;

// Reconciliation: flag a subnet if computed share diverges from on-chain by more than this
export const RECONCILIATION_DELTA_THRESHOLD = 0.02; // 2%

export const SORT_MODES = {
  DISTANCE: "distance", // |r-1| ascending — default "closest to judgment"
  RISING: "rising", // fastest-rising Δr
  FALLING: "falling", // fastest-falling Δr
  ELASTICITY: "elasticity", // highest elasticity
  EPC: "epc", // highest emission-per-cap, descending
};

// Emission-per-cap disambiguation display thresholds (mirrors lib/emissionPerCap.js)
export const EPC_TIER_CONFIG = {
  healthy: { label: "HEALTHY", color: "#33bb66", border: "#1a3a20" },
  suspect: { label: "SUSPECT ⚠", color: "#ff6644", border: "#3a2010" },
  elevated: { label: "ELEVATED", color: "#ddaa00", border: "#3a3000" },
  normal: { label: "", color: "#555577", border: "transparent" },
};
