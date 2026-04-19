// SRI API Layer — TaoStats + GitHub subnet metadata with 15-min cache

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

async function fetchWithAuth(url) {
  const headers = {};
  if (API_KEY) {
    headers["Authorization"] = API_KEY;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`TaoStats ${res.status}: ${res.statusText}`);
  return res.json();
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
    // Build lookup: netuid (number) -> { name, image_url }
    const meta = {};
    for (const [id, info] of Object.entries(raw)) {
      meta[id] = {
        name: info.name || null,
        image_url: info.image_url || null,
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
    return entry;
  } catch {
    return null;
  }
}

export async function fetchMechDataMap(subnetsRaw) {
  const subnets = Array.isArray(subnetsRaw) ? subnetsRaw : (subnetsRaw?.data || []);
  const map = {};
  const results = await Promise.all(
    subnets.map(async (s) => {
      const netuid = s.netuid ?? s.subnet_id;
      const data = await fetchMechData(netuid);
      return { netuid, data };
    })
  );
  results.forEach(({ netuid, data }) => {
    if (data) map[netuid] = data;
  });
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
