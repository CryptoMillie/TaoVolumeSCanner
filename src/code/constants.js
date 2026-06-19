// Code Quality Radar Constants — 12-Dimension IntoCode-style scoring

export const CACHE_TTL_MS = 15 * 60 * 1000; // 15-min cache

// ─── Tier thresholds & colors (matching IntoCode visual style) ─────
export const CODE_TIERS = {
  BEST:       { min: 8, label: "BEST-IN-CLASS", color: "#33bb66", bg: "#0a1a10", border: "#1a3a20" },
  MATURE:     { min: 6, label: "MATURE",        color: "#3388dd", bg: "#0a1420", border: "#1a2840" },
  DEVELOPING: { min: 3, label: "DEVELOPING",    color: "#dd8833", bg: "#1a1200", border: "#3a2800" },
  NASCENT:    { min: 0, label: "NASCENT",       color: "#dd3344", bg: "#1a0810", border: "#3a1020" },
};

export function getTier(score) {
  if (score >= CODE_TIERS.BEST.min) return CODE_TIERS.BEST;
  if (score >= CODE_TIERS.MATURE.min) return CODE_TIERS.MATURE;
  if (score >= CODE_TIERS.DEVELOPING.min) return CODE_TIERS.DEVELOPING;
  return CODE_TIERS.NASCENT;
}

export function getTierColor(score) {
  return getTier(score).color;
}

// ─── 12 Dimensions ─────────────────────────────────────────────────
// Grouped into three pillars for visual layout
export const PILLARS = {
  BITTENSOR: { label: "Bittensor Mechanics", weight: 0.40 },
  ENGINEERING: { label: "Engineering Practices", weight: 0.35 },
  SUSTAINABILITY: { label: "Sustainability & Growth", weight: 0.25 },
};

export const DIMENSIONS = [
  { id: 1,  key: "incentiveDesign",     name: "Incentive & Reward Design",     pillar: "BITTENSOR" },
  { id: 2,  key: "validatorConsensus",  name: "Validator & Consensus",         pillar: "BITTENSOR" },
  { id: 3,  key: "protocolDesign",      name: "Protocol & Network Design",     pillar: "BITTENSOR" },
  { id: 4,  key: "decentralization",    name: "Decentralization Fit",          pillar: "BITTENSOR" },
  { id: 5,  key: "codeQuality",         name: "Code Quality",                  pillar: "ENGINEERING" },
  { id: 6,  key: "testing",             name: "Testing",                       pillar: "ENGINEERING" },
  { id: 7,  key: "security",            name: "Security",                      pillar: "ENGINEERING" },
  { id: 8,  key: "dependencyHygiene",   name: "Dependency Hygiene",            pillar: "ENGINEERING" },
  { id: 9,  key: "documentation",       name: "Documentation",                 pillar: "ENGINEERING" },
  { id: 10, key: "teamVelocity",        name: "Team Velocity",                 pillar: "SUSTAINABILITY" },
  { id: 11, key: "executionRisk",       name: "Execution Risk",                pillar: "SUSTAINABILITY" },
  { id: 12, key: "originality",         name: "Originality",                   pillar: "SUSTAINABILITY" },
];

// Dimension weights within each pillar (must sum to 1 within pillar group)
export const DIMENSION_WEIGHTS = {
  incentiveDesign:    0.30,
  validatorConsensus: 0.25,
  protocolDesign:     0.25,
  decentralization:   0.20,
  codeQuality:        0.25,
  testing:            0.25,
  security:           0.20,
  dependencyHygiene:  0.15,
  documentation:      0.15,
  teamVelocity:       0.40,
  executionRisk:      0.35,
  originality:        0.25,
};
