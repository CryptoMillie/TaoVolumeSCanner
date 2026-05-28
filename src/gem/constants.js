// Gem Scanner Constants — Dev Activity vs Market Cap intelligence

export const CACHE_TTL_MS = 15 * 60 * 1000; // 15-min cache — matches TaoStats/DataContext TTL

// Gem Score weights
export const GEM_WEIGHTS = {
  DEV: 0.60,   // Dev activity (7d commit velocity)
  VALUE: 0.40, // Value opportunity (inverse market cap)
};

// Tier thresholds
export const GEM_TIER_THRESHOLDS = {
  GEM: 75,
  MODERATE: 50,
  MIXED: 35,
  // Below 35 = GRAY
};

export const GEM_TIER_CONFIG = {
  gem:      { color: "#33bb66", bg: "#0a1a10", border: "#1a3a20", label: "GEM", icon: "\u{1F48E}" },
  moderate: { color: "#33bbcc", bg: "#0a1618", border: "#1a3038", label: "MODERATE", icon: "\u{1F535}" },
  mixed:    { color: "#ddaa00", bg: "#1a1600", border: "#3a3000", label: "MIXED", icon: "\u{1F7E1}" },
  gray:     { color: "#555577", bg: "#0a0a14", border: "#1a1a2e", label: "GRAY", icon: "\u26AA" },
};

// Quadrant labels
export const QUADRANTS = {
  topLeft:     { label: "Overhyped \u26A0", color: "#ddaa00" },
  topRight:    { label: "Established \u{1F3C6}", color: "#33bbcc" },
  bottomLeft:  { label: "Dormant \u{1F4A4}", color: "#555577" },
  bottomRight: { label: "\u{1F48E} Gem Zone", color: "#33bb66" },
};

// Signal lines per quadrant
export const SIGNAL_LINES = {
  gem:         "Shipping hard \u2014 market hasn't noticed yet \u{1F48E}",
  established: "Building and priced in \u{1F3C6}",
  overhyped:   "High valuation, low development activity \u26A0",
  dormant:     "Low activity and low market cap \u{1F4A4}",
};
