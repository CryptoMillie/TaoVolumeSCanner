// SRI Scoring Constants — TAO Institute Subnet Risk Index

export const DIMENSION_WEIGHTS = {
  D1: 0.40, // Emission Viability
  D2: 0.25, // Market Structure
  D3: 0.20, // Economic Sustainability
  D4: 0.15, // Governance & Ops
};

export const DIMENSION_LABELS = {
  D1: "Emission Viability",
  D2: "Market Structure",
  D3: "Economic Sustainability",
  D4: "Governance & Ops",
};

export const TIER_THRESHOLDS = {
  GREEN: 70,
  AMBER: 40,
  // Below 40 = RED
};

export const TIER_CONFIG = {
  green:  { color: "#33bb66", bg: "#0a1a10", border: "#1a3a20", label: "GREEN" },
  amber:  { color: "#ddaa00", bg: "#1a1600", border: "#3a3000", label: "AMBER" },
  red:    { color: "#ff4455", bg: "#1a0010", border: "#3a0020", label: "RED" },
};

export const FLAG_LABELS = {
  F1: "Zero Emissions",
  F2: "Delisting Proximity",
  F3: "Liquidity Desert",
  F4: "Governance Capture",
  F5: "Validation Abandonment",
};

export const FLAG_CONFIG = {
  F1: { icon: "\u26AB", color: "#ff4455" },
  F2: { icon: "\u26A0",  color: "#ff6600" },
  F3: { icon: "\u{1F4A7}", color: "#4488ff" },
  F4: { icon: "\u{1F451}", color: "#dd44ff" },
  F5: { icon: "\u{1F6AB}", color: "#ff8833" },
};

// Liquidity desert threshold: 2000 TAO in raw rao units (1 TAO = 10^9 rao)
export const LIQUIDITY_DESERT_TAO = 2000;
export const RAO_PER_TAO = 1e9;

// Bottom N subnets by rank for delisting proximity flag
export const DELIST_BOTTOM_N = 5;

// Validation abandonment threshold
export const VALIDATION_ABANDON_RATIO = 0.30;

// Cache TTL in milliseconds (15 minutes)
export const CACHE_TTL_MS = 15 * 60 * 1000;
