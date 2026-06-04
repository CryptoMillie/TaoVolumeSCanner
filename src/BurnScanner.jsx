import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSharedData } from "./DataContext.jsx";
import { fetchBurnData, forceRefreshBurn } from "./burn/api.js";
import { scoreBurns, computeBurnSummary } from "./burn/scoring.js";
import { BURN_STATUS_CONFIG, TOOLTIPS } from "./burn/constants.js";

// ─── Formatters ───────────────────────────────────────────

function fAlpha(v) {
  if (v == null || v === 0) return "0.00 \u03B1";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M \u03B1";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "k \u03B1";
  return v.toFixed(2) + " \u03B1";
}

function fPct(v) {
  if (v == null || v === 0) return "0.0%";
  if (v >= 1) return (v * 100).toFixed(0) + "%";
  if (v >= 0.01) return (v * 100).toFixed(1) + "%";
  return (v * 100).toFixed(2) + "%";
}

function fTao(v) {
  if (v == null || v === 0) return "0.00 \u03C4";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M \u03C4";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "k \u03C4";
  if (v >= 1) return v.toFixed(2) + " \u03C4";
  return v.toFixed(4) + " \u03C4";
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
    color: "#ff6633",
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

export default function BurnScanner() {
  const { refreshTaoStats } = useSharedData();
  const [data, setData] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [ts, setTs] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState("burnPct");
  const [sortDir, setSortDir] = useState("desc");
  const [expanded, setExpanded] = useState({});
  const [auto, setAuto] = useState(true);
  const [freq, setFreq] = useState(300);
  const timerRef = useRef();

  const scan = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const tsData = await refreshTaoStats();
      const meta = tsData.meta || {};
      const pools = tsData.pools;
      const subnets = tsData.subnets;

      const burnData = await fetchBurnData(subnets);
      const scored = scoreBurns(burnData.historyMap, subnets, pools, meta);
      const stats = computeBurnSummary(scored);

      setData(scored);
      setSummary(stats);
      setTs(new Date());
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [refreshTaoStats]);

  useEffect(() => {
    scan();
  }, []);

  // Auto-refresh (5min default due to heavier API load)
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
  if (filter === "heavy") filtered = data.filter((d) => d.status === "heavy");
  else if (filter === "moderate") filtered = data.filter((d) => d.status === "moderate");
  else if (filter === "light") filtered = data.filter((d) => d.status === "light");
  else if (filter === "minimal") filtered = data.filter((d) => d.status === "minimal");
  else if (filter === "nodata") filtered = data.filter((d) => d.status === "nodata");

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
      case "burnPct": av = a.burnPct; bv = b.burnPct; break;
      case "derivedBurn": av = a.derivedBurn; bv = b.derivedBurn; break;
      case "taoValue": av = a.taoValue; bv = b.taoValue; break;
      case "burnDays": av = a.burnDays; bv = b.burnDays; break;
      case "incentiveBurn": av = a.incentiveBurn; bv = b.incentiveBurn; break;
      case "status": {
        const order = { heavy: 4, moderate: 3, light: 2, minimal: 1, nodata: 0 };
        av = order[a.status] ?? 0;
        bv = order[b.status] ?? 0;
        break;
      }
      default: av = a.burnPct; bv = b.burnPct;
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
          <span style={S.title}>BURN SCANNER {"\uD83D\uDD25"}</span>
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
                const subnets = tsData.subnets;
                const burnData = await forceRefreshBurn(subnets);
                const scored = scoreBurns(burnData.historyMap, subnets, pools, meta);
                const stats = computeBurnSummary(scored);
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
          Manual alpha burns per subnet — derived from pool history vs expected emission over 30 days
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
          <button onClick={() => setFilter("heavy")} style={S.btn(filter === "heavy")}>
            {"\uD83D\uDD25"} Heavy ({summary?.heavy || 0})
          </button>
          <button onClick={() => setFilter("moderate")} style={S.btn(filter === "moderate")}>
            {"\uD83D\uDFE1"} Moderate ({summary?.moderate || 0})
          </button>
          <button onClick={() => setFilter("light")} style={S.btn(filter === "light")}>
            {"\uD83D\uDFE0"} Light ({summary?.light || 0})
          </button>
          <button onClick={() => setFilter("minimal")} style={S.btn(filter === "minimal")}>
            {"\u26AA"} Minimal ({summary?.minimal || 0})
          </button>
          <button onClick={() => setFilter("nodata")} style={S.btn(filter === "nodata")}>
            {"\u2014"} No Data ({summary?.nodata || 0})
          </button>

          {/* Search */}
          <input
            type="text"
            placeholder="Search subnet or SN#..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={S.searchInput}
          />

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
              <option value={120}>120s</option>
              <option value={300}>5m</option>
              <option value={600}>10m</option>
              <option value={900}>15m</option>
            </select>
          </div>
        </div>
      </div>

      {/* Error state */}
      {err && (
        <div style={S.error}>
          Error: {err}
          <div style={{ marginTop: "8px", color: "#555577", fontSize: "10px" }}>
            Check network connection and API key configuration
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && data.length === 0 && (
        <div style={S.loading}>
          <div style={{ animation: "pulse 1.5s infinite" }}>
            Fetching pool history and computing burn metrics...
          </div>
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div style={S.summaryRow}>
          <div style={S.card("#ff6633")}>
            <div style={S.cardLabel}>Total Alpha Burned</div>
            <div style={S.cardValue("#ff6633")}>
              <AnimCounter target={summary.totalBurned >= 1000 ? Math.round(summary.totalBurned / 1000) : Math.round(summary.totalBurned)} suffix={summary.totalBurned >= 1000 ? "k \u03B1" : " \u03B1"} />
            </div>
          </div>

          <div style={S.card("#ddaa00")}>
            <div style={S.cardLabel}>TAO Value</div>
            <div style={S.cardValue("#ddaa00")}>
              <AnimCounter target={summary.totalTaoValue >= 1000 ? Math.round(summary.totalTaoValue / 1000) : Math.round(summary.totalTaoValue)} suffix={summary.totalTaoValue >= 1000 ? "k \u03C4" : " \u03C4"} />
            </div>
          </div>

          <div style={S.card("#ff4422")}>
            <div style={S.cardLabel}>Heavy Burn Count</div>
            <div style={S.cardValue("#ff4422")}>
              <AnimCounter target={summary.heavy} />
            </div>
            <div style={{ color: "#552211", fontSize: "9px", marginTop: "2px" }}>
              {"\u2265"}50% of emission burned
            </div>
          </div>

          <div style={S.card("#5555ff")}>
            <div style={S.cardLabel}>Avg Burn Rate</div>
            <div style={S.cardValue("#5555ff")}>
              <AnimCounter target={summary.avgBurnPct * 100} decimals={1} suffix="%" />
            </div>
          </div>

          <div style={S.card("#9966ff")}>
            <div style={S.cardLabel}>Avg Incentive Burn</div>
            <div style={S.cardValue("#9966ff")}>
              <AnimCounter target={summary.avgIncentiveBurn * 100} decimals={1} suffix="%" />
            </div>
          </div>

          <div style={S.card("#33bb66")}>
            <div style={S.cardLabel}>Subnets With Data</div>
            <div style={S.cardValue("#33bb66")}>
              <AnimCounter target={summary.withData} />
              <span style={{ fontSize: "10px", color: "#1a5533" }}>
                /{summary.total}
              </span>
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
                <th style={S.th} onClick={() => handleSort("status")}>
                  <Tooltip text={TOOLTIPS.status}>
                    Status{sortArrow("status")}
                  </Tooltip>
                </th>
                <th style={S.th} onClick={() => handleSort("burnPct")}>
                  <Tooltip text={TOOLTIPS.burnPct}>
                    Burn %{sortArrow("burnPct")}
                  </Tooltip>
                </th>
                <th style={S.th} onClick={() => handleSort("derivedBurn")}>
                  <Tooltip text={TOOLTIPS.burned30d}>
                    Burned 30d{sortArrow("derivedBurn")}
                  </Tooltip>
                </th>
                <th style={S.th} onClick={() => handleSort("taoValue")}>
                  <Tooltip text={TOOLTIPS.taoValue}>
                    TAO Value{sortArrow("taoValue")}
                  </Tooltip>
                </th>
                <th style={S.th} onClick={() => handleSort("burnDays")}>
                  <Tooltip text={TOOLTIPS.burnDays}>
                    Burn Days{sortArrow("burnDays")}
                  </Tooltip>
                </th>
                <th style={S.th} onClick={() => handleSort("incentiveBurn")}>
                  <Tooltip text={TOOLTIPS.incentiveBurn}>
                    Incentive Burn{sortArrow("incentiveBurn")}
                  </Tooltip>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const statusCfg = BURN_STATUS_CONFIG[row.status] || BURN_STATUS_CONFIG.nodata;
                const isExpanded = expanded[row.netuid];

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
                      </td>

                      {/* Status */}
                      <td style={S.td}>
                        <span style={S.badge(statusCfg)}>
                          {statusCfg.label}
                        </span>
                      </td>

                      {/* Burn % */}
                      <td style={{ ...S.td, fontWeight: 600 }}
                        title={row.hasData ? `${fAlpha(row.derivedBurn)} burned over ${Math.round(row.daysOfData)} days (~${fTao(row.taoValue)}). ${row.burnDays} of ${row.dataPoints - 1} intervals had manual burns.` : ""}
                      >
                        {row.hasData ? (
                          <span style={{
                            color: row.burnPct >= 0.50 ? "#ff4422"
                              : row.burnPct >= 0.20 ? "#ddaa00"
                              : row.burnPct >= 0.05 ? "#ff8833"
                              : "#555577",
                          }}>
                            {fPct(row.burnPct)}
                          </span>
                        ) : (
                          <span style={{ color: "#333355" }}>{"\u2014"}</span>
                        )}
                      </td>

                      {/* Burned 30d */}
                      <td style={{ ...S.td, color: row.derivedBurn > 0 ? "#b0b0cc" : "#333355" }}>
                        {row.hasData ? fAlpha(row.derivedBurn) : "\u2014"}
                      </td>

                      {/* TAO Value */}
                      <td style={{ ...S.td, color: row.taoValue > 0 ? "#ddaa00" : "#333355" }}>
                        {row.hasData && row.taoValue > 0 ? fTao(row.taoValue) : "\u2014"}
                      </td>

                      {/* Burn Days */}
                      <td style={{ ...S.td, color: row.burnDays > 0 ? "#b0b0cc" : "#333355" }}>
                        {row.hasData ? (
                          <span>
                            {row.burnDays}
                            <span style={{ color: "#444466", fontSize: "9px" }}>
                              /{row.dataPoints - 1}
                            </span>
                          </span>
                        ) : "\u2014"}
                      </td>

                      {/* Incentive Burn */}
                      <td style={{ ...S.td, fontWeight: row.incentiveBurn > 0 ? 600 : 400 }}>
                        {row.incentiveBurn > 0 ? (
                          <span style={{
                            color: row.incentiveBurn >= 0.50 ? "#ff4422"
                              : row.incentiveBurn >= 0.10 ? "#ddaa00"
                              : "#ff8833",
                          }}>
                            {fPct(row.incentiveBurn)}
                          </span>
                        ) : (
                          <span style={{ color: "#333355" }}>0%</span>
                        )}
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} style={S.expandedRow}>
                          <div style={{ display: "flex", gap: "32px", flexWrap: "wrap" }}>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                EXPECTED EMISSION (30d)
                              </div>
                              <div style={{ color: "#8888cc" }}>
                                {row.hasData ? fAlpha(row.expected30d) : "\u2014"}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                ACTUAL CHANGE
                              </div>
                              <div style={{ color: row.actualChange < 0 ? "#ff4455" : "#8888cc" }}>
                                {row.hasData ? (row.actualChange >= 0 ? "+" : "") + fAlpha(row.actualChange) : "\u2014"}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                DERIVED BURN
                              </div>
                              <div style={{ color: "#ff6633" }}>
                                {row.hasData ? fAlpha(row.derivedBurn) : "\u2014"}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                DAILY BURN RATE
                              </div>
                              <div style={{ color: "#8888cc" }}>
                                {row.hasData ? fAlpha(row.dailyRate) + "/day" : "\u2014"}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                EMISSION/BLOCK
                              </div>
                              <div style={{ color: "#8888cc" }}>
                                {row.emissionPerBlock > 0 ? row.emissionPerBlock.toFixed(6) + " \u03B1" : "\u2014"}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                PRICE
                              </div>
                              <div style={{ color: "#8888cc" }}>
                                {row.price > 0 ? row.price.toFixed(6) + " \u03C4/\u03B1" : "\u2014"}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                DATA POINTS
                              </div>
                              <div style={{ color: "#8888cc" }}>
                                {row.dataPoints || 0} snapshots over {Math.round(row.daysOfData || 0)}d
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                INCENTIVE BURN
                              </div>
                              <div style={{ color: row.incentiveBurn > 0 ? "#ff6633" : "#555577" }}>
                                {fPct(row.incentiveBurn)}
                              </div>
                            </div>
                          </div>
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
