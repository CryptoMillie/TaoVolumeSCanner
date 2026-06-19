// SRI API Layer — TaoStats + GitHub subnet metadata with 15-min cache
// Global request queue to avoid hammering TaoStats across multiple scanners

import { CACHE_TTL_MS } from "./constants.js";

const API_KEY = import.meta.env.VITE_TAOSTATS_API_KEY || "";

const cache = {};

function getCached(key) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    delete cache[key];
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache[key] = { data, ts: Date.now() };
}

// ─── Global TaoStats request queue ─────────────────────────
// Enforces a minimum gap between requests to stay under rate limits.
const REQUEST_GAP_MS = 1200; // ~50 req/min max across entire app
let lastRequestTs = 0;
let requestQueue = Promise.resolve();

function enqueueRequest(fn) {
  requestQueue = requestQueue.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, REQUEST_GAP_MS - (now - lastRequestTs));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequestTs = Date.now();
    return fn();
  });
  return requestQueue;
}

async function fetchWithAuth(url) {
  return enqueueRequest(async () => {
    const headers = {};
    if (API_KEY) {
      headers["Authorization"] = API_KEY;
    }
    const res = await fetch(url, { headers });
    if (res.status === 401 || res.status === 429) {
      // Back off and retry once on auth/rate errors
      await new Promise(r => setTimeout(r, 5000));
      lastRequestTs = Date.now();
      const retry = await fetch(url, { headers });
      if (!retry.ok) throw new Error(`TaoStats ${retry.status}: ${retry.statusText}`);
      return retry.json();
    }
    if (!res.ok) throw new Error(`TaoStats ${res.status}: ${res.statusText}`);
    return res.json();
  });
}

export async function fetchSubnetLatest() {
  const key = "subnet_latest";
  const cached = getCached(key);
  if (cached) return cached;

  const data = await fetchWithAuth(
    "https://api.taostats.io/api/subnet/latest/v1?limit=200"
  );
  setCache(key, data);
  return data;
}

export async function fetchPoolLatest() {
  const key = "pool_latest";
  const cached = getCached(key);
  if (cached) return cached;

  const data = await fetchWithAuth(
    "https://api.taostats.io/api/dtao/pool/latest/v1?limit=200"
  );
  setCache(key, data);
  return data;
}

export async function fetchSubnetMeta() {
  const key = "subnet_meta";
  const cached = getCached(key);
  if (cached) return cached;

  try {
    const res = await fetch(
      "https://raw.githubusercontent.com/taostat/subnets-infos/main/subnets.json"
    );
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const raw = await res.json();
    // Build lookup: netuid (number) -> { name, image_url, github }
    const meta = {};
    for (const [id, info] of Object.entries(raw)) {
      meta[id] = {
        name: info.name || null,
        image_url: info.image_url || null,
        github: info.github || null,
      };
    }
    setCache(key, meta);
    return meta;
  } catch {
    // Non-critical — return empty map if GitHub is unreachable
    return {};
  }
}

async function fetchMechData(netuid) {
  const key = `mech_${netuid}`;
  const cached = getCached(key);
  if (cached) return cached;

  try {
    const data = await fetchWithAuth(
      `https://api.taostats.io/api/subnet/latest/v1?netuid=${netuid}&mechid=1`
    );
    const arr = Array.isArray(data) ? data : (data?.data || []);
    if (arr.length === 0) return null;
    const entry = arr[0];
    const av = parseFloat(entry.active_validators) || 0;
    const am = parseFloat(entry.active_miners) || 0;
    if (av === 0 && am === 0) return null;
    setCache(key, entry);
    return entry;
  } catch {
    return null;
  }
}

export async function fetchMechDataMap(subnetsRaw) {
  const BATCH_SIZE = 3;
  const subnets = Array.isArray(subnetsRaw) ? subnetsRaw : (subnetsRaw?.data || []);
  const map = {};

  // Resolve cached entries immediately
  const uncached = [];
  for (const s of subnets) {
    const netuid = s.netuid ?? s.subnet_id;
    const cached = getCached(`mech_${netuid}`);
    if (cached) {
      map[netuid] = cached;
    } else {
      uncached.push(netuid);
    }
  }

  // Fetch uncached in small sequential batches (global queue handles spacing)
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(netuid => fetchMechData(netuid))
    );
    results.forEach((result, idx) => {
      if (result.status === "fulfilled" && result.value != null) {
        map[batch[idx]] = result.value;
      }
    });
  }
  return map;
}

export async function fetchColdkeyDistribution(netuid) {
  const key = `coldkey_dist_${netuid}`;
  const cached = getCached(key);
  if (cached) return cached;

  // Use global queue + retry on 401/429
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const data = await fetchWithAuth(
        `https://api.taostats.io/api/subnet/distribution/coldkey/v1?netuid=${netuid}&limit=500`
      );
      setCache(key, data);
      return data;
    } catch (err) {
      const is401or429 = /401|429/.test(err.message);
      if (is401or429 && attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 8000 * Math.pow(2, attempt)));
        continue;
      }
      return null;
    }
  }
  return null;
}

/**
 * Fetch coldkey distribution for all netuids sequentially with rate-limit awareness.
 * Uses small batches with generous delays to stay within TaoStats rate limits (~5 req/min).
 * Returns a map: netuid -> { uniqueColdkeys, totalCount, entries[] }
 */
export async function fetchColdkeyDistributionMap(netuids, onProgress) {
  const BATCH_SIZE = 3;
  const STAGGER_MS = 2000; // Global queue handles per-request spacing; this just adds batch breathing room
  const map = {};
  let failed = 0;

  // Resolve cached netuids immediately — skip the API for these
  const uncached = [];
  for (const netuid of netuids) {
    const cached = getCached(`coldkey_dist_${netuid}`);
    if (cached != null) {
      const entries = Array.isArray(cached) ? cached : (cached?.data || []);
      map[netuid] = { uniqueColdkeys: entries.length, totalCount: entries.reduce((sum, e) => sum + (e.count || 0), 0), entries };
    } else {
      uncached.push(netuid);
    }
  }

  let fetched = 0;
  if (onProgress) onProgress({ completed: netuids.length - uncached.length, total: netuids.length, failed, map: { ...map } });

  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(netuid => fetchColdkeyDistribution(netuid))
    );
    results.forEach((result, idx) => {
      const netuid = batch[idx];
      fetched++;
      if (result.status === "fulfilled" && result.value != null) {
        const raw = result.value;
        const entries = Array.isArray(raw) ? raw : (raw?.data || []);
        map[netuid] = { uniqueColdkeys: entries.length, totalCount: entries.reduce((sum, e) => sum + (e.count || 0), 0), entries };
      } else {
        failed++;
      }
    });
    if (onProgress) onProgress({ completed: netuids.length - uncached.length + fetched, total: netuids.length, failed, map: { ...map } });
    if (i + BATCH_SIZE < uncached.length) {
      await new Promise(r => setTimeout(r, STAGGER_MS));
    }
  }
  return map;
}

export async function fetchAllSRIData() {
  const [subnets, pools, meta] = await Promise.all([
    fetchSubnetLatest(),
    fetchPoolLatest(),
    fetchSubnetMeta(),
  ]);
  return { subnets, pools, meta };
}
