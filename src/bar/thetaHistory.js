// The Bar — theta (and per-subnet ratio) time series persistence.
//
// This is the "settle a specific open question" piece from the brief: is
// theta self-limiting (falls as concentration rises, since the quantile
// crossing lands on a smaller subnet) or does it compound (rises tempo over
// tempo)? Nobody upstream is tracking this, so it's logged from day one.
//
// No backend exists in this static SPA — localStorage is the only free,
// infra-less persistence option, consistent with every other cache in the
// app. One entry is appended per tempo (~72 min), gated on the last
// recorded timestamp so repeated tab visits don't spam duplicate entries.

import { THETA_HISTORY_MAX_ENTRIES, THETA_HISTORY_KEY, TEMPO_MS } from "./constants.js";

// Allow a little jitter below a full tempo so a slightly-early revisit still
// records (chain block timing isn't perfectly regular).
const MIN_RECORD_GAP_MS = TEMPO_MS * 0.9;

function load() {
  try {
    const raw = localStorage.getItem(THETA_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(entries) {
  try {
    localStorage.setItem(THETA_HISTORY_KEY, JSON.stringify(entries));
  } catch {
    // localStorage full/unavailable — non-critical, history just stops growing
  }
}

/**
 * Record a snapshot if enough time has passed since the last one. Returns
 * the full (possibly-unchanged) history.
 *
 * @param {object} snapshot
 * @param {number} snapshot.theta - client-computed theta (from gate.js)
 * @param {number|null} snapshot.onChainTheta - directly-read on-chain theta, if available
 * @param {number} snapshot.rankAtBar - how far down the sorted list the crossing sits
 * @param {number} snapshot.effectiveCount - inverse Simpson index
 * @param {Record<string, number>} snapshot.ratios - netuid -> r, rounded for storage compactness
 * @param {Record<string, number>} [snapshot.emissionPerCap] - netuid -> emissionPerCap, rounded
 */
export function recordSnapshot({ theta, onChainTheta = null, rankAtBar, effectiveCount, ratios, emissionPerCap = null }) {
  const history = load();
  const last = history[history.length - 1];
  const now = Date.now();

  if (last && now - last.ts < MIN_RECORD_GAP_MS) {
    return history;
  }

  const rounded = {};
  for (const [netuid, r] of Object.entries(ratios || {})) {
    rounded[netuid] = Math.round(r * 1000) / 1000;
  }

  let roundedEpc = null;
  if (emissionPerCap) {
    roundedEpc = {};
    for (const [netuid, v] of Object.entries(emissionPerCap)) {
      if (v == null) continue;
      roundedEpc[netuid] = Math.round(v * 1000) / 1000;
    }
  }

  const entry = { ts: now, theta, onChainTheta, rankAtBar, effectiveCount, ratios: rounded, emissionPerCap: roundedEpc };
  const next = [...history, entry].slice(-THETA_HISTORY_MAX_ENTRIES);
  save(next);
  return next;
}

export function getThetaHistory() {
  return load();
}

function nearestEntryBefore(history, targetTs) {
  // History is chronological; find the entry closest to (but not after) targetTs.
  // Fall back to the closest entry overall if everything is after targetTs.
  let best = null;
  let bestDiff = Infinity;
  for (const entry of history) {
    const diff = Math.abs(entry.ts - targetTs);
    if (diff < bestDiff) {
      best = entry;
      bestDiff = diff;
    }
  }
  return best;
}

/** theta change vs N hours ago. Returns null if no history far back enough. */
export function getThetaChange(hoursAgo) {
  const history = load();
  if (history.length < 2) return null;
  const targetTs = Date.now() - hoursAgo * 60 * 60 * 1000;
  const oldest = history[0];
  if (oldest.ts > targetTs) return null; // don't have data that far back yet
  const past = nearestEntryBefore(history, targetTs);
  const current = history[history.length - 1];
  if (!past || past.theta <= 0) return null;
  return {
    from: past.theta,
    to: current.theta,
    pctChange: (current.theta - past.theta) / past.theta,
  };
}

/** Per-subnet r value from N hours ago (not a delta — caller subtracts). Returns null if unavailable. */
export function getPastRatio(netuid, hoursAgo) {
  const history = load();
  if (history.length < 2) return null;
  const targetTs = Date.now() - hoursAgo * 60 * 60 * 1000;
  const oldest = history[0];
  if (oldest.ts > targetTs) return null;
  const past = nearestEntryBefore(history, targetTs);
  const pastRatio = past?.ratios?.[String(netuid)];
  if (pastRatio == null) return null;
  return pastRatio;
}

/**
 * emissionPerCap value from N hours ago for a given netuid (not a delta —
 * caller compares against the current value). Returns null if unavailable.
 * Read-only — any tab can call this to show a trend indicator even though
 * only src/bar/scoring.js writes to this store (single writer, many
 * readers, same pattern as getPastRatio).
 */
export function getPastEmissionPerCap(netuid, hoursAgo) {
  const history = load();
  if (history.length < 2) return null;
  const targetTs = Date.now() - hoursAgo * 60 * 60 * 1000;
  const oldest = history[0];
  if (oldest.ts > targetTs) return null;
  const past = nearestEntryBefore(history, targetTs);
  const pastValue = past?.emissionPerCap?.[String(netuid)];
  if (pastValue == null) return null;
  return pastValue;
}

export function clearThetaHistory() {
  try { localStorage.removeItem(THETA_HISTORY_KEY); } catch { /* ignore */ }
}
