import { useState, useEffect, useCallback, useRef } from "react";
import { useSharedData } from "./DataContext.jsx";
import { fetchDevActivity } from "./gem/api.js";
import { scoreGems } from "./gem/scoring.js";
import { GEM_TIER_CONFIG, QUADRANTS, SIGNAL_LINES } from "./gem/constants.js";

function fN(v) { return v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${v.toFixed(0)}`; }
function fP(v) { return (v >= 0 ? "+" : "") + v.toFixed(1) + "%"; }

// ─── SVG Bubble Scatter Plot ───────────────────────────────
// Deterministic hash for consistent jitter per subnet
function hashJitter(netuid) {
  const x = Math.sin(netuid * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x); // 0..1
}

function BubbleChart({ data, selected, onSelect, width = 800, height = 480 }) {
  const pad = { top: 44, right: 40, bottom: 54, left: 75 };
  const cw = width - pad.left - pad.right;
  const ch = height - pad.top - pad.bottom;

  if (!data || data.length === 0) return null;

  // X: commits (linear with padding), Y: market cap (log scale)
  const maxCommits = Math.max(...data.map(d => d.commits7d), 1);
  const mcaps = data.filter(d => d.marketCap > 0).map(d => d.marketCap);
  const minMcap = mcaps.length > 0 ? Math.min(...mcaps) : 1;
  const maxMcap = mcaps.length > 0 ? Math.max(...mcaps) : 1e6;
  const logMin = Math.log10(Math.max(minMcap * 0.3, 1));
  const logMax = Math.log10(maxMcap * 3);

  // Medians for quadrant lines — non-zero only
  const nonZeroCommits = data.filter(d => d.commits7d > 0).map(d => d.commits7d);
  const nonZeroMcaps = data.filter(d => d.marketCap > 0).map(d => d.marketCap);
  const medCommits = nonZeroCommits.length > 0
    ? [...nonZeroCommits].sort((a, b) => a - b)[Math.floor(nonZeroCommits.length / 2)]
    : maxCommits / 2;
  const medMcap = nonZeroMcaps.length > 0
    ? [...nonZeroMcaps].sort((a, b) => a - b)[Math.floor(nonZeroMcaps.length / 2)]
    : Math.sqrt(minMcap * maxMcap);

  // Reserve left ~8% of chart width as a "zero zone" column for 0-commit subnets
  const zeroZoneWidth = cw * 0.06;
  const activeWidth = cw - zeroZoneWidth;

  const xScale = (v, netuid) => {
    if (v === 0) {
      // Spread 0-commit bubbles with deterministic jitter within the zero zone
      return pad.left + 4 + hashJitter(netuid) * (zeroZoneWidth - 8);
    }
    return pad.left + zeroZoneWidth + (v / (maxCommits * 1.1)) * activeWidth;
  };
  const yScale = (v) => {
    const log = Math.log10(Math.max(v, 1));
    return pad.top + ch - ((log - logMin) / (logMax - logMin)) * ch;
  };

  // Bubble size: vol/mc ratio mapped to radius 3-18px (smaller to reduce clutter)
  const maxVolMc = Math.max(...data.map(d => d.volMcRatio), 1);
  const rScale = (v) => 3 + (v / maxVolMc) * 15;

  // Tier color
  const tierColor = (tier) => GEM_TIER_CONFIG[tier]?.color || "#555577";

  // Y axis ticks (log scale)
  const yTicks = [];
  for (let exp = Math.floor(logMin); exp <= Math.ceil(logMax); exp++) {
    const val = Math.pow(10, exp);
    if (val >= Math.pow(10, logMin) * 0.9 && val <= Math.pow(10, logMax) * 1.1) {
      yTicks.push(val);
    }
  }

  // X axis ticks
  const xStep = Math.max(1, Math.ceil(maxCommits / 6));
  const xTicks = [];
  for (let v = 0; v <= maxCommits * 1.1; v += xStep) {
    xTicks.push(v);
  }

  // Quadrant line positions
  const qx = xScale(medCommits, -1);
  const qy = yScale(medMcap);

  // Zero zone separator
  const zeroLineX = pad.left + zeroZoneWidth;

  const [hover, setHover] = useState(null);

  return (
    <svg width={width} height={height} style={{ background: "#0a0a14", borderRadius: "4px", display: "block", maxWidth: "100%", cursor: "crosshair" }}>
      {/* Grid lines */}
      {yTicks.map(v => (
        <line key={`yg${v}`} x1={pad.left} x2={width - pad.right} y1={yScale(v)} y2={yScale(v)} stroke="#111122" strokeWidth="1" />
      ))}
      {xTicks.map(v => (
        <line key={`xg${v}`} x1={xScale(v, -1)} x2={xScale(v, -1)} y1={pad.top} y2={height - pad.bottom} stroke="#111122" strokeWidth="1" />
      ))}

      {/* Zero zone separator — faint line between 0-commit zone and active zone */}
      <line x1={zeroLineX} x2={zeroLineX} y1={pad.top} y2={height - pad.bottom} stroke="#1a1a2e" strokeWidth="1" strokeDasharray="3,6" />
      <text x={pad.left + zeroZoneWidth / 2} y={pad.top - 6} fill="#222244" fontSize="8" fontFamily="inherit" textAnchor="middle">0 COMMITS</text>

      {/* Quadrant dividers */}
      <line x1={qx} x2={qx} y1={pad.top} y2={height - pad.bottom} stroke="#222244" strokeWidth="1" strokeDasharray="6,4" />
      <line x1={pad.left} x2={width - pad.right} y1={qy} y2={qy} stroke="#222244" strokeWidth="1" strokeDasharray="6,4" />

      {/* Quadrant labels */}
      <text x={qx - 6} y={pad.top + 16} fill={QUADRANTS.topLeft.color} fontSize="10" fontFamily="inherit" textAnchor="end" opacity="0.6">{QUADRANTS.topLeft.label}</text>
      <text x={width - pad.right - 8} y={pad.top + 16} fill={QUADRANTS.topRight.color} fontSize="10" fontFamily="inherit" textAnchor="end" opacity="0.6">{QUADRANTS.topRight.label}</text>
      <text x={qx - 6} y={height - pad.bottom - 8} fill={QUADRANTS.bottomLeft.color} fontSize="10" fontFamily="inherit" textAnchor="end" opacity="0.6">{QUADRANTS.bottomLeft.label}</text>
      <text x={width - pad.right - 8} y={height - pad.bottom - 8} fill={QUADRANTS.bottomRight.color} fontSize="10" fontFamily="inherit" textAnchor="end" opacity="0.8" fontWeight="700">{QUADRANTS.bottomRight.label}</text>

      {/* Axes */}
      <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} stroke="#222244" strokeWidth="1" />
      <line x1={pad.left} x2={pad.left} y1={pad.top} y2={height - pad.bottom} stroke="#222244" strokeWidth="1" />

      {/* Y axis labels */}
      {yTicks.map(v => (
        <text key={`yl${v}`} x={pad.left - 8} y={yScale(v) + 4} fill="#333355" fontSize="9" fontFamily="inherit" textAnchor="end">
          {v >= 1e9 ? `${(v/1e9).toFixed(0)}B` : v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : v}
        </text>
      ))}
      <text x={14} y={pad.top + ch / 2} fill="#333355" fontSize="10" fontFamily="inherit" textAnchor="middle" transform={`rotate(-90, 14, ${pad.top + ch / 2})`}>
        Market Cap (USD, log)
      </text>

      {/* X axis labels */}
      {xTicks.filter(v => v > 0).map(v => (
        <text key={`xl${v}`} x={xScale(v, -1)} y={height - pad.bottom + 16} fill="#333355" fontSize="9" fontFamily="inherit" textAnchor="middle">{v}</text>
      ))}
      <text x={pad.left + zeroZoneWidth + activeWidth / 2} y={height - 8} fill="#333355" fontSize="10" fontFamily="inherit" textAnchor="middle">
        7-Day Commit Count
      </text>

      {/* Bubbles — render 0-commit (gray) first so active bubbles draw on top */}
      {[...data].sort((a, b) => a.commits7d - b.commits7d).map((d) => {
        const cx = xScale(d.commits7d, d.netuid);
        const cy = yScale(Math.max(d.marketCap, 1));
        const r = rScale(d.volMcRatio);
        const color = tierColor(d.tier);
        const isSelected = selected === d.netuid;
        const isHovered = hover === d.netuid;

        return (
          <g key={d.netuid}>
            <circle
              cx={cx} cy={cy} r={r}
              fill={color + "40"}
              stroke={isSelected ? "#ffffff" : isHovered ? color : color + "80"}
              strokeWidth={isSelected ? 2 : isHovered ? 1.5 : 0.5}
              style={{ transition: "all 0.15s", cursor: "pointer" }}
              onMouseEnter={() => setHover(d.netuid)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect(d.netuid === selected ? null : d.netuid)}
            />
            {/* Label for visible bubbles */}
            {(r > 6 || isHovered || isSelected) && (
              <text
                x={cx} y={cy - r - 4}
                fill={isHovered || isSelected ? "#b0b0cc" : "#444466"}
                fontSize="8" fontFamily="inherit" textAnchor="middle"
                style={{ pointerEvents: "none" }}
              >
                SN{d.netuid}
              </text>
            )}
          </g>
        );
      })}

      {/* Hover tooltip */}
      {hover != null && (() => {
        const d = data.find(d => d.netuid === hover);
        if (!d) return null;
        const tx = Math.min(xScale(d.commits7d, d.netuid) + 12, width - 210);
        const ty = Math.max(yScale(Math.max(d.marketCap, 1)) - 80, pad.top);
        const cfg = GEM_TIER_CONFIG[d.tier];
        const signal = SIGNAL_LINES[d.quadrant] || "";
        return (
          <g style={{ pointerEvents: "none" }}>
            <rect x={tx} y={ty} width={200} height={92} rx={4} fill="#0d0d1a" stroke="#222244" strokeWidth="1" opacity="0.95" />
            <text x={tx + 8} y={ty + 16} fill="#b0b0cc" fontSize="11" fontFamily="inherit" fontWeight="600">{d.name} <tspan fill="#333355">SN{d.netuid}</tspan></text>
            <text x={tx + 8} y={ty + 30} fill="#555577" fontSize="9" fontFamily="inherit">MC: ${fN(d.marketCap)} | 7d commits: {d.commits7d}</text>
            <text x={tx + 8} y={ty + 43} fill="#555577" fontSize="9" fontFamily="inherit">Vol/MC: {d.volMcRatio.toFixed(1)}% | Gem Score: <tspan fill={cfg.color} fontWeight="600">{d.gemScore}</tspan></text>
            <text x={tx + 8} y={ty + 56} fill={cfg.color} fontSize="9" fontFamily="inherit">{cfg.icon} {cfg.label}</text>
            <text x={tx + 8} y={ty + 72} fill="#666688" fontSize="8" fontFamily="inherit" fontStyle="italic">{signal.length > 42 ? signal.substring(0, 42) + "..." : signal}</text>
          </g>
        );
      })()}
    </svg>
  );
}

// ─── Custom Legend ──────────────────────────────────────────
function ChartLegend() {
  return (
    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", padding: "8px 0" }}>
      {Object.entries(GEM_TIER_CONFIG).map(([key, cfg]) => (
        <div key={key} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: cfg.color + "60", border: `1px solid ${cfg.color}` }} />
          <span style={{ color: cfg.color, fontSize: "10px" }}>{cfg.icon} {cfg.label}</span>
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "8px" }}>
        <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#555577" }} />
        <span style={{ color: "#333355", fontSize: "9px" }}>small</span>
        <div style={{ width: "16px", height: "16px", borderRadius: "50%", background: "#55557730" }} />
        <span style={{ color: "#333355", fontSize: "9px" }}>large = higher Vol/MC</span>
      </div>
    </div>
  );
}

// ─── Detail Card (shown when a bubble is clicked) ──────────
function DetailCard({ item }) {
  if (!item) return null;
  const cfg = GEM_TIER_CONFIG[item.tier];
  const signal = SIGNAL_LINES[item.quadrant] || "";
  return (
    <div style={{
      margin: "0 18px 14px", padding: "14px 18px",
      background: cfg.bg, border: `1px solid ${cfg.border}`,
      borderRadius: "4px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: cfg.color, fontWeight: 700, fontSize: "14px" }}>{cfg.icon} {item.name}</span>
          <span style={{ color: "#333355", fontSize: "11px" }}>SN{item.netuid}</span>
          <span style={{ background: cfg.color + "20", border: `1px solid ${cfg.color}40`, color: cfg.color, padding: "2px 8px", borderRadius: "3px", fontSize: "10px", fontWeight: 600 }}>
            {cfg.label} — {item.gemScore}
          </span>
        </div>
        {item.repoUrl && (
          <a href={item.repoUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#4488ff", fontSize: "10px", textDecoration: "none" }}>
            view repo {"\u2197"}
          </a>
        )}
      </div>
      <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", fontSize: "11px", marginBottom: "8px" }}>
        <span style={{ color: "#555577" }}>Market Cap: <span style={{ color: "#8888aa", fontWeight: 600 }}>${fN(item.marketCap)}</span></span>
        <span style={{ color: "#555577" }}>7d Commits: <span style={{ color: item.commits7d > 0 ? "#33bb66" : "#333355", fontWeight: 600 }}>{item.commits7d}{!item.hasRepo ? " (no public repo)" : ""}</span></span>
        <span style={{ color: "#555577" }}>Vol/MC: <span style={{ color: item.volMcRatio >= 20 ? "#ff4455" : "#8888aa", fontWeight: 600 }}>{item.volMcRatio.toFixed(1)}%</span></span>
        <span style={{ color: "#555577" }}>Dev Score: <span style={{ color: "#8888aa" }}>{item.devScore}</span></span>
        <span style={{ color: "#555577" }}>Value Score: <span style={{ color: "#8888aa" }}>{item.valueScore}</span></span>
      </div>
      <div style={{ color: "#7777aa", fontSize: "11px", fontStyle: "italic" }}>{signal}</div>
    </div>
  );
}

// ─── Gem Leaderboard ───────────────────────────────────────
function GemLeaderboard({ data }) {
  // Only show subnets that are ACTUALLY shipping code (commits > 0) AND in gem quadrant
  const gems = data
    .filter(d => d.quadrant === "gem" && d.commits7d > 0)
    .sort((a, b) => b.gemScore - a.gemScore)
    .slice(0, 10);
  if (gems.length === 0) return null;

  return (
    <div style={{ padding: "14px 18px", borderBottom: "1px solid #0d0d1e" }}>
      <div style={{ color: "#333355", fontSize: "10px", letterSpacing: "0.15em", fontWeight: 600, marginBottom: "10px" }}>
        {"\u{1F48E}"} GEM ZONE LEADERBOARD — TOP 10 BY GEM SCORE
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#0a0a14", borderBottom: "1px solid #131326" }}>
            <th style={{ padding: "6px 8px", fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "left", width: "30px" }}>#</th>
            <th style={{ padding: "6px 8px", fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "left" }}>SUBNET</th>
            <th style={{ padding: "6px 8px", fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "right", width: "70px" }}>GEM SCORE</th>
            <th style={{ padding: "6px 8px", fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "right", width: "60px" }}>7D COMMITS</th>
            <th style={{ padding: "6px 8px", fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "right", width: "70px" }}>MKT CAP</th>
            <th style={{ padding: "6px 8px", fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "right", width: "50px" }}>VOL/MC</th>
            <th style={{ padding: "6px 8px", fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "left" }}>SIGNAL</th>
          </tr>
        </thead>
        <tbody>
          {gems.map((g, i) => {
            const cfg = GEM_TIER_CONFIG[g.tier];
            return (
              <tr key={g.netuid} className="trow" style={{ background: i % 2 === 0 ? "#0b0b15" : "#090912", borderBottom: "1px solid #0e0e18" }}>
                <td style={{ padding: "8px 8px", color: "#282844" }}>{i + 1}</td>
                <td style={{ padding: "8px 8px" }}>
                  <span style={{ color: "#33bb66", fontWeight: 600 }}>{g.name}</span>
                  <span style={{ color: "#1e1e30", fontSize: "10px", marginLeft: "7px" }}>SN{g.netuid}</span>
                </td>
                <td style={{ padding: "8px 8px", textAlign: "right" }}>
                  <span style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color, padding: "2px 8px", borderRadius: "3px", fontSize: "12px", fontWeight: 700 }}>
                    {g.gemScore}
                  </span>
                </td>
                <td style={{ padding: "8px 8px", textAlign: "right", color: g.commits7d > 0 ? "#33bb66" : "#333355", fontWeight: 600 }}>
                  {g.commits7d}
                </td>
                <td style={{ padding: "8px 8px", textAlign: "right", color: "#555577" }}>${fN(g.marketCap)}</td>
                <td style={{ padding: "8px 8px", textAlign: "right", color: g.volMcRatio >= 20 ? "#ff4455" : "#555577" }}>{g.volMcRatio.toFixed(1)}%</td>
                <td style={{ padding: "8px 8px", color: "#666688", fontSize: "10px", fontStyle: "italic" }}>
                  {SIGNAL_LINES[g.quadrant]}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────
export default function GemScanner() {
  const { refreshTaoStats, refreshCoinGecko } = useSharedData();
  const [scored, setScored] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [ts, setTs] = useState(null);
  const [progress, setProgress] = useState(null);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("all");
  const [auto, setAuto] = useState(false);
  const [freq] = useState(300); // 5 min default
  const timerRef = useRef();
  const scanningRef = useRef(false);

  const scan = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setLoading(true);
    setErr(null);
    setProgress("Fetching TaoStats + CoinGecko...");
    try {
      const [tsData, cgData, devMap] = await Promise.all([
        refreshTaoStats(),
        refreshCoinGecko(),
        fetchDevActivity(),
      ]);

      setProgress("Scoring subnets...");
      const results = scoreGems(tsData.subnets, tsData.pools, tsData.meta, devMap, cgData);
      setScored(results);
      setTs(new Date());
      setProgress(null);
    } catch (e) {
      setErr(e.message || String(e));
    }
    setLoading(false);
    scanningRef.current = false;
  }, []);

  useEffect(() => { scan(); }, []);
  useEffect(() => {
    clearInterval(timerRef.current);
    if (auto) timerRef.current = setInterval(scan, freq * 1000);
    return () => clearInterval(timerRef.current);
  }, [auto, freq, scan]);

  const filtered = scored.filter(s =>
    filter === "all" ? true :
    filter === "gem" ? s.quadrant === "gem" :
    filter === "overhyped" ? s.quadrant === "overhyped" :
    filter === "established" ? s.quadrant === "established" :
    filter === "dormant" ? s.quadrant === "dormant" : true
  );

  const selectedItem = scored.find(s => s.netuid === selected) || null;

  const counts = {
    total: scored.length,
    gem: scored.filter(s => s.quadrant === "gem").length,
    established: scored.filter(s => s.quadrant === "established").length,
    overhyped: scored.filter(s => s.quadrant === "overhyped").length,
    dormant: scored.filter(s => s.quadrant === "dormant").length,
    withRepos: scored.filter(s => s.hasRepo).length,
  };

  const S = {
    root: { fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace", background: "#070710", color: "#b0b0cc", minHeight: "100vh", fontSize: "12px" },
    header: { background: "#0d0d1a", borderBottom: "1px solid #151528", padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" },
    title: { color: "#33bb66", fontWeight: 700, fontSize: "14px", letterSpacing: "0.08em" },
    btn: (dis) => ({ background: dis ? "#10101e" : "#1818cc", border: "none", color: dis ? "#2a2a44" : "#fff", padding: "6px 16px", borderRadius: "3px", cursor: dis ? "not-allowed" : "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 600, letterSpacing: "0.05em" }),
    filterBtn: (active) => ({ background: active ? "#1a1a3a" : "transparent", border: `1px solid ${active ? "#333366" : "#1a1a2e"}`, color: active ? "#8888cc" : "#333355", padding: "3px 10px", borderRadius: "3px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit" }),
    section: { padding: "14px 18px", borderBottom: "1px solid #0d0d1e" },
  };

  // Responsive chart width
  const chartRef = useRef(null);
  const [chartWidth, setChartWidth] = useState(800);
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setChartWidth(Math.max(400, entry.contentRect.width - 36));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div style={S.root} ref={chartRef}>
      {/* Header */}
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={S.title}>{"\u{1F48E}"} GEM SCAN</span>
          {counts.gem > 0 && (
            <span style={{ background: "#33bb6622", border: "1px solid #33bb66", color: "#33bb66", padding: "2px 8px", borderRadius: "3px", fontSize: "10px", animation: "pulse 1.2s infinite" }}>
              {counts.gem} GEM{counts.gem > 1 ? "S" : ""}
            </span>
          )}
          {counts.overhyped > 0 && (
            <span style={{ background: "#ddaa0015", border: "1px solid #ddaa0040", color: "#ddaa00", padding: "2px 8px", borderRadius: "3px", fontSize: "10px" }}>
              {counts.overhyped} OVERHYPED
            </span>
          )}
          {ts && <span style={{ color: "#2a2a44", fontSize: "10px" }}>{"\u23F1"} {ts.toLocaleTimeString()}</span>}
        </div>
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          <button onClick={() => setFilter("all")} style={S.filterBtn(filter === "all")}>ALL</button>
          <button onClick={() => setFilter("gem")} style={S.filterBtn(filter === "gem")}>{"\u{1F48E}"} GEM</button>
          <button onClick={() => setFilter("overhyped")} style={S.filterBtn(filter === "overhyped")}>{"\u26A0"} OVERHYPED</button>
          <button onClick={() => setFilter("established")} style={S.filterBtn(filter === "established")}>{"\u{1F3C6}"} ESTABLISHED</button>
          <button onClick={() => setFilter("dormant")} style={S.filterBtn(filter === "dormant")}>{"\u{1F4A4}"} DORMANT</button>
          <div style={{ width: "8px" }} />
          <label style={{ color: "#282844", fontSize: "10px", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}>
            <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} style={{ accentColor: "#1818cc" }} />
            AUTO 5m
          </label>
          <button onClick={scan} disabled={loading} style={S.btn(loading)}>
            {loading ? "SCANNING..." : "\u27F3 SCAN GEMS"}
          </button>
        </div>
      </div>

      {/* Methodology bar */}
      <div style={{ background: "#0a0a13", borderBottom: "1px solid #131326", padding: "5px 18px", display: "flex", gap: "18px", flexWrap: "wrap", fontSize: "10px" }}>
        <span style={{ color: "#1e1e33" }}>FORMULA:</span>
        <span style={{ color: "#282844" }}>Dev Score (7d commits) {"\u00D7"}60%</span>
        <span style={{ color: "#282844" }}>Value Score (inv. MC) {"\u00D7"}40%</span>
        <span style={{ color: "#1e1e33" }}>{"\u00B7"}</span>
        <span style={{ color: GEM_TIER_CONFIG.gem.color }}>{"\u{1F48E}"} GEM {"\u2265"}75</span>
        <span style={{ color: GEM_TIER_CONFIG.moderate.color }}>{"\u{1F535}"} MOD {"\u2265"}50</span>
        <span style={{ color: GEM_TIER_CONFIG.mixed.color }}>{"\u{1F7E1}"} MIX {"\u2265"}35</span>
        <span style={{ color: GEM_TIER_CONFIG.gray.color }}>{"\u26AA"} GRAY {"<"}35</span>
      </div>

      {/* Error */}
      {err && (
        <div style={{ margin: "12px 18px", padding: "10px 14px", background: "#ff000f10", border: "1px solid #ff003330", borderRadius: "4px", color: "#ff4455", fontSize: "11px" }}>
          {err}
        </div>
      )}

      {/* Loading */}
      {loading && scored.length === 0 && (
        <div style={{ padding: "70px", textAlign: "center", color: "#1e1e33" }}>
          <div style={{ fontSize: "28px", animation: "pulse 1s infinite" }}>{"\u{1F48E}"}</div>
          <div style={{ marginTop: "12px", letterSpacing: "0.2em", fontSize: "13px" }}>SCANNING FOR GEMS...</div>
          {progress && <div style={{ color: "#282844", marginTop: "6px", fontSize: "10px" }}>{progress}</div>}
        </div>
      )}

      {/* Progress indicator during refresh */}
      {loading && scored.length > 0 && progress && (
        <div style={{ padding: "4px 18px", background: "#0a0a13", borderBottom: "1px solid #131326", color: "#333355", fontSize: "10px" }}>
          {"\u27F3"} {progress}
        </div>
      )}

      {/* Scatter Plot */}
      {filtered.length > 0 && (
        <div style={S.section}>
          <div style={{ color: "#333355", fontSize: "10px", letterSpacing: "0.15em", fontWeight: 600, marginBottom: "6px" }}>
            DEV ACTIVITY vs MARKET CAP — {filtered.length} SUBNETS | {counts.withRepos} WITH PUBLIC REPOS
          </div>
          <ChartLegend />
          <div style={{ overflowX: "auto" }}>
            <BubbleChart
              data={filtered}
              selected={selected}
              onSelect={setSelected}
              width={chartWidth}
              height={Math.max(400, Math.min(560, chartWidth * 0.55))}
            />
          </div>
        </div>
      )}

      {/* Selected Detail Card */}
      {selectedItem && <DetailCard item={selectedItem} />}

      {/* Gem Zone Leaderboard */}
      {scored.length > 0 && <GemLeaderboard data={scored} />}

      {/* Full table */}
      {scored.length > 0 && (
        <div style={{ padding: "14px 0", borderBottom: "1px solid #0d0d1e" }}>
          <div style={{ padding: "0 18px", color: "#333355", fontSize: "10px", letterSpacing: "0.15em", fontWeight: 600, marginBottom: "10px" }}>
            {"\u25C8"} ALL SUBNETS — RANKED BY GEM SCORE
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "800px" }}>
              <thead>
                <tr style={{ background: "#0a0a14", borderBottom: "1px solid #131326" }}>
                  <th style={{ padding: "6px 8px", fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "left", width: "30px" }}>#</th>
                  <th style={{ padding: "6px 8px", fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "left" }}>SUBNET</th>
                  <th style={{ padding: "6px 8px", fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "right", width: "70px" }}>GEM</th>
                  <th style={{ padding: "6px 8px", fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "right", width: "50px" }}>TIER</th>
                  <th style={{ padding: "6px 8px", fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "right", width: "50px" }}>QUAD</th>
                  <th style={{ padding: "6px 8px", fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "right", width: "60px" }}>DEV</th>
                  <th style={{ padding: "6px 8px", fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "right", width: "50px" }}>VAL</th>
                  <th style={{ padding: "6px 8px", fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "right", width: "60px" }}>7D CMTS</th>
                  <th style={{ padding: "6px 8px", fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "right", width: "70px" }}>MKT CAP</th>
                  <th style={{ padding: "6px 8px", fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "right", width: "50px" }}>VOL/MC</th>
                </tr>
              </thead>
              <tbody>
                {(filter === "all" ? scored : filtered).map((s, i) => {
                  const cfg = GEM_TIER_CONFIG[s.tier];
                  const qCfg = QUADRANTS[s.quadrant === "gem" ? "bottomRight" : s.quadrant === "established" ? "topRight" : s.quadrant === "overhyped" ? "topLeft" : "bottomLeft"];
                  const rowBg = s.quadrant === "gem"
                    ? `linear-gradient(90deg, ${cfg.bg} 0%, #070710 60%)`
                    : i % 2 === 0 ? "#0b0b15" : "#090912";
                  const isActive = selected === s.netuid;
                  return (
                    <tr
                      key={s.netuid}
                      className="trow"
                      style={{ background: isActive ? "#111120" : rowBg, borderBottom: "1px solid #0e0e18", cursor: "pointer" }}
                      onClick={() => setSelected(s.netuid === selected ? null : s.netuid)}
                    >
                      <td style={{ padding: "8px 8px", color: "#1e1e33" }}>{i + 1}</td>
                      <td style={{ padding: "8px 8px" }}>
                        <span style={{ color: cfg.color, fontWeight: s.tier === "gem" ? 600 : 400 }}>{s.name}</span>
                        <span style={{ color: "#1e1e30", fontSize: "10px", marginLeft: "7px" }}>SN{s.netuid}</span>
                        {!s.hasRepo && <span style={{ color: "#2a2a44", fontSize: "8px", marginLeft: "5px" }}>no repo</span>}
                      </td>
                      <td style={{ padding: "8px 8px", textAlign: "right" }}>
                        <span style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color, padding: "2px 8px", borderRadius: "3px", fontSize: "12px", fontWeight: 700 }}>
                          {s.gemScore}
                        </span>
                      </td>
                      <td style={{ padding: "8px 8px", textAlign: "right", color: cfg.color, fontSize: "10px", fontWeight: 600 }}>{cfg.icon}</td>
                      <td style={{ padding: "8px 8px", textAlign: "right", color: qCfg.color, fontSize: "9px" }}>
                        {s.quadrant === "gem" ? "\u{1F48E}" : s.quadrant === "established" ? "\u{1F3C6}" : s.quadrant === "overhyped" ? "\u26A0" : "\u{1F4A4}"}
                      </td>
                      <td style={{ padding: "8px 8px", textAlign: "right", color: "#555577", fontSize: "11px" }}>{s.devScore.toFixed(0)}</td>
                      <td style={{ padding: "8px 8px", textAlign: "right", color: "#555577", fontSize: "11px" }}>{s.valueScore.toFixed(0)}</td>
                      <td style={{ padding: "8px 8px", textAlign: "right", color: s.commits7d > 0 ? "#33bb66" : "#333355", fontWeight: 600 }}>{s.commits7d}</td>
                      <td style={{ padding: "8px 8px", textAlign: "right", color: "#555577" }}>${fN(s.marketCap)}</td>
                      <td style={{ padding: "8px 8px", textAlign: "right", color: s.volMcRatio >= 20 ? "#ff4455" : "#555577" }}>{s.volMcRatio.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: "12px 18px", borderTop: "1px solid #0d0d1e", color: "#141420", fontSize: "10px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "6px" }}>
        <span>Data: GitHub API + CoinGecko + TaoStats {"\u00B7"} Gem Score = Dev Activity (60%) + Value Opportunity (40%) {"\u00B7"} Not financial advice</span>
        <span>Crypto Millie {"\u2014"} Capital Rotation Intelligence</span>
      </div>
    </div>
  );
}
