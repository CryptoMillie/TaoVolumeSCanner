import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSharedData } from "./DataContext.jsx";
import { fetchConvictionData, forceRefreshConviction } from "./conviction/api.js";
import { scoreConviction, computeSummary } from "./conviction/scoring.js";
import { LOCK_STATUS_CONFIG, MATURITY_CURVE, TOOLTIPS } from "./conviction/constants.js";
import { fetchDevActivity } from "./gem/api.js";
import { scoreGems } from "./gem/scoring.js";

// ─── Formatters ───────────────────────────────────────────

function fAlpha(v) {
  if (v == null || v === 0) return "0.00 \u03B1";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M \u03B1";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "k \u03B1";
  return v.toFixed(2) + " \u03B1";
}

function fAlphaShort(v) {
  if (v == null || v === 0) return "0.00";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "k";
  return v.toFixed(2);
}

function truncAddr(addr) {
  if (!addr || addr.length < 12) return addr || "\u2014";
  return addr.substring(0, 8) + "\u2026" + addr.substring(addr.length - 4);
}

// ─── Animated Counter ─────────────────────────────────────

function AnimCounter({ target, suffix = "", decimals = 0, duration = 800 }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    if (target === 0) { setDisplay(0); return; }
    const start = performance.now();
    const from = 0;
    const tick = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (target - from) * eased);
      if (progress < 1) ref.current = requestAnimationFrame(tick);
    };
    ref.current = requestAnimationFrame(tick);
    return () => { if (ref.current) cancelAnimationFrame(ref.current); };
  }, [target, duration]);

  const formatted = decimals > 0 ? display.toFixed(decimals) : Math.round(display);
  return <span>{formatted}{suffix}</span>;
}

// ─── Tooltip component ───────────────────────────────────

function Tooltip({ text, children }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef(null);

  const onEnter = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPos({ x: rect.left, y: rect.bottom + 6 });
    setShow(true);
  };

  return (
    <span
      ref={ref}
      onMouseEnter={onEnter}
      onMouseLeave={() => setShow(false)}
      style={{ cursor: "help", borderBottom: "1px dotted #333355" }}
    >
      {children}
      {show && (
        <div style={{
          position: "fixed",
          left: Math.min(pos.x, window.innerWidth - 360),
          top: pos.y,
          zIndex: 9999,
          background: "#0d0d1a",
          border: "1px solid #222244",
          borderRadius: "4px",
          padding: "10px 14px",
          maxWidth: "340px",
          fontSize: "10px",
          lineHeight: "1.5",
          color: "#8888aa",
          fontWeight: 400,
          boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
          pointerEvents: "none",
        }}>
          {text}
        </div>
      )}
    </span>
  );
}

// ─── Maturity Curve Panel ─────────────────────────────────

function MaturityPanel() {
  return (
    <div style={{
      background: "#0a0a14",
      border: "1px solid #1a1a2e",
      borderRadius: "4px",
      padding: "12px 16px",
      fontSize: "10px",
      color: "#6666aa",
      marginTop: "8px",
    }}>
      <div style={{ color: "#5555ff", fontWeight: 700, marginBottom: "8px", fontSize: "11px" }}>
        Conviction maturity curve — perpetual lock to non-owner hotkey, 60-day half-life
      </div>
      <div style={{ display: "flex", gap: "2px", flexWrap: "wrap" }}>
        {MATURITY_CURVE.map((row) => (
          <div key={row.days} style={{
            display: "flex",
            gap: "8px",
            padding: "3px 10px",
            background: "#08080f",
            borderRadius: "2px",
            minWidth: "120px",
          }}>
            <span style={{ color: "#444466" }}>{row.days}d</span>
            <span style={{ color: "#8888cc" }}>{row.pct}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────

const S = {
  root: {
    fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace",
    background: "#070710",
    minHeight: "100vh",
    color: "#b0b0cc",
  },
  header: {
    background: "#0d0d1a",
    borderBottom: "1px solid #151528",
    padding: "18px 24px 14px",
  },
  title: {
    color: "#5555ff",
    fontWeight: 700,
    fontSize: "14px",
    letterSpacing: "0.08em",
  },
  subtitle: {
    color: "#444466",
    fontSize: "10px",
    marginTop: "4px",
  },
  controls: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    marginTop: "12px",
    flexWrap: "wrap",
  },
  btn: (active) => ({
    background: active ? "#1818cc" : "transparent",
    border: `1px solid ${active ? "#4444ff" : "#1a1a2e"}`,
    color: active ? "#ffffff" : "#555577",
    padding: "4px 12px",
    borderRadius: "3px",
    cursor: "pointer",
    fontSize: "10px",
    fontFamily: "'JetBrains Mono',monospace",
    fontWeight: active ? 700 : 400,
  }),
  searchInput: {
    background: "#0a0a14",
    border: "1px solid #1a1a2e",
    color: "#b0b0cc",
    padding: "4px 10px",
    borderRadius: "3px",
    fontSize: "10px",
    fontFamily: "'JetBrains Mono',monospace",
    outline: "none",
    width: "180px",
  },
  summaryRow: {
    display: "flex",
    gap: "12px",
    padding: "14px 24px",
    flexWrap: "wrap",
  },
  card: (color) => ({
    background: "#0a0a14",
    border: `1px solid ${color}22`,
    borderRadius: "4px",
    padding: "12px 18px",
    minWidth: "140px",
    flex: "1 1 140px",
  }),
  cardLabel: {
    color: "#444466",
    fontSize: "9px",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  },
  cardValue: (color) => ({
    color,
    fontSize: "18px",
    fontWeight: 700,
    marginTop: "4px",
  }),
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    textAlign: "left",
    padding: "8px 12px",
    fontSize: "9px",
    color: "#444466",
    borderBottom: "1px solid #151528",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "8px 12px",
    fontSize: "11px",
    borderBottom: "1px solid #0e0e1c",
    whiteSpace: "nowrap",
  },
  badge: (config) => ({
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "3px",
    fontSize: "10px",
    fontWeight: 600,
    color: config.color,
    background: config.bg,
    border: `1px solid ${config.border}`,
  }),
  expandedRow: {
    background: "#08080f",
    padding: "12px 24px",
    fontSize: "10px",
    color: "#6666aa",
    borderBottom: "1px solid #0e0e1c",
  },
  autoToggle: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginLeft: "auto",
  },
  freqSelect: {
    background: "#0a0a14",
    border: "1px solid #1a1a2e",
    color: "#666688",
    padding: "3px 6px",
    borderRadius: "3px",
    fontSize: "10px",
    fontFamily: "'JetBrains Mono',monospace",
    cursor: "pointer",
  },
  loading: {
    textAlign: "center",
    padding: "60px 20px",
    color: "#333355",
    fontSize: "12px",
  },
  error: {
    textAlign: "center",
    padding: "40px 20px",
    color: "#ff4455",
    fontSize: "12px",
  },
};

// ─── Main Component ──────────────────────────────────────

export default function ConvictionScanner() {
  const { refreshTaoStats, refreshCoinGecko } = useSharedData();
  const [data, setData] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [ts, setTs] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState("locked_mass");
  const [sortDir, setSortDir] = useState("desc");
  const [expanded, setExpanded] = useState({});
  const [auto, setAuto] = useState(true);
  const [freq, setFreq] = useState(120);
  const [gemNetuids, setGemNetuids] = useState(new Set());
  const [showMaturity, setShowMaturity] = useState(false);
  const timerRef = useRef();

  const scan = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      // Fetch TaoStats data for subnet names
      const tsData = await refreshTaoStats();
      const meta = tsData.meta || {};
      const pools = tsData.pools;

      // Fetch conviction data from RPC
      const convictionData = await fetchConvictionData(meta);

      // Score and classify
      const scored = scoreConviction(convictionData, pools, meta);
      const stats = computeSummary(scored);

      setData(scored);
      setSummary(stats);
      setTs(new Date());

      // Fetch Gem Zone data for cross-reference (non-blocking)
      try {
        const subnets = tsData.subnets;
        const cgData = await refreshCoinGecko();
        const devActivity = await fetchDevActivity();
        const gems = scoreGems(subnets, pools, meta, devActivity, cgData);
        const gemSet = new Set(
          gems.filter((g) => g.quadrant === "gem").map((g) => g.netuid)
        );
        setGemNetuids(gemSet);
      } catch {
        // Gem cross-reference is non-critical
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [refreshTaoStats, refreshCoinGecko]);

  useEffect(() => {
    scan();
  }, []);

  // Auto-refresh
  useEffect(() => {
    clearInterval(timerRef.current);
    if (auto) timerRef.current = setInterval(scan, freq * 1000);
    return () => clearInterval(timerRef.current);
  }, [auto, freq, scan]);

  const toggleExpand = (netuid) => {
    setExpanded((prev) => ({ ...prev, [netuid]: !prev[netuid] }));
  };

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  // Filter
  let filtered = data;
  if (filter === "strong") filtered = data.filter((d) => d.status === "strong");
  else if (filter === "building") filtered = data.filter((d) => d.status === "building");
  else if (filter === "nolock") filtered = data.filter((d) => d.status === "nolock");
  else if (filter === "zero") filtered = data.filter((d) => d.status === "zero");

  // Search
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(
      (d) =>
        d.name?.toLowerCase().includes(q) ||
        String(d.netuid).includes(q)
    );
  }

  // Sort
  filtered = [...filtered].sort((a, b) => {
    let av, bv;
    switch (sortCol) {
      case "netuid": av = a.netuid; bv = b.netuid; break;
      case "locked_mass": av = a.locked_mass; bv = b.locked_mass; break;
      case "conviction": av = a.conviction; bv = b.conviction; break;
      case "lockType": av = a.lockType || ""; bv = b.lockType || ""; break;
      case "status": {
        const order = { strong: 4, building: 3, zero: 2, nolock: 1, error: 0 };
        av = order[a.status] ?? 0;
        bv = order[b.status] ?? 0;
        break;
      }
      default: av = a.locked_mass; bv = b.locked_mass;
    }
    if (typeof av === "string") {
      return sortDir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv);
    }
    return sortDir === "desc" ? bv - av : av - bv;
  });

  const sortArrow = (col) => {
    if (sortCol !== col) return " \u2195";
    return sortDir === "desc" ? " \u25BC" : " \u25B2";
  };

  // ─── Render ──────────────────────────────────────────

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={S.title}>CONVICTION LOCKS {"\uD83D\uDD12"}</span>
          <button
            onClick={() => { if (!loading) scan(); }}
            disabled={loading}
            style={{
              ...S.btn(false),
              opacity: loading ? 0.5 : 1,
              fontSize: "10px",
            }}
          >
            {loading ? "SCANNING\u2026" : "SCAN"}
          </button>
          <button
            onClick={async () => {
              setLoading(true);
              setErr(null);
              try {
                const tsData = await refreshTaoStats();
                const meta = tsData.meta || {};
                const pools = tsData.pools;
                const convictionData = await forceRefreshConviction(meta);
                const scored = scoreConviction(convictionData, pools, meta);
                const stats = computeSummary(scored);
                setData(scored);
                setSummary(stats);
                setTs(new Date());
              } catch (e) {
                setErr(e.message);
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            style={{
              ...S.btn(false),
              opacity: loading ? 0.5 : 1,
              fontSize: "10px",
            }}
          >
            FORCE REFRESH
          </button>
        </div>
        <div style={S.subtitle}>
          Active conviction locks from subnet owners across all subnets — direct from Bittensor RPC
          {ts && (
            <span style={{ marginLeft: "12px", color: "#333355" }}>
              Last updated: {ts.toLocaleTimeString()}
            </span>
          )}
        </div>

        {/* Controls row */}
        <div style={S.controls}>
          {/* Filter buttons */}
          <button onClick={() => setFilter("all")} style={S.btn(filter === "all")}>
            ALL ({data.length})
          </button>
          <button onClick={() => setFilter("strong")} style={S.btn(filter === "strong")}>
            {"\uD83D\uDFE2"} Strong ({summary?.strong || 0})
          </button>
          <button onClick={() => setFilter("building")} style={S.btn(filter === "building")}>
            {"\uD83D\uDFE1"} Building ({summary?.building || 0})
          </button>
          <button onClick={() => setFilter("zero")} style={S.btn(filter === "zero")}>
            {"\uD83D\uDD34"} Zero ({summary?.zeroConviction || 0})
          </button>
          <button onClick={() => setFilter("nolock")} style={S.btn(filter === "nolock")}>
            {"\u26A0\uFE0F"} No Lock ({summary?.noLock || 0})
          </button>

          {/* Search */}
          <input
            type="text"
            placeholder="Search subnet or SN#..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={S.searchInput}
          />

          {/* Maturity curve toggle */}
          <button onClick={() => setShowMaturity((v) => !v)} style={S.btn(showMaturity)}>
            MATURITY CURVE
          </button>

          {/* Auto-refresh */}
          <div style={S.autoToggle}>
            <span style={{ color: "#333355", fontSize: "10px" }}>Auto:</span>
            <button
              onClick={() => setAuto((v) => !v)}
              style={{
                ...S.btn(auto),
                padding: "3px 8px",
                fontSize: "9px",
              }}
            >
              {auto ? "ON" : "OFF"}
            </button>
            <select
              value={freq}
              onChange={(e) => setFreq(Number(e.target.value))}
              style={S.freqSelect}
            >
              <option value={60}>60s</option>
              <option value={120}>120s</option>
              <option value={300}>5m</option>
              <option value={600}>10m</option>
            </select>
          </div>
        </div>

        {/* Maturity curve panel */}
        {showMaturity && <MaturityPanel />}
      </div>

      {/* Error state */}
      {err && (
        <div style={S.error}>
          RPC Error: {err}
          <div style={{ marginTop: "8px", color: "#555577", fontSize: "10px" }}>
            Check network connection to Bittensor Finney endpoint
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && data.length === 0 && (
        <div style={S.loading}>
          <div style={{ animation: "pulse 1.5s infinite" }}>
            Connecting to Bittensor RPC and scanning conviction locks...
          </div>
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div style={S.summaryRow}>
          <div style={S.card("#5555ff")}>
            <div style={S.cardLabel}>Subnets with locks</div>
            <div style={S.cardValue("#5555ff")}>
              <AnimCounter target={summary.totalWithLock} />
              <span style={{ fontSize: "11px", color: "#333366", marginLeft: "4px" }}>
                / {summary.totalSubnets}
              </span>
            </div>
          </div>

          <div style={S.card("#33bb66")}>
            <div style={S.cardLabel}>Total Alpha Locked</div>
            <div style={S.cardValue("#33bb66")}>
              {summary.totalLocked >= 1e6
                ? <><AnimCounter target={summary.totalLocked / 1e6} decimals={1} suffix="M" /></>
                : summary.totalLocked >= 1e3
                  ? <><AnimCounter target={summary.totalLocked / 1e3} decimals={1} suffix="k" /></>
                  : <AnimCounter target={summary.totalLocked} decimals={2} />
              }
              <span style={{ fontSize: "11px", marginLeft: "4px" }}>{"\u03B1"}</span>
            </div>
          </div>

          <div style={S.card("#ff8833")}>
            <div style={S.cardLabel}>Zero Conviction</div>
            <div style={S.cardValue("#ff8833")}>
              <AnimCounter target={summary.zeroConviction} />
            </div>
            <div style={{ color: "#553311", fontSize: "9px", marginTop: "2px" }}>
              locked but conviction = 0
            </div>
          </div>

          <div style={S.card("#ff4455")}>
            <div style={S.cardLabel}>No Lock</div>
            <div style={S.cardValue("#ff4455")}>
              <AnimCounter target={summary.noLock} />
            </div>
            <div style={{ color: "#551122", fontSize: "9px", marginTop: "2px" }}>
              exposed to emission blocking
            </div>
          </div>

          <div style={S.card("#333355")}>
            <div style={S.cardLabel}>Last Updated</div>
            <div style={{ color: "#666688", fontSize: "12px", fontWeight: 600, marginTop: "4px" }}>
              {ts ? ts.toLocaleTimeString() : "\u2014"}
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      {data.length > 0 && (
        <div style={{ padding: "0 24px 24px", overflowX: "auto" }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th} onClick={() => handleSort("netuid")}>
                  Subnet{sortArrow("netuid")}
                </th>
                <th style={S.th}>King</th>
                <th style={S.th} onClick={() => handleSort("locked_mass")}>
                  <Tooltip text={TOOLTIPS.conviction}>
                    Locked{sortArrow("locked_mass")}
                  </Tooltip>
                </th>
                <th style={S.th} onClick={() => handleSort("conviction")}>
                  <Tooltip text={TOOLTIPS.conviction}>
                    Conviction{sortArrow("conviction")}
                  </Tooltip>
                </th>
                <th style={S.th} onClick={() => handleSort("lockType")}>
                  <Tooltip text={TOOLTIPS.lockType}>
                    Lock Type{sortArrow("lockType")}
                  </Tooltip>
                </th>
                <th style={S.th} onClick={() => handleSort("status")}>
                  <Tooltip text={TOOLTIPS.lockStatus}>
                    Lock Status{sortArrow("status")}
                  </Tooltip>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const statusCfg = LOCK_STATUS_CONFIG[row.status] || LOCK_STATUS_CONFIG.error;
                const isExpanded = expanded[row.netuid];
                const isGem = gemNetuids.has(row.netuid);

                return (
                  <React.Fragment key={row.netuid}>
                    <tr
                      className="trow"
                      onClick={() => toggleExpand(row.netuid)}
                      style={{
                        cursor: "pointer",
                        background: statusCfg.rowBg || (i % 2 === 0 ? "#08080e" : "transparent"),
                      }}
                    >
                      {/* Subnet */}
                      <td style={S.td}>
                        <span style={{ color: "#5555ff", fontWeight: 600 }}>
                          SN{row.netuid}
                        </span>
                        <span style={{ color: "#6666aa", marginLeft: "8px" }}>
                          {row.name || "\u2014"}
                        </span>
                        {isGem && (
                          <span style={{ marginLeft: "6px" }} title="Also in Gem Scan \uD83D\uDC8E Gem Zone">
                            {"\uD83D\uDC8E"}
                          </span>
                        )}
                      </td>

                      {/* King (coldkey) */}
                      <td style={{ ...S.td, color: "#555577", fontFamily: "'JetBrains Mono',monospace" }}>
                        {row.hasLock ? "\u2014" : "\u2014"}
                      </td>

                      {/* Locked */}
                      <td style={{ ...S.td, color: row.locked_mass > 0 ? "#b0b0cc" : "#333355" }}>
                        {row.rpcError ? (
                          <span style={{ color: "#ff4455" }}>RPC error</span>
                        ) : (
                          fAlpha(row.locked_mass)
                        )}
                      </td>

                      {/* Conviction */}
                      <td style={{ ...S.td, color: row.conviction > 0 ? "#8888cc" : "#333355" }}>
                        {row.rpcError ? (
                          <span style={{ color: "#ff4455" }}>RPC error</span>
                        ) : (
                          <>
                            {fAlpha(row.conviction)}
                            {row.hasLock && row.locked_mass > 0 && (
                              <span style={{
                                marginLeft: "6px",
                                color: "#444466",
                                fontSize: "9px",
                              }}>
                                ({(row.ratio * 100).toFixed(1)}%)
                              </span>
                            )}
                          </>
                        )}
                      </td>

                      {/* Lock Type */}
                      <td style={{ ...S.td, color: "#666688" }}>
                        {row.lockType === "perpetual" ? (
                          <span style={{ color: "#33bb66" }}>Perpetual</span>
                        ) : row.lockType === "decaying" ? (
                          <span style={{ color: "#ddaa00" }}>Decaying</span>
                        ) : (
                          <span style={{ color: "#333355" }}>{"\u2014"}</span>
                        )}
                      </td>

                      {/* Lock Status */}
                      <td style={S.td}>
                        <span style={S.badge(statusCfg)}>
                          {statusCfg.label}
                        </span>
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} style={S.expandedRow}>
                          <div style={{ display: "flex", gap: "32px", flexWrap: "wrap" }}>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                LOCKED MASS (RAW)
                              </div>
                              <div style={{ color: "#8888cc" }}>
                                {row.hasLock ? row.locked_mass.toFixed(9) + " \u03B1" : "\u2014"}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                CONVICTION (RAW)
                              </div>
                              <div style={{ color: "#8888cc" }}>
                                {row.hasLock ? row.conviction.toFixed(9) : "\u2014"}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                LAST UPDATE BLOCK
                              </div>
                              <div style={{ color: "#8888cc" }}>
                                {row.last_update > 0 ? row.last_update.toLocaleString() : "\u2014"}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                DAYS SINCE UPDATE
                              </div>
                              <div style={{ color: row.daysSinceUpdate > 30 ? "#ff8833" : "#8888cc" }}>
                                {row.daysSinceUpdate != null ? `${row.daysSinceUpdate}d` : "\u2014"}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                CONVICTION RATIO
                              </div>
                              <div style={{ color: "#8888cc" }}>
                                {row.hasLock && row.locked_mass > 0
                                  ? (row.ratio * 100).toFixed(2) + "%"
                                  : "\u2014"}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                LOCK TYPE
                              </div>
                              <div style={{ color: "#8888cc" }}>
                                {row.lockType ? row.lockType.charAt(0).toUpperCase() + row.lockType.slice(1) : "\u2014"}
                              </div>
                            </div>
                          </div>
                          {row.status === "zero" && row.hasLock && (
                            <div style={{
                              marginTop: "8px",
                              padding: "6px 10px",
                              background: "#1a0e00",
                              border: "1px solid #3a2000",
                              borderRadius: "3px",
                              color: "#ff8833",
                              fontSize: "9px",
                            }}>
                              Zero conviction with active lock — this lock just started or is in decaying mode with short elapsed time
                            </div>
                          )}
                          {row.status === "nolock" && (
                            <div style={{
                              marginTop: "8px",
                              padding: "6px 10px",
                              background: "#1a0010",
                              border: "1px solid #3a0020",
                              borderRadius: "3px",
                              color: "#ff4455",
                              fontSize: "9px",
                            }}>
                              No active conviction lock — exposed to emission blocking per Const's May 24 2026 announcement
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px", color: "#333355", fontSize: "11px" }}>
              No subnets match the current filter
            </div>
          )}
        </div>
      )}
    </div>
  );
}
