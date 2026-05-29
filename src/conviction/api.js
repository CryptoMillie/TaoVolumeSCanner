// Conviction Locks RPC Layer — raw WebSocket JSON-RPC to Finney
// Queries OwnerLock + DecayingOwnerLock storage maps via state_getKeysPaged + state_getStorage

import {
  FINNEY_WS,
  MAX_NETUIDS,
  BATCH_SIZE,
  STAGGER_MS,
  CACHE_TTL_MS,
  PALLET,
  STORAGE_OWNER_LOCK,
  STORAGE_DECAYING_OWNER_LOCK,
  STORAGE_HOTKEY_LOCK,
  BLOCKS_PER_DAY,
} from "./constants.js";

// ─── In-memory cache ──────────────────────────────────────
const cache = {};
const CACHE_KEY = "conviction_locks";

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

// ─── localStorage persistence ─────────────────────────────
const LS_KEY = "tao_conviction_cache";

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

// ─── twox128 hash (pure JS, no dependencies) ─────────────
// xxHash64 implementation for Substrate storage key computation
// Substrate uses twox128 = xxHash64(seed=0) ++ xxHash64(seed=1)

const PRIME1 = 0x9E3779B185EBCA87n;
const PRIME2 = 0x14DEF9DEA2F79CD6n;
const PRIME3 = 0x0000000165868003n; // not used in round
const PRIME5 = 0x27D4EB2F165B7D62n;

function rotl64(v, n) {
  n = BigInt(n);
  return ((v << n) | (v >> (64n - n))) & 0xFFFFFFFFFFFFFFFFn;
}

function xxh64Round(acc, input) {
  acc = (acc + input * PRIME2) & 0xFFFFFFFFFFFFFFFFn;
  acc = rotl64(acc, 31);
  acc = (acc * PRIME1) & 0xFFFFFFFFFFFFFFFFn;
  return acc;
}

function xxh64MergeRound(acc, val) {
  val = xxh64Round(0n, val);
  acc = (acc ^ val) & 0xFFFFFFFFFFFFFFFFn;
  acc = (acc * PRIME1 + 0x0000000085EBCA77n) & 0xFFFFFFFFFFFFFFFFn; // PRIME4 partial
  return acc;
}

function readU64LE_bigint(bytes, offset) {
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    v |= BigInt(bytes[offset + i]) << BigInt(i * 8);
  }
  return v;
}

function readU32LE_bigint(bytes, offset) {
  let v = 0n;
  for (let i = 0; i < 4; i++) {
    v |= BigInt(bytes[offset + i]) << BigInt(i * 8);
  }
  return v;
}

function xxhash64(input, seed) {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input;
  const len = bytes.length;
  let h;
  let p = 0;

  if (len >= 32) {
    let v1 = (seed + PRIME1 + PRIME2) & 0xFFFFFFFFFFFFFFFFn;
    let v2 = (seed + PRIME2) & 0xFFFFFFFFFFFFFFFFn;
    let v3 = seed;
    let v4 = (seed - PRIME1) & 0xFFFFFFFFFFFFFFFFn;

    const limit = len - 32;
    while (p <= limit) {
      v1 = xxh64Round(v1, readU64LE_bigint(bytes, p)); p += 8;
      v2 = xxh64Round(v2, readU64LE_bigint(bytes, p)); p += 8;
      v3 = xxh64Round(v3, readU64LE_bigint(bytes, p)); p += 8;
      v4 = xxh64Round(v4, readU64LE_bigint(bytes, p)); p += 8;
    }

    h = rotl64(v1, 1) + rotl64(v2, 7) + rotl64(v3, 12) + rotl64(v4, 18);
    h &= 0xFFFFFFFFFFFFFFFFn;

    h = xxh64MergeRound(h, v1);
    h = xxh64MergeRound(h, v2);
    h = xxh64MergeRound(h, v3);
    h = xxh64MergeRound(h, v4);
  } else {
    h = (seed + PRIME5) & 0xFFFFFFFFFFFFFFFFn;
  }

  h = (h + BigInt(len)) & 0xFFFFFFFFFFFFFFFFn;

  // Remaining bytes
  const end = len;
  while (p + 8 <= end) {
    const k1 = xxh64Round(0n, readU64LE_bigint(bytes, p));
    h = (rotl64(h ^ k1, 27) * PRIME1 + 0x0000000085EBCA77n) & 0xFFFFFFFFFFFFFFFFn;
    p += 8;
  }

  if (p + 4 <= end) {
    h = (h ^ (readU32LE_bigint(bytes, p) * PRIME1)) & 0xFFFFFFFFFFFFFFFFn;
    h = (rotl64(h, 23) * PRIME2 + 0x0000000165868003n) & 0xFFFFFFFFFFFFFFFFn;
    p += 4;
  }

  while (p < end) {
    h = (h ^ (BigInt(bytes[p]) * PRIME5)) & 0xFFFFFFFFFFFFFFFFn;
    h = (rotl64(h, 11) * PRIME1) & 0xFFFFFFFFFFFFFFFFn;
    p += 1;
  }

  // Avalanche
  h = ((h ^ (h >> 33n)) * PRIME2) & 0xFFFFFFFFFFFFFFFFn;
  h = ((h ^ (h >> 29n)) * 0x0000000165868003n) & 0xFFFFFFFFFFFFFFFFn;
  h = (h ^ (h >> 32n)) & 0xFFFFFFFFFFFFFFFFn;

  return h;
}

function bigintToHexLE(v, byteLen) {
  const arr = [];
  for (let i = 0; i < byteLen; i++) {
    arr.push(Number((v >> BigInt(i * 8)) & 0xFFn).toString(16).padStart(2, "0"));
  }
  return arr.join("");
}

function twox128(input) {
  const h0 = xxhash64(input, 0n);
  const h1 = xxhash64(input, 1n);
  return bigintToHexLE(h0, 8) + bigintToHexLE(h1, 8);
}

// ─── Storage key helpers ──────────────────────────────────

function storagePrefix(pallet, item) {
  return "0x" + twox128(pallet) + twox128(item);
}

// For MAP(netuid) — Substrate Blake2_128Concat hasher
// The key suffix is: blake2_128(netuid_le_u16) ++ netuid_le_u16
// But OwnerLock on-chain actually uses twox64_concat for MAP keys
// We'll enumerate via state_getKeysPaged instead of computing keys directly

// ─── LockState decoding ──────────────────────────────────
// LockState { locked_mass: u64, conviction: U64F64 (u128), last_update: u64 } = 32 bytes

function hexToBytes(hex) {
  hex = hex.replace("0x", "");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function readU64LE(bytes, offset) {
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    v |= BigInt(bytes[offset + i]) << BigInt(i * 8);
  }
  return v;
}

function readU128LE(bytes, offset) {
  let v = 0n;
  for (let i = 0; i < 16; i++) {
    v |= BigInt(bytes[offset + i]) << BigInt(i * 8);
  }
  return v;
}

function decodeLockState(hexStr) {
  const bytes = hexToBytes(hexStr);
  if (bytes.length !== 32) return null;

  const lockedMassRaw = readU64LE(bytes, 0);
  const convictionRaw = readU128LE(bytes, 8);
  const lastUpdate = readU64LE(bytes, 24);

  // locked_mass is in rao (1e9 rao = 1 TAO/alpha)
  // conviction is U64F64 fixed point — integer part is upper 64 bits
  const lockedMass = Number(lockedMassRaw) / 1e9;
  const conviction = Number(convictionRaw >> 64n) + Number(convictionRaw & 0xFFFFFFFFFFFFFFFFn) / (2 ** 64);

  return {
    locked_mass: lockedMass,
    conviction,
    last_update: Number(lastUpdate),
    locked_mass_raw: lockedMassRaw,
    conviction_raw: convictionRaw,
  };
}

// ─── WebSocket JSON-RPC ───────────────────────────────────

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket connection timeout"));
    }, 15000);

    ws.onopen = () => {
      clearTimeout(timeout);
      resolve(ws);
    };
    ws.onerror = (e) => {
      clearTimeout(timeout);
      reject(new Error("WebSocket error: " + (e.message || "connection failed")));
    };
  });
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
          if (msg.error) {
            reject(new Error("RPC error: " + JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
        }
      } catch { /* ignore parse errors for subscription messages */ }
    };

    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}

// ─── Fetch current block number ───────────────────────────
async function fetchCurrentBlock(ws) {
  const header = await rpcCall(ws, "chain_getHeader", []);
  return parseInt(header.number, 16);
}

// ─── Enumerate all entries for a storage map via prefix ───
async function fetchAllStorageEntries(ws, prefix) {
  const keys = [];
  let startKey = prefix;

  // Paginate through all keys
  while (true) {
    const batch = await rpcCall(ws, "state_getKeysPaged", [prefix, 100, startKey]);
    if (!batch || batch.length === 0) break;
    keys.push(...batch);
    if (batch.length < 100) break;
    startKey = batch[batch.length - 1];
  }

  // Fetch values for all keys in batches
  const entries = [];
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((key) => rpcCall(ws, "state_getStorage", [key]).catch(() => null))
    );
    results.forEach((val, idx) => {
      if (val) {
        entries.push({ key: batch[idx], value: val });
      }
    });
    if (i + BATCH_SIZE < keys.length) {
      await new Promise((r) => setTimeout(r, STAGGER_MS));
    }
  }

  return entries;
}

// ─── Extract netuid from MAP key ──────────────────────────
// MAP keys: prefix(32 bytes hex = 64 chars) + hasher_output + netuid_le_u16
// The last 2 bytes of the key are the u16 netuid in little-endian
function extractNetuid(key) {
  const hex = key.replace("0x", "");
  // Last 4 hex chars = 2 bytes = u16 LE netuid
  const lo = parseInt(hex.substring(hex.length - 4, hex.length - 2), 16);
  const hi = parseInt(hex.substring(hex.length - 2), 16);
  return lo | (hi << 8);
}

// ─── Main fetch function ─────────────────────────────────

export async function fetchConvictionData(subnetMeta) {
  // Check cache first
  const cached = getCached();
  if (cached) return cached;

  // Check localStorage
  const stored = loadFromStorage();
  if (stored) {
    setCache(stored);
    return stored;
  }

  let ws;
  try {
    ws = wsConnect(FINNEY_WS);
    ws = await ws;
  } catch (err) {
    throw new Error("Failed to connect to Bittensor RPC: " + err.message);
  }

  try {
    // Fetch current block for age calculation
    const currentBlock = await fetchCurrentBlock(ws);

    // Fetch OwnerLock and DecayingOwnerLock entries in parallel
    const ownerPrefix = storagePrefix(PALLET, STORAGE_OWNER_LOCK);
    const decayingPrefix = storagePrefix(PALLET, STORAGE_DECAYING_OWNER_LOCK);

    const [ownerEntries, decayingEntries] = await Promise.all([
      fetchAllStorageEntries(ws, ownerPrefix),
      fetchAllStorageEntries(ws, decayingPrefix),
    ]);

    // Build lock map: netuid -> { lockState, lockType }
    const lockMap = {};

    // Perpetual owner locks
    for (const entry of ownerEntries) {
      const netuid = extractNetuid(entry.key);
      const state = decodeLockState(entry.value);
      if (state) {
        lockMap[netuid] = {
          ...state,
          lockType: "perpetual",
          rawKey: entry.key,
          rawValue: entry.value,
        };
      }
    }

    // Decaying owner locks — merge (some subnets may have both; decaying takes secondary priority)
    for (const entry of decayingEntries) {
      const netuid = extractNetuid(entry.key);
      const state = decodeLockState(entry.value);
      if (state) {
        if (!lockMap[netuid]) {
          lockMap[netuid] = {
            ...state,
            lockType: "decaying",
            rawKey: entry.key,
            rawValue: entry.value,
          };
        } else {
          // Subnet has both perpetual and decaying — store decaying as secondary
          lockMap[netuid].decayingLock = state;
        }
      }
    }

    // Build results for all subnets 0-127
    const results = [];
    for (let netuid = 0; netuid < MAX_NETUIDS; netuid++) {
      const lock = lockMap[netuid] || null;
      const meta = subnetMeta?.[String(netuid)] || null;

      const entry = {
        netuid,
        name: meta?.name || null,
        hasLock: !!lock,
        locked_mass: lock ? lock.locked_mass : 0,
        conviction: lock ? lock.conviction : 0,
        last_update: lock ? lock.last_update : 0,
        lockType: lock ? lock.lockType : null,
        daysSinceUpdate: lock
          ? Math.max(0, Math.floor((currentBlock - lock.last_update) / BLOCKS_PER_DAY))
          : null,
        rpcError: false,
      };

      results.push(entry);
    }

    const data = {
      results,
      currentBlock,
      fetchedAt: Date.now(),
      ownerLockCount: ownerEntries.length,
      decayingLockCount: decayingEntries.length,
    };

    setCache(data);
    saveToStorage(data);
    return data;
  } finally {
    try { ws.close(); } catch { /* ignore */ }
  }
}

// Force refresh — bypass cache
export async function forceRefreshConviction(subnetMeta) {
  delete cache[CACHE_KEY];
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  return fetchConvictionData(subnetMeta);
}
