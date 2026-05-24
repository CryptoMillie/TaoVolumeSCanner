// Shared data context — single fetch for TaoStats + CoinGecko, localStorage persistence
// + request deduplication + retry with exponential backoff
import { createContext, useContext, useState, useCallback, useRef } from "react";
import { fetchSubnetLatest, fetchPoolLatest, fetchSubnetMeta } from "./sri/api.js";

const COINGECKO_CACHE_KEY = "tao_cg_cache";
const TAOSTATS_CACHE_KEY = "tao_ts_cache";
const CACHE_MAX_AGE_MS = 15 * 60 * 1000; // 15 min
const CG_MIN_INTERVAL_MS = 60 * 1000; // 60s floor — CoinGecko free tier only updates ~60s

// ─── localStorage persistence ──────────────────────────────
function loadFromStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function saveToStorage(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // localStorage full or unavailable — non-critical
  }
}

// ─── Retry wrapper ─────────────────────────────────────────
async function fetchWithRetry(fetchFn, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetchFn();
    } catch (err) {
      if (i < retries && /429|500|502|503/.test(err.message)) {
        await new Promise(r => setTimeout(r, 1000 * 2 ** i));
      } else {
        throw err;
      }
    }
  }
}

// ─── CoinGecko fetch with in-memory + localStorage cache ───
let cgCache = null;
let cgCacheTs = 0;

async function fetchCoinGecko() {
  // In-memory cache check
  if (cgCache && Date.now() - cgCacheTs < CACHE_MAX_AGE_MS) return cgCache;

  const url = "https://api.coingecko.com/api/v3/coins/markets?" + new URLSearchParams({
    vs_currency: "usd",
    category: "bittensor-subnets",
    order: "volume_desc",
    per_page: "100",
    page: "1",
    sparkline: "false",
    price_change_percentage: "24h,7d",
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko ${res.status}: ${res.statusText}`);
  const data = await res.json();
  cgCache = data;
  cgCacheTs = Date.now();
  saveToStorage(COINGECKO_CACHE_KEY, data);
  return data;
}

// ─── Request deduplication ─────────────────────────────────
// Prevents duplicate concurrent requests for the same data
const inFlight = {};

function deduplicatedFetch(key, fetchFn) {
  if (inFlight[key]) return inFlight[key];
  inFlight[key] = fetchFn().finally(() => { delete inFlight[key]; });
  return inFlight[key];
}

// ─── Context ───────────────────────────────────────────────
const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [taoStats, setTaoStats] = useState(() => loadFromStorage(TAOSTATS_CACHE_KEY));
  const [coinGecko, setCoinGecko] = useState(() => loadFromStorage(COINGECKO_CACHE_KEY));
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState(null);
  const fetchingRef = useRef(false);

  // Fetch TaoStats data (deduplicated + retry)
  const refreshTaoStats = useCallback(async () => {
    return deduplicatedFetch("taostats", async () => {
      const [subnets, pools, meta] = await Promise.all([
        fetchWithRetry(() => fetchSubnetLatest()),
        fetchWithRetry(() => fetchPoolLatest()),
        fetchWithRetry(() => fetchSubnetMeta()),
      ]);
      const data = { subnets, pools, meta };
      setTaoStats(data);
      saveToStorage(TAOSTATS_CACHE_KEY, data);
      return data;
    });
  }, []);

  // Fetch CoinGecko data (deduplicated + retry)
  const refreshCoinGecko = useCallback(async () => {
    return deduplicatedFetch("coingecko", async () => {
      const data = await fetchWithRetry(() => fetchCoinGecko());
      setCoinGecko(data);
      return data;
    });
  }, []);

  // Refresh all shared data at once
  const refreshAll = useCallback(async () => {
    if (fetchingRef.current) {
      const [ts, cg] = await Promise.all([refreshTaoStats(), refreshCoinGecko()]);
      return { taoStats: ts, coinGecko: cg };
    }
    fetchingRef.current = true;
    setLoading(true);
    try {
      const [ts, cg] = await Promise.all([
        refreshTaoStats(),
        refreshCoinGecko(),
      ]);
      setLastFetch(Date.now());
      return { taoStats: ts, coinGecko: cg };
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [refreshTaoStats, refreshCoinGecko]);

  // Force-refresh CoinGecko — with 60s minimum interval to avoid wasting quota
  const forceRefreshCoinGecko = useCallback(async () => {
    if (cgCacheTs && Date.now() - cgCacheTs < CG_MIN_INTERVAL_MS) {
      // Data is less than 60s old — return cached without re-fetching
      return cgCache || coinGecko;
    }
    cgCache = null;
    cgCacheTs = 0;
    const data = await refreshCoinGecko();
    return data;
  }, [refreshCoinGecko, coinGecko]);

  const value = {
    taoStats,
    coinGecko,
    loading,
    lastFetch,
    refreshTaoStats,
    refreshCoinGecko,
    refreshAll,
    forceRefreshCoinGecko,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useSharedData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useSharedData must be used within DataProvider");
  return ctx;
}
