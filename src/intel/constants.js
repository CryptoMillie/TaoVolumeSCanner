// Intel Feed Constants — Institutional Scoring + Volume Spike Detection

export const INST_WEIGHTS = {
  REV: 0.35, // Revenue / Path to Revenue
  TAM: 0.30, // Total Addressable Market
  PMF: 0.35, // Product-Market Fit
};

export const INST_DIMENSION_LABELS = {
  REV: "Revenue",
  TAM: "TAM",
  PMF: "Product-Market Fit",
};

export const INST_TIER_THRESHOLDS = {
  INSTITUTIONAL: 70,
  EMERGING: 40,
  // Below 40 = SPECULATIVE
};

export const INST_TIER_CONFIG = {
  institutional: { color: "#33bb66", bg: "#0a1a10", border: "#1a3a20", label: "INSTITUTIONAL GRADE" },
  emerging:      { color: "#ddaa00", bg: "#1a1600", border: "#3a3000", label: "EMERGING" },
  speculative:   { color: "#ff4455", bg: "#1a0010", border: "#3a0020", label: "SPECULATIVE" },
};

// Volume spike: >50% increase triggers alert
export const SPIKE_THRESHOLD_PCT = 50;

// Minimum volume to be considered for alerts (avoid dust noise)
export const MIN_VOLUME_USD = 1000;

// Top N movers to show in news feed
export const TOP_MOVERS_COUNT = 10;
