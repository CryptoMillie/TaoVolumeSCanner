// The Bar — chain + taostats data layer for the v440 emission gate.
//
// Reads SubnetMovingPrice, MinerBurned, SubnetEmissionEnabled, and the gate's
// own governance state (EmissionGateBar/EmissionBarQuantile/EmissionGateExponent)
// directly from Finney via raw WebSocket JSON-RPC — same low-level approach as
// src/conviction/api.js (twox128 prefix hashing, state_getKeysPaged enumeration,
// hand-rolled fixed-point decoding). Kept as a separate module rather than
// extracting a shared RPC lib, matching the existing per-feature-folder
// convention and avoiding any risk to the working conviction tab.
//
// Falls back to taostats (pool price, incentive_burn) if the chain is
// unreachable, and marks every row's data provenance so the UI never
// silently presents a proxy value as verified chain data.

import { xxhashAsHex } from "@polkadot/util-crypto";
import { fetchSubnetLatest, fetchPoolLatest, fetchSubnetMeta } from "../sri/api.js";
import { RPC_ENDPOINTS, RPC_TIMEOUT_MS, BATCH_SIZE, STAGGER_MS } from "../conviction/constants.js";
import {
  PALLET,
  STORAGE_SUBNET_MOVING_PRICE,
  STORAGE_MINER_BURNED,
  STORAGE_SUBNET_EMISSION_ENABLED,
  STORAGE_EMISSION_GATE_BAR,
  STORAGE_EMISSION_BAR_QUANTILE,
  STORAGE_EMISSION_GATE_EXPONENT,
  CACHE_TTL_MS,
} from "./constants.js";

// ─── In-memory + localStorage cache (matches conviction/api.js's shape) ───
const cache = {};
const CACHE_KEY = "bar_gate_chain_data";
const LS_KEY = "tao_bar_chain_cache";

function getCached() {
  const entry = cache[CACHE_KEY];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    delete cache[CACHE_KEY];
    return null;
  }
  return entry.data;
}

function setCache(data) {
  cache[CACHE_KEY] = { data, ts: Date.now() };
}

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

// ─── TAO/USD spot price (CoinGecko, free, no key) ───────────
// Duplicated from DataContext.jsx's private fetchTaoUsdPrice() rather than
// imported — this module is called as a plain async function outside React,
// same reasoning as duplicating conviction/api.js's RPC helpers above.
let taoUsdCache = null;
let taoUsdCacheTs = 0;

async function fetchTaoUsdPrice() {
  if (taoUsdCache && Date.now() - taoUsdCacheTs < CACHE_TTL_MS) return taoUsdCache;
  const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bittensor&vs_currencies=usd");
  if (!res.ok) throw new Error(`CoinGecko ${res.status}: ${res.statusText}`);
  const data = await res.json();
  const price = data?.bittensor?.usd ?? null;
  taoUsdCache = price;
  taoUsdCacheTs = Date.now();
  return price;
}

// ─── twox128 + storage key helpers (same approach as conviction/api.js) ───

function twox128(input) {
  return xxhashAsHex(input, 128).replace("0x", "");
}

function storagePrefix(pallet, item) {
  return "0x" + twox128(pallet) + twox128(item);
}

function hexToBytes(hex) {
  hex = hex.replace("0x", "");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function readU128LE(bytes, offset) {
  let v = 0n;
  for (let i = 0; i < 16; i++) {
    v |= BigInt(bytes[offset + i]) << BigInt(i * 8);
  }
  return v;
}

// ─── Fixed-point decoders (substrate-fixed crate: IxxFyy/UxxFyy encode as a
// two's-complement-if-signed, little-endian (xx+yy)-bit integer = raw *
// 2^yy). All three gate-related types here are 128-bit (16 bytes). ───

// U64F64 (theta/q/h) — 64 integer + 64 fractional bits. Split high/low like
// conviction/api.js's decodeLockState does for `conviction`, since a direct
// Number(raw) cast would exceed Number.MAX_SAFE_INTEGER for realistic values
// (e.g. h=3 encodes as 3 * 2^64, ~5.5e19).
function decodeU64F64(hex) {
  const bytes = hexToBytes(hex);
  const raw = readU128LE(bytes, 0);
  return Number(raw >> 64n) + Number(raw & 0xFFFFFFFFFFFFFFFFn) / 2 ** 64;
}

// U96F32 (MinerBurned) — 96 integer + 32 fractional bits, unsigned. Values
// are ratios in [0,1] so raw fits comfortably in a safe-integer float.
function decodeU96F32(hex) {
  const bytes = hexToBytes(hex);
  const raw = readU128LE(bytes, 0);
  return Number(raw) / 2 ** 32;
}

// I96F32 (SubnetMovingPrice) — 96 integer + 32 fractional bits, SIGNED
// (two's complement over the full 128 bits). Price is documented as capped
// at 1.0 and non-negative in practice, but decode correctly regardless.
function decodeI96F32(hex) {
  const bytes = hexToBytes(hex);
  let raw = readU128LE(bytes, 0);
  const SIGN_BIT = 1n << 127n;
  if (raw & SIGN_BIT) raw -= 1n << 128n;
  return Number(raw) / 2 ** 32;
}

function decodeBool(hex) {
  const bytes = hexToBytes(hex);
  return bytes.length > 0 && bytes[0] === 1;
}

// MAP(netuid) with Identity hasher — key layout: prefix(64 hex) + netuid
// u16 LE (4 hex) = 68 hex total. Identical pattern to conviction/api.js's
// extractNetuid().
function extractNetuid(key) {
  const hex = key.replace("0x", "");
  const lo = parseInt(hex.substring(hex.length - 4, hex.length - 2), 16);
  const hi = parseInt(hex.substring(hex.length - 2), 16);
  return lo | (hi << 8);
}

// ─── WebSocket JSON-RPC with failover (same as conviction/api.js) ───

function wsConnect(url, timeout = RPC_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket connection timeout"));
    }, timeout);

    ws.onopen = () => {
      clearTimeout(timer);
      resolve(ws);
    };
    ws.onerror = (e) => {
      clearTimeout(timer);
      reject(new Error("WebSocket error: " + (e.message || "connection failed")));
    };
  });
}

async function wsConnectWithFailover() {
  const errors = [];
  for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
    const endpoint = RPC_ENDPOINTS[i];
    try {
      const ws = await wsConnect(endpoint.url);
      return { ws, endpoint: endpoint.label };
    } catch (err) {
      errors.push(`${endpoint.label}: ${err.message}`);
    }
  }
  throw new Error(`Failed to connect to any Bittensor RPC endpoint. Tried:\n${errors.join("\n")}`);
}

let rpcId = 1;

function rpcCall(ws, method, params, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const id = rpcId++;
    const timer = setTimeout(() => reject(new Error("RPC timeout: " + method)), timeout);

    const handler = (event) => {
      try {
        const msg = JSON.parse(typeof event.data === "string" ? event.data : event);
        if (msg.id === id) {
          ws.removeEventListener("message", handler);
          clearTimeout(timer);
          if (msg.error) reject(new Error("RPC error: " + JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      } catch { /* ignore parse errors for subscription messages */ }
    };

    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}

async function fetchCurrentBlock(ws) {
  const header = await rpcCall(ws, "chain_getHeader", []);
  return parseInt(header.number, 16);
}

async function fetchAllStorageEntries(ws, prefix) {
  const keys = [];
  let startKey = prefix;
  while (true) {
    const batch = await rpcCall(ws, "state_getKeysPaged", [prefix, 100, startKey]);
    if (!batch || batch.length === 0) break;
    keys.push(...batch);
    if (batch.length < 100) break;
    startKey = batch[batch.length - 1];
  }

  const entries = [];
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((key) => rpcCall(ws, "state_getStorage", [key]).catch(() => null))
    );
    results.forEach((val, idx) => {
      if (val) entries.push({ key: batch[idx], value: val });
    });
    if (i + BATCH_SIZE < keys.length) {
      await new Promise((r) => setTimeout(r, STAGGER_MS));
    }
  }
  return entries;
}

async function fetchSingleValue(ws, prefix) {
  return rpcCall(ws, "state_getStorage", [prefix]).catch(() => null);
}

// ─── Main chain fetch ─────────────────────────────────────────

async function fetchGateChainData() {
  const { ws, endpoint } = await wsConnectWithFailover();
  try {
    const currentBlock = await fetchCurrentBlock(ws);

    const movingPricePrefix = storagePrefix(PALLET, STORAGE_SUBNET_MOVING_PRICE);
    const minerBurnedPrefix = storagePrefix(PALLET, STORAGE_MINER_BURNED);
    const emissionEnabledPrefix = storagePrefix(PALLET, STORAGE_SUBNET_EMISSION_ENABLED);
    const gateBarKey = storagePrefix(PALLET, STORAGE_EMISSION_GATE_BAR); // StorageValue, no map suffix
    const quantileKey = storagePrefix(PALLET, STORAGE_EMISSION_BAR_QUANTILE);
    const exponentKey = storagePrefix(PALLET, STORAGE_EMISSION_GATE_EXPONENT);

    const [priceEntries, burnedEntries, enabledEntries, gateBarRaw, quantileRaw, exponentRaw] =
      await Promise.all([
        fetchAllStorageEntries(ws, movingPricePrefix),
        fetchAllStorageEntries(ws, minerBurnedPrefix),
        fetchAllStorageEntries(ws, emissionEnabledPrefix),
        fetchSingleValue(ws, gateBarKey),
        fetchSingleValue(ws, quantileKey),
        fetchSingleValue(ws, exponentKey),
      ]);

    const movingPriceMap = {};
    for (const e of priceEntries) movingPriceMap[extractNetuid(e.key)] = decodeI96F32(e.value);

    const minerBurnedMap = {};
    for (const e of burnedEntries) minerBurnedMap[extractNetuid(e.key)] = decodeU96F32(e.value);

    const emissionEnabledMap = {};
    for (const e of enabledEntries) emissionEnabledMap[extractNetuid(e.key)] = decodeBool(e.value);

    // On-chain theta/q/h — authoritative, used both directly and as the
    // reconciliation target for our own gate.js computeTheta()/applyGate().
    const onChainTheta = gateBarRaw ? decodeU64F64(gateBarRaw) : 0;
    const onChainQ = quantileRaw ? decodeU64F64(quantileRaw) : null;
    const onChainH = exponentRaw ? decodeU64F64(exponentRaw) : null;

    return {
      movingPriceMap,
      minerBurnedMap,
      emissionEnabledMap,
      onChainTheta,
      onChainQ,
      onChainH,
      currentBlock,
      rpcEndpoint: endpoint,
      fetchedAt: Date.now(),
      source: "chain",
    };
  } finally {
    try { ws.close(); } catch { /* ignore */ }
  }
}

/**
 * Fetch every input the gate needs: chain data (moving price, miner burned,
 * emission-enabled, on-chain theta/q/h) with a taostats-proxy fallback if
 * the chain is unreachable, plus taostats subnet/pool/meta for names, market
 * cap, and the on-chain `emission` figure used by the reconciliation panel.
 * Root (netuid 0) is always excluded — it's infrastructure, not a subnet
 * competing for emission share.
 */
export async function fetchBarInputs({ force = false } = {}) {
  if (!force) {
    const cached = getCached();
    if (cached) return cached;
    const stored = loadFromStorage();
    if (stored) {
      setCache(stored);
      return stored;
    }
  }

  const [subnetsRaw, poolsRaw, meta] = await Promise.all([
    fetchSubnetLatest(),
    fetchPoolLatest(),
    fetchSubnetMeta(),
  ]);
  const subnets = Array.isArray(subnetsRaw) ? subnetsRaw : (subnetsRaw?.data || []);
  const pools = Array.isArray(poolsRaw) ? poolsRaw : (poolsRaw?.data || []);
  const poolMap = {};
  pools.forEach((p) => {
    const id = p.netuid ?? p.subnet_id;
    if (id != null) poolMap[id] = p;
  });

  let chain = null;
  let chainError = null;
  try {
    chain = await fetchGateChainData();
  } catch (err) {
    chainError = err.message;
  }

  function num(v) {
    if (v == null) return 0;
    const n = typeof v === "string" ? parseFloat(v) : v;
    return isNaN(n) ? 0 : n;
  }

  function resolveName(subnet, pool, netuid) {
    if (pool?.name && pool.name !== "Unknown") return pool.name;
    const metaEntry = meta[String(netuid)];
    if (metaEntry?.name) return metaEntry.name;
    if (subnet.name && subnet.name !== "Unknown") return subnet.name;
    return `Subnet ${netuid}`;
  }

  const rows = [];
  for (const s of subnets) {
    const netuid = s.netuid ?? s.subnet_id;
    if (netuid === 0 || netuid == null) continue; // root excluded

    const pool = poolMap[netuid] || null;

    let movingPrice, priceSource;
    if (chain && netuid in chain.movingPriceMap) {
      movingPrice = chain.movingPriceMap[netuid];
      priceSource = "chain";
    } else {
      movingPrice = pool ? num(pool.price || pool.alpha_price) : 0;
      priceSource = "proxy";
    }

    let minerBurn, burnSource;
    if (chain && netuid in chain.minerBurnedMap) {
      minerBurn = chain.minerBurnedMap[netuid];
      burnSource = "chain";
    } else {
      minerBurn = num(s.incentive_burn);
      burnSource = "proxy";
    }

    let emissionEnabled;
    if (chain && netuid in chain.emissionEnabledMap) {
      emissionEnabled = chain.emissionEnabledMap[netuid];
    } else {
      // On-chain default is `true` (DefaultTrue) — mirror that when we can't
      // read the map directly rather than guessing false.
      emissionEnabled = true;
    }

    rows.push({
      netuid,
      name: resolveName(s, pool, netuid),
      logo: meta[String(netuid)]?.image_url || null,
      movingPrice,
      priceSource,
      minerBurn,
      burnSource,
      emissionEnabled,
      marketCap: pool ? num(pool.market_cap) : 0, // raw, rao-scale TAO — see lib/emissionPerCap.js for USD conversion
      onChainEmission: num(s.emission),
      // Emission-per-cap disambiguation inputs (added 2026-07-29). Both come
      // straight from the same taostats pool record already being fetched —
      // fear_and_greed_index is what's referred to as "SI" throughout the
      // app, confirmed empirically against live subnet data.
      si: pool && pool.fear_and_greed_index != null ? num(pool.fear_and_greed_index) : null,
      change1M: pool && pool.price_change_1_month != null ? num(pool.price_change_1_month) : null,
    });
  }

  const totalOnChainEmission = rows.reduce((a, r) => a + r.onChainEmission, 0);

  let taoUsdPrice = null;
  try {
    taoUsdPrice = await fetchTaoUsdPrice();
  } catch {
    // non-critical — emissionPerCap just can't be computed this refresh
  }

  const data = {
    rows,
    totalOnChainEmission,
    taoUsdPrice,
    onChainTheta: chain?.onChainTheta ?? null,
    onChainQ: chain?.onChainQ ?? null,
    onChainH: chain?.onChainH ?? null,
    rpcEndpoint: chain?.rpcEndpoint ?? null,
    currentBlock: chain?.currentBlock ?? null,
    chainAvailable: !!chain,
    chainError,
    fetchedAt: Date.now(),
  };

  setCache(data);
  saveToStorage(data);
  return data;
}

export async function forceRefreshBarInputs() {
  delete cache[CACHE_KEY];
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  return fetchBarInputs({ force: true });
}
