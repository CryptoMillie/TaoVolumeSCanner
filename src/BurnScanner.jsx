import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSharedData } from "./DataContext.jsx";
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
  const [sortCol, setSortCol] = useState("incentiveBurn");
  const [sortDir, setSortDir] = useState("desc");
  const [expanded, setExpanded] = useState({});
  const [auto, setAuto] = useState(true);
  const [freq, setFreq] = useState(120);
  const timerRef = useRef();

  const scan = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const tsData = await refreshTaoStats();
      const meta = tsData.meta || {};
      const pools = tsData.pools;
      const subnets = tsData.subnets;

      const scored = scoreBurns(subnets, pools, meta);
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
  if (filter === "heavy") filtered = data.filter((d) => d.status === "heavy");
  else if (filter === "moderate") filtered = data.filter((d) => d.status === "moderate");
  else if (filter === "light") filtered = data.filter((d) => d.status === "light");
  else if (filter === "minimal") filtered = data.filter((d) => d.status === "minimal");

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
      case "incentiveBurn": av = a.incentiveBurn; bv = b.incentiveBurn; break;
      case "recycledLifetime": av = a.recycledLifetime; bv = b.recycledLifetime; break;
      case "recycled24h": av = a.recycled24h; bv = b.recycled24h; break;
      case "estimated30dBurn": av = a.estimated30dBurn; bv = b.estimated30dBurn; break;
      case "taoValue30d": av = a.taoValue30d; bv = b.taoValue30d; break;
      case "burnPerDay": av = a.burnPerDay; bv = b.burnPerDay; break;
      case "status": {
        const order = { heavy: 4, moderate: 3, light: 2, minimal: 1, nodata: 0 };
        av = order[a.status] ?? 0;
        bv = order[b.status] ?? 0;
        break;
      }
      default: av = a.incentiveBurn; bv = b.incentiveBurn;
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
        </div>
        <div style={S.subtitle}>
          Incentive burn rates and recycled alpha per subnet — deflationary pressure from owner-set burn parameters
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
              <option value={60}>60s</option>
              <option value={120}>120s</option>
              <option value={300}>5m</option>
              <option value={600}>10m</option>
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
            Loading subnet burn data...
          </div>
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div style={S.summaryRow}>
          <div style={S.card("#ff6633")}>
            <div style={S.cardLabel}>Lifetime Recycled</div>
            <div style={S.cardValue("#ff6633")}>
              <AnimCounter target={summary.totalRecycledLifetime >= 1000 ? Math.round(summary.totalRecycledLifetime / 1000) : Math.round(summary.totalRecycledLifetime)} suffix={summary.totalRecycledLifetime >= 1000 ? "k \u03B1" : " \u03B1"} />
            </div>
            <div style={{ color: "#553311", fontSize: "9px", marginTop: "2px" }}>
              total alpha burned all-time
            </div>
          </div>

          <div style={S.card("#ddaa00")}>
            <div style={S.cardLabel}>Est. 30d Burn</div>
            <div style={S.cardValue("#ddaa00")}>
              <AnimCounter target={summary.totalEst30dBurn >= 1000 ? Math.round(summary.totalEst30dBurn / 1000) : Math.round(summary.totalEst30dBurn)} suffix={summary.totalEst30dBurn >= 1000 ? "k \u03B1" : " \u03B1"} />
            </div>
            <div style={{ color: "#665500", fontSize: "9px", marginTop: "2px" }}>
              projected from current rates
            </div>
          </div>

          <div style={S.card("#ff4422")}>
            <div style={S.cardLabel}>Heavy Burners</div>
            <div style={S.cardValue("#ff4422")}>
              <AnimCounter target={summary.heavy} />
            </div>
            <div style={{ color: "#552211", fontSize: "9px", marginTop: "2px" }}>
              {"\u2265"}50% incentive burn rate
            </div>
          </div>

          <div style={S.card("#5555ff")}>
            <div style={S.cardLabel}>Avg Incentive Burn</div>
            <div style={S.cardValue("#5555ff")}>
              <AnimCounter target={summary.avgIncentiveBurn * 100} decimals={1} suffix="%" />
            </div>
            <div style={{ color: "#222244", fontSize: "9px", marginTop: "2px" }}>
              across {summary.withBurn} subnets with burns
            </div>
          </div>

          <div style={S.card("#9966ff")}>
            <div style={S.cardLabel}>Est. 30d TAO Value</div>
            <div style={S.cardValue("#9966ff")}>
              <AnimCounter target={summary.totalEst30dTaoValue >= 1000 ? Math.round(summary.totalEst30dTaoValue / 1000) : Math.round(summary.totalEst30dTaoValue)} suffix={summary.totalEst30dTaoValue >= 1000 ? "k \u03C4" : " \u03C4"} />
            </div>
          </div>

          <div style={S.card("#33bb66")}>
            <div style={S.cardLabel}>Subnets With Burns</div>
            <div style={S.cardValue("#33bb66")}>
              <AnimCounter target={summary.withBurn} />
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
                <th style={S.th} onClick={() => handleSort("incentiveBurn")}>
                  <Tooltip text={TOOLTIPS.incentiveBurn}>
                    Incentive Burn{sortArrow("incentiveBurn")}
                  </Tooltip>
                </th>
                <th style={S.th} onClick={() => handleSort("recycledLifetime")}>
                  <Tooltip text="Total alpha recycled (burned) since subnet registration. This is the cumulative on-chain burn counter.">
                    Recycled Lifetime{sortArrow("recycledLifetime")}
                  </Tooltip>
                </th>
                <th style={S.th} onClick={() => handleSort("recycled24h")}>
                  <Tooltip text="Alpha recycled in the last 24 hours. Shows current burn activity.">
                    Recycled 24h{sortArrow("recycled24h")}
                  </Tooltip>
                </th>
                <th style={S.th} onClick={() => handleSort("estimated30dBurn")}>
                  <Tooltip text={TOOLTIPS.burned30d}>
                    Est. 30d Burn{sortArrow("estimated30dBurn")}
                  </Tooltip>
                </th>
                <th style={S.th} onClick={() => handleSort("taoValue30d")}>
                  <Tooltip text={TOOLTIPS.taoValue}>
                    TAO Value{sortArrow("taoValue30d")}
                  </Tooltip>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const statusCfg = BURN_STATUS_CONFIG[row.status] || BURN_STATUS_CONFIG.minimal;
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

                      {/* Incentive Burn */}
                      <td style={{ ...S.td, fontWeight: 600 }}
                        title={row.incentiveBurn > 0 ? `${fPct(row.incentiveBurn)} of miner incentive is burned. Est. ${fAlpha(row.burnPerDay)}/day burned.` : ""}
                      >
                        {row.incentiveBurn > 0 ? (
                          <span style={{
                            color: row.incentiveBurn >= 0.50 ? "#ff4422"
                              : row.incentiveBurn >= 0.20 ? "#ddaa00"
                              : row.incentiveBurn >= 0.05 ? "#ff8833"
                              : "#555577",
                          }}>
                            {fPct(row.incentiveBurn)}
                          </span>
                        ) : (
                          <span style={{ color: "#333355" }}>0%</span>
                        )}
                      </td>

                      {/* Recycled Lifetime */}
                      <td style={{ ...S.td, color: row.recycledLifetime > 0 ? "#b0b0cc" : "#333355" }}>
                        {row.recycledLifetime > 0 ? fAlpha(row.recycledLifetime) : "\u2014"}
                      </td>

                      {/* Recycled 24h */}
                      <td style={{ ...S.td, color: row.recycled24h > 0 ? "#ff8833" : "#333355" }}>
                        {row.recycled24h > 0 ? fAlpha(row.recycled24h) : "\u2014"}
                      </td>

                      {/* Est. 30d Burn */}
                      <td style={{ ...S.td, color: row.estimated30dBurn > 0 ? "#ddaa00" : "#333355" }}>
                        {row.estimated30dBurn > 0 ? fAlpha(row.estimated30dBurn) : "\u2014"}
                      </td>

                      {/* TAO Value */}
                      <td style={{ ...S.td, color: row.taoValue30d > 0 ? "#9966ff" : "#333355" }}>
                        {row.taoValue30d > 0 ? fTao(row.taoValue30d) : "\u2014"}
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} style={S.expandedRow}>
                          <div style={{ display: "flex", gap: "32px", flexWrap: "wrap" }}>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                INCENTIVE BURN RATE
                              </div>
                              <div style={{ color: row.incentiveBurn > 0 ? "#ff6633" : "#555577" }}>
                                {fPct(row.incentiveBurn)}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                EMISSION/BLOCK
                              </div>
                              <div style={{ color: "#8888cc" }}>
                                {row.emissionPerBlock.toFixed(6)} {"\u03B1"}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                BURN/BLOCK
                              </div>
                              <div style={{ color: "#ff6633" }}>
                                {(row.emissionPerBlock * row.incentiveBurn).toFixed(6)} {"\u03B1"}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                BURN/DAY
                              </div>
                              <div style={{ color: "#ff6633" }}>
                                {fAlpha(row.burnPerDay)}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                EST. 30d BURN
                              </div>
                              <div style={{ color: "#ddaa00" }}>
                                {fAlpha(row.estimated30dBurn)}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                EXPECTED EMISSION (30d)
                              </div>
                              <div style={{ color: "#8888cc" }}>
                                {fAlpha(row.expected30d)}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                RECYCLED LIFETIME
                              </div>
                              <div style={{ color: "#b0b0cc" }}>
                                {fAlpha(row.recycledLifetime)}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#333355", fontSize: "9px", marginBottom: "2px" }}>
                                RECYCLED 24H
                              </div>
                              <div style={{ color: row.recycled24h > 0 ? "#ff8833" : "#555577" }}>
                                {fAlpha(row.recycled24h)}
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
                                TAO VALUE (LIFETIME)
                              </div>
                              <div style={{ color: "#9966ff" }}>
                                {row.taoValueLifetime > 0 ? fTao(row.taoValueLifetime) : "\u2014"}
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
