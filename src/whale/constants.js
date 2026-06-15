// Whale Watcher Constants — Holder Concentration & Price Impact Analysis

// Concentration tiers (based on whale score: 0-100, higher = more distributed/safer)
export const WHALE_TIERS = {
  DISTRIBUTED: 70,   // 70-100
  MODERATE: 40,      // 40-69
  CONCENTRATED: 20,  // 20-39
  // Below 20 = WHALE-DOMINATED
};

export const WHALE_TIER_CONFIG = {
  distributed:     { color: "#33bb66", bg: "#0a1a10", border: "#1a3a20", label: "DISTRIBUTED",     icon: "\uD83D\uDFE2" },
  moderate:        { color: "#ddaa00", bg: "#1a1600", border: "#3a3000", label: "MODERATE",         icon: "\uD83D\uDFE1" },
  concentrated:    { color: "#ff8833", bg: "#1a0e00", border: "#3a2200", label: "CONCENTRATED",     icon: "\uD83D\uDFE0" },
  "whale-dominated": { color: "#ff4455", bg: "#1a0010", border: "#3a0020", label: "WHALE-DOMINATED", icon: "\uD83D\uDD34" },
};

// Impact severity thresholds (estimated % price drop if top whale dumps)
export const IMPACT_SEVERITY = {
  CRITICAL: 30,  // >30% = CRITICAL
  HIGH: 15,      // >15% = HIGH
  MODERATE: 5,   // >5% = MODERATE
  // <=5% = LOW
};

export const IMPACT_COLORS = {
  CRITICAL: "#ff2233",
  HIGH: "#ff6644",
  MODERATE: "#ddaa00",
  LOW: "#555577",
};

// Red flag thresholds
export const RED_FLAG_THRESHOLDS = {
  SINGLE_WHALE: 0.50,    // Top 1 holder >50% of registrations
  TOP_HEAVY: 0.80,       // Top 5 holders >80%
  THIN_LIQUIDITY_TAO: 2000, // Pool TAO threshold for thin liquidity flag
  HHI_CONCENTRATED: 2500,   // DOJ antitrust threshold analogy
};

// Signal weights for composite whale risk score
export const WHALE_SIGNAL_WEIGHTS = {
  TOP1: 0.25,      // Top 1 holder concentration
  TOP5: 0.25,      // Top 5 holder concentration
  HHI: 0.25,       // Herfindahl-Hirschman Index
  IMPACT: 0.25,    // Price impact estimate
};

export const WHALE_SIGNAL_LABELS = {
  TOP1: "Top 1 Holder Share",
  TOP5: "Top 5 Holders Share",
  HHI: "HHI Concentration",
  IMPACT: "Price Impact Risk",
};

export const RAO_PER_TAO = 1e9;
