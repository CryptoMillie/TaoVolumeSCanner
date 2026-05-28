// Gem Scanner API — TaoStats Dev Activity endpoint with caching
//
// Uses GET /api/dev_activity/latest/v1 (paginated, 50/page max).
// Returns a Map<netuid, devActivityEntry> keyed by netuid for easy join
// with the canonical subnet/pool registry.

import { CACHE_TTL_MS } from "./constants.js";

const API_KEY = import.meta.env.VITE_TAOSTATS_API_KEY || "";

// ─── localStorage Cache ──────────────────────────────────
const LS_KEY = "gem_dev_activity";

function getCached() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      localStorage.removeItem(LS_KEY);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function setCache(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // localStorage full — silently ignore
  }
}

/**
 * Fetch with retry + exponential backoff (matches DataContext pattern).
 */
async function fetchWithRetry(url, headers, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
    if (i < retries && (res.status === 429 || res.status >= 500)) {
      await new Promise(r => setTimeout(r, 1000 * 2 ** i));
      continue;
    }
    throw new Error(`TaoStats dev_activity ${res.status}: ${res.statusText}`);
  }
}

/**
 * Fetch a single page from the TaoStats dev_activity endpoint.
 */
async function fetchPage(page) {
  const url = `https://api.taostats.io/api/dev_activity/latest/v1?page=${page}`;
  const headers = {};
  if (API_KEY) headers["Authorization"] = API_KEY;
  return fetchWithRetry(url, headers);
}

/**
 * Fetch dev activity for ALL subnets from TaoStats.
 * Paginates through all pages (50/page cap).
 *
 * Returns: Map<netuid, {
 *   commits7d, commits1d, commits30d,
 *   prsOpened7d, prsMerged7d,
 *   issuesOpened7d, issuesClosed7d,
 *   reviews7d, comments7d,
 *   uniqueContributors7d,
 *   repoUrl, lastEventAt, daysSinceLastEvent
 * }>
 */
export async function fetchDevActivity() {
  const cached = getCached();
  if (cached) return cached;

  const map = {};

  try {
    // Fetch first page to get pagination info
    const first = await fetchPage(1);
    const totalPages = first.pagination?.total_pages || 1;
    const entries = Array.isArray(first.data) ? first.data : [];

    // Parse first page
    for (const e of entries) {
      if (e.netuid != null) map[e.netuid] = normalizeEntry(e);
    }

    // Fetch remaining pages sequentially to avoid 429
    for (let p = 2; p <= totalPages; p++) {
      const page = await fetchPage(p);
      const data = Array.isArray(page.data) ? page.data : [];
      for (const e of data) {
        if (e.netuid != null) map[e.netuid] = normalizeEntry(e);
      }
    }

    setCache(map);
  } catch (err) {
    // If we have stale cache, use it rather than failing
    const stale = getCached();
    if (stale) return stale;
    // Otherwise return empty map — Gem Scan will show subnets at 0 commits
    console.warn("Gem: dev_activity fetch failed:", err.message);
  }

  return map;
}

/**
 * Normalize a raw TaoStats dev_activity entry into our internal shape.
 * Uses camelCase keys and ensures all fields have safe defaults.
 */
function normalizeEntry(e) {
  return {
    commits7d:              e.commits_7d ?? 0,
    commits1d:              e.commits_1d ?? 0,
    commits30d:             e.commits_30d ?? 0,
    prsOpened7d:            e.prs_opened_7d ?? 0,
    prsMerged7d:            e.prs_merged_7d ?? 0,
    issuesOpened7d:         e.issues_opened_7d ?? 0,
    issuesClosed7d:         e.issues_closed_7d ?? 0,
    reviews7d:              e.reviews_7d ?? 0,
    comments7d:             e.comments_7d ?? 0,
    uniqueContributors7d:   e.unique_contributors_7d ?? 0,
    repoUrl:                e.repo_url || "",
    lastEventAt:            e.last_event_at || null,
    daysSinceLastEvent:     e.days_since_last_event ?? null,
  };
}
