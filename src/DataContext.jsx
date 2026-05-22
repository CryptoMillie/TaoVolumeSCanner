// Shared data context — single fetch for TaoStats + CoinGecko, localStorage persistence
import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { fetchSubnetLatest, fetchPoolLatest, fetchSubnetMeta } from "./sri/api.js";

const COINGECKO_CACHE_KEY = "tao_cg_cache";
const TAOSTATS_CACHE_KEY = "tao_ts_cache";
const CACHE_MAX_AGE_MS = 15 * 60 * 1000; // 15 min

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

// ─── Context ───────────────────────────────────────────────
const DataContext = createContext(null);

export function DataProvider({ children }) {
  // TaoStats shared data
  const [taoStats, setTaoStats] = useState(() => loadFromStorage(TAOSTATS_CACHE_KEY));
  const [coinGecko, setCoinGecko] = useState(() => loadFromStorage(COINGECKO_CACHE_KEY));
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState(null);
  const fetchingRef = useRef(false);

  // Fetch TaoStats data (subnet/latest + pool/latest + meta)
  const refreshTaoStats = useCallback(async () => {
    const [subnets, pools, meta] = await Promise.all([
      fetchSubnetLatest(),
      fetchPoolLatest(),
      fetchSubnetMeta(),
    ]);
    const data = { subnets, pools, meta };
    setTaoStats(data);
    saveToStorage(TAOSTATS_CACHE_KEY, data);
    return data;
  }, []);

  // Fetch CoinGecko data
  const refreshCoinGecko = useCallback(async () => {
    const data = await fetchCoinGecko();
    setCoinGecko(data);
    return data;
  }, []);

  // Refresh all shared data at once
  const refreshAll = useCallback(async () => {
    if (fetchingRef.current) {
      // Already fetching — wait for the underlying cached calls instead of returning stale state
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

  // Force-refresh CoinGecko (bypasses cache — for Volume Scanner auto-refresh)
  const forceRefreshCoinGecko = useCallback(async () => {
    cgCache = null;
    cgCacheTs = 0;
    const data = await refreshCoinGecko();
    return data;
  }, [refreshCoinGecko]);

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
