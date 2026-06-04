// Burn Scanner API Layer
// All burn data (incentive_burn, recycled_lifetime, recycled_24_hours) comes from
// subnet latest endpoint, already fetched via useSharedData(). No additional API
// calls needed — this module is kept for consistency with other scanner patterns
// and for any future pool-history-based analysis.

// Re-export scoring functions as the primary interface
export { scoreBurns, computeBurnSummary } from "./scoring.js";
