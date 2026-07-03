// Conviction Locks RPC Layer — raw WebSocket JSON-RPC to Finney
// Queries OwnerLock + DecayingOwnerLock storage maps via state_getKeysPaged + state_getStorage

import { xxhashAsHex } from "@polkadot/util-crypto";
import {
  FINNEY_WS,
  RPC_ENDPOINTS,
  RPC_TIMEOUT_MS,
  MAX_NETUIDS,
  BATCH_SIZE,
  STAGGER_MS,
  CACHE_TTL_MS,
  PALLET,
  STORAGE_OWNER_LOCK,
  STORAGE_DECAYING_OWNER_LOCK,
  STORAGE_HOTKEY_LOCK,
  STORAGE_DECAYING_HOTKEY_LOCK,
  STORAGE_SUBNET_OWNER_HOTKEY,
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

// ─── twox128 hash via @polkadot/util-crypto ───────────────

function twox128(input) {
  // xxhashAsHex returns "0x" + 32 hex chars for 128-bit hash
  return xxhashAsHex(input, 128).replace("0x", "");
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
  // conviction is U64F64 fixed point — integer part is upper 64 bits, also in rao
  const lockedMass = Number(lockedMassRaw) / 1e9;
  const convictionRao = Number(convictionRaw >> 64n) + Number(convictionRaw & 0xFFFFFFFFFFFFFFFFn) / (2 ** 64);
  const conviction = convictionRao / 1e9;

  return {
    locked_mass: lockedMass,
    conviction,
    last_update: Number(lastUpdate),
    locked_mass_raw: lockedMassRaw,
    conviction_raw: convictionRaw,
  };
}

// ─── AccountId32 decoding ────────────────────────────────
// SubnetOwnerHotkey storage returns a raw 32-byte AccountId

function decodeAccountId32(hexStr) {
  const hex = hexStr.replace("0x", "");
  if (hex.length !== 64) return null; // 32 bytes = 64 hex chars
  return "0x" + hex;
}

// ─── WebSocket JSON-RPC with failover ───────────────────────

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

// Try connecting to RPC endpoints with failover
async function wsConnectWithFailover() {
  const errors = [];

  for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
    const endpoint = RPC_ENDPOINTS[i];
    try {
      console.log(`[RPC] Attempting connection to ${endpoint.label}...`);
      const ws = await wsConnect(endpoint.url);
      console.log(`[RPC] ✓ Connected via ${endpoint.label}`);
      return { ws, endpoint: endpoint.label };
    } catch (err) {
      console.warn(`[RPC] ✗ ${endpoint.label} failed:`, err.message);
      errors.push(`${endpoint.label}: ${err.message}`);
      // Continue to next endpoint
    }
  }

  // All endpoints failed
  throw new Error(
    `Failed to connect to any Bittensor RPC endpoint. Tried:\n${errors.join("\n")}`
  );
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
// OwnerLock/DecayingOwnerLock: MAP(netuid) with Identity hasher
// Key layout: prefix(64 hex) + Identity(u16 LE netuid, 4 hex) = 68 hex total
function extractNetuid(key) {
  const hex = key.replace("0x", "");
  // Last 4 hex chars = 2 bytes = u16 LE netuid
  const lo = parseInt(hex.substring(hex.length - 4, hex.length - 2), 16);
  const hi = parseInt(hex.substring(hex.length - 2), 16);
  return lo | (hi << 8);
}

// ─── Extract netuid + hotkey from DoubleMap key ─────────────
// HotkeyLock/DecayingHotkeyLock: DMAP(netuid, hotkey) with Identity + Blake2_128Concat
// Key layout: prefix(64 hex) + Identity(u16 LE netuid, 4 hex) + Blake2_128(32 hex) + AccountId32(64 hex) = 164 hex total
function extractNetuidAndHotkey(key) {
  const hex = key.replace("0x", "");
  const suffix = hex.substring(64); // everything after the 32-byte prefix
  // First 4 hex chars = u16 LE netuid (Identity hasher)
  const lo = parseInt(suffix.substring(0, 2), 16);
  const hi = parseInt(suffix.substring(2, 4), 16);
  const netuid = lo | (hi << 8);
  // Skip 32 hex chars of Blake2_128 hash, then 64 hex chars = AccountId32
  const hotkey = "0x" + suffix.substring(36, 100);
  return { netuid, hotkey };
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
  let rpcEndpoint;
  try {
    const connection = await wsConnectWithFailover();
    ws = connection.ws;
    rpcEndpoint = connection.endpoint;
  } catch (err) {
    throw new Error("Failed to connect to Bittensor RPC: " + err.message);
  }

  try {
    // Fetch current block for age calculation
    const currentBlock = await fetchCurrentBlock(ws);

    // Fetch all lock entries in parallel: owner + decaying owner + hotkey + decaying hotkey + owner hotkey
    const ownerPrefix = storagePrefix(PALLET, STORAGE_OWNER_LOCK);
    const decayingPrefix = storagePrefix(PALLET, STORAGE_DECAYING_OWNER_LOCK);
    const hotkeyPrefix = storagePrefix(PALLET, STORAGE_HOTKEY_LOCK);
    const decayingHotkeyPrefix = storagePrefix(PALLET, STORAGE_DECAYING_HOTKEY_LOCK);
    const ownerHotkeyPrefix = storagePrefix(PALLET, STORAGE_SUBNET_OWNER_HOTKEY);

    const [ownerEntries, decayingEntries, hotkeyEntries, decayingHotkeyEntries, ownerHotkeyEntries] = await Promise.all([
      fetchAllStorageEntries(ws, ownerPrefix),
      fetchAllStorageEntries(ws, decayingPrefix),
      fetchAllStorageEntries(ws, hotkeyPrefix),
      fetchAllStorageEntries(ws, decayingHotkeyPrefix),
      fetchAllStorageEntries(ws, ownerHotkeyPrefix).catch(() => []), // graceful fallback
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

    // Build challenger lock map: netuid -> [{ hotkey, state, lockType }]
    const challengerMap = {};

    for (const entry of hotkeyEntries) {
      const { netuid, hotkey } = extractNetuidAndHotkey(entry.key);
      const state = decodeLockState(entry.value);
      if (state) {
        if (!challengerMap[netuid]) challengerMap[netuid] = [];
        challengerMap[netuid].push({
          hotkey,
          ...state,
          lockType: "perpetual",
        });
      }
    }

    for (const entry of decayingHotkeyEntries) {
      const { netuid, hotkey } = extractNetuidAndHotkey(entry.key);
      const state = decodeLockState(entry.value);
      if (state) {
        if (!challengerMap[netuid]) challengerMap[netuid] = [];
        // Check if this hotkey already has a perpetual lock on this subnet
        const existing = challengerMap[netuid].find((c) => c.hotkey === hotkey);
        if (existing) {
          existing.decayingLock = state;
        } else {
          challengerMap[netuid].push({
            hotkey,
            ...state,
            lockType: "decaying",
          });
        }
      }
    }

    // Build owner hotkey map: netuid -> AccountId32
    const ownerHotkeyMap = {};
    for (const entry of ownerHotkeyEntries) {
      const netuid = extractNetuid(entry.key);
      const hotkey = decodeAccountId32(entry.value);
      if (hotkey) {
        ownerHotkeyMap[netuid] = hotkey;
      }
    }

    // Build results for all subnets 0-127
    const results = [];
    for (let netuid = 0; netuid < MAX_NETUIDS; netuid++) {
      const lock = lockMap[netuid] || null;
      const meta = subnetMeta?.[String(netuid)] || null;
      const challengers = challengerMap[netuid] || [];

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
        challengers,
        ownerHotkey: ownerHotkeyMap[netuid] || null,
        rpcError: false,
      };

      results.push(entry);
    }

    const data = {
      results,
      currentBlock,
      fetchedAt: Date.now(),
      rpcEndpoint, // Track which endpoint served this data
      ownerLockCount: ownerEntries.length,
      decayingLockCount: decayingEntries.length,
      hotkeyLockCount: hotkeyEntries.length,
      decayingHotkeyLockCount: decayingHotkeyEntries.length,
      ownerHotkeyCount: ownerHotkeyEntries.length,
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
