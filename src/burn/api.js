// Burn Scanner API Layer — Pool history with dual-layer cache

import { CACHE_TTL_MS, BATCH_SIZE, STAGGER_MS } from "./constants.js";

const API_KEY = import.meta.env.VITE_TAOSTATS_API_KEY || "";

// ─── In-memory cache ──────────────────────────────────────
const cache = {};
const CACHE_KEY = "burn_data";

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

// ─── localStorage persistence ─────────────────────────────
const LS_KEY = "tao_burn_cache";

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) {
      localStorage.removeItem(LS_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function saveToStorage(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // non-critical
  }
}

// ─── Authenticated fetch ──────────────────────────────────
async function fetchWithAuth(url) {
  const headers = {};
  if (API_KEY) {
    headers["Authorization"] = API_KEY;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`TaoStats ${res.status}: ${res.statusText}`);
  return res.json();
}

// ─── Single subnet pool history ───────────────────────────
export async function fetchPoolHistory(netuid) {
  const key = `pool_history_${netuid}`;
  const cached = getCached(key);
  if (cached) return cached;

  const data = await fetchWithAuth(
    `https://api.taostats.io/api/dtao/pool/history/v1?limit=30&netuid=${netuid}`
  );
  setCache(key, data);
  return data;
}

// ─── Batch fetch all pool histories (staggered) ───────────
export async function fetchAllPoolHistory(subnets) {
  const arr = Array.isArray(subnets) ? subnets : (subnets?.data || []);

  // Filter to subnets with non-zero emission
  const netuids = arr
    .map((s) => {
      const netuid = s.netuid ?? s.subnet_id;
      const emission = parseFloat(s.emission) || 0;
      return { netuid, emission };
    })
    .filter((s) => s.emission > 0)
    .map((s) => s.netuid);

  const map = {};

  for (let i = 0; i < netuids.length; i += BATCH_SIZE) {
    const batch = netuids.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((netuid) => fetchPoolHistory(netuid))
    );
    results.forEach((result, idx) => {
      const netuid = batch[idx];
      if (result.status === "fulfilled") {
        const raw = result.value;
        const entries = Array.isArray(raw) ? raw : (raw?.data || []);
        if (entries.length > 0) {
          map[netuid] = entries;
        }
      }
    });
    if (i + BATCH_SIZE < netuids.length) {
      await new Promise((r) => setTimeout(r, STAGGER_MS));
    }
  }
  return map;
}

// ─── Main export: fetch burn data with caching ────────────
export async function fetchBurnData(subnets) {
  // Check in-memory cache
  const cached = getCached(CACHE_KEY);
  if (cached) return cached;

  // Check localStorage
  const stored = loadFromStorage();
  if (stored) {
    setCache(CACHE_KEY, stored);
    return stored;
  }

  // Fresh fetch
  const historyMap = await fetchAllPoolHistory(subnets);
  const data = { historyMap, fetchedAt: Date.now() };

  setCache(CACHE_KEY, data);
  saveToStorage(data);
  return data;
}

// ─── Force refresh (bypass cache) ─────────────────────────
export async function forceRefreshBurn(subnets) {
  delete cache[CACHE_KEY];
  // Clear per-netuid caches too
  Object.keys(cache).forEach((k) => {
    if (k.startsWith("pool_history_")) delete cache[k];
  });
  localStorage.removeItem(LS_KEY);
  return fetchBurnData(subnets);
}
