// Subnet Health Scoring Constants

export const HEALTH_WEIGHTS = {
  D1: 0.40, // Network Health
  D2: 0.35, // Market Confidence
  D3: 0.25, // Stability
};

export const HEALTH_DIMENSION_LABELS = {
  D1: "Network Health",
  D2: "Market Confidence",
  D3: "Stability",
};

export const HEALTH_TIER_THRESHOLDS = {
  GREEN: 70,
  AMBER: 40,
};

export const HEALTH_TIER_CONFIG = {
  green:  { color: "#33bb66", bg: "#0a1a10", border: "#1a3a20", label: "GREEN" },
  amber:  { color: "#ddaa00", bg: "#1a1600", border: "#3a3000", label: "AMBER" },
  red:    { color: "#ff4455", bg: "#1a0010", border: "#3a0020", label: "RED" },
};
