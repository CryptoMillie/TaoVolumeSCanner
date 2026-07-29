# v440 Emission Gate — Implementation Notes

This records what was actually verified on 2026-07-28 while implementing the
v440 emission gate update, superseding the brief's stated assumptions where
they turned out to be wrong or incomplete. If a future change to the gate
mechanism lands, start here before re-deriving anything.

## 1. The change is real, and already live on `main`

Before writing any code, `opentensor/subtensor` (resolved via GitHub to
`RaoFoundation/subtensor`) was checked directly — both via web search and by
downloading `pallets/subtensor/src/coinbase/subnet_emissions.rs`,
`run_coinbase.rs`, and `lib.rs` from the `main` branch. The gate is
implemented there, in `subnet_emissions.rs`, functions `get_shares()`,
`maybe_update_emission_gate_bar()`, and `apply_emission_gate()`. Public docs
sites (learnbittensor.org, etc.) had not caught up as of this writing — they
still describe the pre-gate, price-only EMA model as current. Don't trust
doc-site freshness for anything this recent; read the pallet source.

## 2. Storage item names — corrected from the brief's guesses

The brief's guesses were partially right. Verified real names/types (all
under pallet `SubtensorModule`, all `Identity`-hashed on `NetUid` for the
maps — same key-layout convention already used by `OwnerLock` etc. in
`src/conviction/api.js`):

| Brief's guess | Verified real item | Type | Storage kind |
|---|---|---|---|
| `SubnetMovingPrice` | `SubnetMovingPrice` ✓ correct | `I96F32` | MAP(netuid) |
| a generic "miner burn" field | **`MinerBurned`** | `U96F32` | MAP(netuid) |
| (not mentioned) | `SubnetEmissionEnabled` | `bool` (default `true`) | MAP(netuid) |
| θ as something to compute | **`EmissionGateBar`** | `U64F64` | StorageValue (no map!) |
| `q` | **`EmissionBarQuantile`** | `U64F64` | StorageValue |
| `h` | **`EmissionGateExponent`** | `U64F64` | StorageValue |

The important correction: **theta, q, and h are each a single on-chain
`StorageValue`, not something that needs to be recomputed client-side.**
`EmissionGateBar` IS theta — read it directly with one `state_getStorage`
call, no per-netuid enumeration needed. `src/bar/api.js` reads all three
directly and treats them as authoritative, while *also* running
`lib/gate.js`'s `computeTheta()`/`applyGate()` independently over the fetched
demand rows so The Bar tab's reconciliation panel can catch drift between
"what we computed" and "what the chain says" — this is the fastest way to
notice if a future runtime change alters the formula again.

Fixed-point decoding: all three types here are the `substrate-fixed` crate's
128-bit (16-byte) little-endian encoding — `U64F64`/`I96F32`/`U96F32` differ
only in how many of the 128 bits are integer vs fractional, and whether the
top bit is a sign bit. `src/bar/api.js`'s `decodeU64F64`/`decodeU96F32`/
`decodeI96F32` implement this; `decodeU64F64` splits high/low 64 bits before
converting to `Number` (matching the existing pattern in
`src/conviction/api.js`'s `decodeLockState`) because a direct cast would
exceed `Number.MAX_SAFE_INTEGER` for realistic values like `h=3` (raw =
`3 × 2^64`).

## 3. `b_i` (miner burn) — confirmed last-tempo-only, not smoothed

Brief's open question #3, resolved: `run_coinbase.rs` computes
`withheld_proportion` fresh every tempo from that tempo's incentive
distribution (`total_incentive` vs `withheld_incentive`, i.e. emission
directed to owner/immune hotkeys, whether recycled or burned) and
overwrites `MinerBurned` with `MinerBurned::<T>::insert(netuid,
withheld_proportion)`. There is no EMA/smoothing on this value — it is
exactly last tempo's ratio, replaced wholesale each tempo.

This also confirms the existing `incentive_burn` field already returned by
taostats' `subnet/latest` endpoint (used throughout `src/burn/scoring.js`,
`src/sri/scoring.js`, etc. before this change) is measuring the same thing
`MinerBurned` measures on-chain — no new taostats integration was needed for
the tabs that use it as a proxy input.

## 4. θ definition — confirmed, not interpolated

Brief's open question #1, resolved: theta is **the demand-share value of the
subnet at the crossing point**, not an interpolation between the two
straddling subnets and not a demand-share fraction. From
`maybe_update_emission_gate_bar()`: shares are sorted descending, accumulated
until cumulative ≥ q, and `theta = share` of the crossing subnet, verbatim —
no interpolation. `lib/gate.js`'s `computeTheta()` matches this exactly.

## 5. `q` and `h` defaults — confirmed exactly as stated

`DefaultEmissionBarQuantile` = `0.61`, `DefaultEmissionGateExponent` = `3`.
The pallet source even explains the `0.61` choice in a comment: "on the July
2026 distribution this lands the bar at the uniform share (1/active
subnets), around rank 32." Both are governance-mutable `StorageValue`s
(root-sudo), matching the brief's framing — `GateConfigContext.jsx` treats
them as runtime config for exactly this reason.

## 6. Tempo cadence — confirmed 360 blocks (~72 min)

`EMISSION_BAR_UPDATE_INTERVAL: u64 = 360` in `subnet_emissions.rs`, with an
explicit comment that this matches the standard tempo so the bar "cannot
flap" between epochs. At the existing app-wide 12s/block assumption
(`BLOCKS_PER_DAY = 7200` in `src/conviction/constants.js` and
`src/burn/constants.js`), that's 4320s = 72 minutes, exactly as the brief
stated. `src/bar/constants.js`'s `TEMPO_MS` and the θ-history recording
cadence in `src/bar/thetaHistory.js` use this.

## 7. Data source strategy actually implemented

- **The Bar tab** (`src/bar/api.js`) reads `SubnetMovingPrice`,
  `MinerBurned`, `SubnetEmissionEnabled`, `EmissionGateBar`,
  `EmissionBarQuantile`, and `EmissionGateExponent` directly from Finney via
  raw WebSocket JSON-RPC (same low-level approach as
  `src/conviction/api.js` — `state_getKeysPaged` + `state_getStorage`,
  hand-rolled SCALE decoding, no `@polkadot/api`). If the chain is
  unreachable it falls back to taostats' `pool.price`/`alpha_price` and
  `subnet.incentive_burn`, and marks every row's `priceSource`/`burnSource`
  as `"chain"` or `"proxy"` so the UI never silently presents a proxy value
  as verified chain data. This is the only tab with a verified reconciliation
  panel (computed share vs on-chain `emission`).
- **SRI / Intel / Purity / Burn scanners** do NOT open their own RPC
  connection — each tab doing its own WebSocket connect on top of what The
  Bar tab already does would be wasteful and would not respect the "free
  APIs only, no per-block flapping" constraint. Instead they compute demand
  and run it through the identical `lib/gate.js` math using taostats'
  `pool.price`/`alpha_price` and `subnet.incentive_burn` as the proxy inputs
  — the same proxy fallback path The Bar tab itself uses when chain data is
  unavailable. This is a deliberate, documented trade-off: these four tabs'
  gate figures (`gateRatio`/`gatePct`/`gateElasticity`/gated share) are
  approximate relative to The Bar tab's verified figures, and should not be
  assumed to match it to the last decimal. If exact parity becomes
  important, the fix is to have these tabs consume `src/bar/api.js`'s
  already-cached chain data instead of recomputing from taostats — not to
  give each tab its own RPC connection.
- **`emissionEnabled`**: read directly from `SubnetEmissionEnabled` when the
  chain is reachable; falls back to `true` (matching the on-chain
  `DefaultTrue`) when it isn't. The four proxy-only tabs above don't have
  access to this map at all and instead treat "in the taostats active list
  with `emission > 0`" as a stand-in — this is an approximation, not a
  verified `SubnetEmissionEnabled` read, and could diverge for a subnet the
  chain has disabled but which still shows a stale nonzero `emission` in
  taostats' cache.

## 8. Tab audit table

No PR is being opened for this change, so this is the durable record the
brief asked to put in a PR description. All 10 existing tabs (the brief said
"nine" — the repo actually has ten) were checked against the rule: *does
this tab rank, sort, filter, score, or colour subnets using emission,
emission share, or emission APY?*

| Tab | Verdict | What changed |
|---|---|---|
| VOLUME SCANNER | needs enhancement | Added `Δ EMIT (proj)` column: joins CoinGecko rows to netuid (symbol format is already `sn{netuid}`), runs taostats-proxy demand through `lib/gate.js`, shows `(1+spike%)^elasticity−1` as a labeled proxy leading indicator. |
| SRI RISK INDEX | needs gating — done | `m1_2` (D1 metric) now the gated `share_i` instead of raw `emission/totalEmission`. Added `r (BAR)` column + expanded-row gate/elasticity detail. |
| SUBNET HEALTH | unaffected | Confirmed emission-independent by design (only reads a boolean `hasEmission` flag). No change. |
| INTEL FEED | needs rework — done (highest severity) | `rev_2`, previously raw emission share labeled "yield generation", now the gated share. This was the only genuine yield/APY-labeled metric found anywhere in the repo. |
| ALPHA SIGNALS | unaffected | Confirmed via grep — zero emission-field usage. No change. |
| PURITY SCANNER | needs gating — done | Signal 1's `emissionSharePct` now the gated share; `r` added to generated explanation text. |
| GEM SCAN | unaffected | Confirmed via grep — pure dev-activity/market-cap, no change. |
| CONVICTION LOCKS | label clarification — done | The 10% "gate" here is an independent lock-ownership mechanism, not the v440 demand gate. Relabeled to "10% Lock Gate" everywhere and expanded the tooltip/constant comment to explicitly distinguish it. No scoring change. |
| BURN SCANNER | needs rework — done (highest severity) | `emissionRetention` relabeled as the pre-gate input only; added `postGateShare`/`gateElasticity`/`burnEmissionImpactPct` showing the real post-gate consequence of burning. Fixed three places in the UI that literally said "this subnet receives X% of its potential chain emission" — that claim was true pre-v440 and false after. |
| WHALE WATCHER | unaffected | Confirmed via grep — pure holder concentration, no change. |

No registration/slot-cost-as-value-signal code exists anywhere in the repo
(confirmed via grep for `recycle_cost`/`burn_cost`/`lock_cost`/etc.) and no
historical emission chart exists to annotate with a regime-break marker —
both brief instructions were genuinely not applicable, not skipped.

## 9. Known gaps / things to revisit

- The reconciliation panel (The Bar tab) has not been validated against a
  live chain connection in this environment — RPC access to
  `wss://entrypoint-finney.opentensor.ai:443` may be blocked in sandboxed
  execution contexts. If the reconciliation delta is consistently large in
  a real browser session, re-check the θ definition and `b_i` source first
  (per the brief's own guidance in §9), then check for an off-by-one in the
  crossing-point comparison (`>=` vs `>`) between `computeTheta()` and the
  chain's `maybe_update_emission_gate_bar()` — both use `>=` currently, but
  worth confirming against fresh chain state rather than assuming the source
  read here stays accurate forever.
- `src/lib/gate.js`'s `applyGate()` recomputes theta from the currently-
  fetched subnet set every call. If a subnet drops out of the taostats
  response between refreshes (delisted, API hiccup), the client-computed
  theta will silently shift — the on-chain `EmissionGateBar` read doesn't
  have this problem since it's authoritative. This is fine for the intended
  per-tempo refresh cadence but would misbehave under rapid manual
  refreshing; not guarded against beyond the existing per-tempo cache TTL.
- No historical (pre-v440) emission chart exists in this repo to annotate
  with a regime-break marker, and no registration/slot-cost modeling exists
  to flag as stale — both brief instructions were genuinely not applicable
  here, confirmed by grep across `src/`, not skipped.
