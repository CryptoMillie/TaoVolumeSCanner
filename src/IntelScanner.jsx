import { useState, useEffect, useCallback, useRef } from "react";
import { fetchAllSRIData, fetchPoolLatest, fetchSubnetMeta } from "./sri/api.js";
import { scoreInstitutional } from "./intel/scoring.js";
import { detectSpikes, getTopMovers } from "./intel/news.js";
import { INST_TIER_CONFIG, INST_DIMENSION_LABELS, TOP_MOVERS_COUNT } from "./intel/constants.js";

function fV(v) { return v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${v.toFixed(0)}`; }
function fP(v) { return (v >= 0 ? "+" : "") + v.toFixed(1) + "%"; }

async function fetchCoinGeckoSubnets() {
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
  return res.json();
}

function SubnetLogo({ url, name }) {
  const [errored, setErrored] = useState(false);
  if (!url || errored) return null;
  return (
    <img
      src={url}
      alt={name}
      onError={() => setErrored(true)}
      style={{ width: "16px", height: "16px", borderRadius: "3px", marginRight: "6px", verticalAlign: "middle", objectFit: "cover" }}
    />
  );
}

function DimensionBar({ value, color }) {
  return (
    <div style={{ width: "48px", height: "6px", background: "#0a0a14", borderRadius: "3px", overflow: "hidden", display: "inline-block" }}>
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: "100%", background: color, borderRadius: "3px" }} />
    </div>
  );
}

function AlertCard({ alert }) {
  const isUp = alert.direction === "up";
  const borderColor = isUp ? "#33bb66" : "#ff4455";
  const bgColor = isUp ? "#0a1a10" : "#1a0010";
  const textColor = isUp ? "#33bb66" : "#ff4455";

  return (
    <div style={{
      background: bgColor,
      border: `1px solid ${borderColor}`,
      borderRadius: "4px",
      padding: "10px 14px",
      animation: "pulse 1.5s infinite",
      minWidth: "260px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
        <span style={{ color: textColor, fontWeight: 700, fontSize: "12px" }}>
          {isUp ? "\u25B2" : "\u25BC"} {alert.name}
        </span>
        <span style={{ color: "#2a2a44", fontSize: "9px" }}>{alert.timestamp}</span>
      </div>
      <div style={{ fontSize: "10px", color: "#8888aa" }}>
        Vol spike <span style={{ color: "#ff8833", fontWeight: 600 }}>+{alert.spikePct.toFixed(0)}%</span>
        {" \u2014 "}
        ${fV(alert.volume)} vol
        {" \u2014 "}
        <span style={{ color: textColor }}>{fP(alert.priceChange24h)}</span> 24h
      </div>
    </div>
  );
}

function NewsFeedCard({ mover }) {
  const isUp = mover.direction === "up";
  const borderColor = isUp ? "#1a3a20" : "#3a0020";
  const accentColor = isUp ? "#33bb66" : "#ff4455";

  return (
    <div style={{
      background: "#0b0b15",
      borderLeft: `3px solid ${accentColor}`,
      borderRadius: "0 4px 4px 0",
      padding: "12px 16px",
      marginBottom: "8px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: accentColor, fontWeight: 700, fontSize: "13px" }}>
            {isUp ? "\u25B2" : "\u25BC"} {fP(mover.price_change_percentage_24h || 0)}
          </span>
          <span style={{ color: "#b0b0cc", fontWeight: 600, fontSize: "12px" }}>{mover.name}</span>
          <span style={{ color: "#2a2a44", fontSize: "10px" }}>{mover.symbol?.toUpperCase()}</span>
        </div>
        <div style={{ color: "#444466", fontSize: "10px" }}>
          Vol: ${fV(mover.total_volume)} | MC: ${fV(mover.market_cap || 0)}
        </div>
      </div>
      <p style={{ color: "#7777aa", fontSize: "11px", lineHeight: "1.6", margin: 0 }}>
        {mover.summary}
      </p>
    </div>
  );
}

export default function IntelScanner() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [ts, setTs] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [movers, setMovers] = useState([]);
  const [scores, setScores] = useState([]);
  const [sortBy, setSortBy] = useState("composite");
  const [sortDir, setSortDir] = useState("desc");
  const prevVolRef = useRef({});

  const scan = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [cgData, sriData] = await Promise.all([
        fetchCoinGeckoSubnets(),
        fetchAllSRIData(),
      ]);

      // Build name lookup: "sn44" -> best name from TaoStats pools + GitHub meta
      // Same logic as VolumeScanner — handles mechid 0 and 1
      const pools = Array.isArray(sriData.pools) ? sriData.pools : (sriData.pools?.data || []);
      const metaRaw = sriData.meta || {};
      const nameMap = {};
      pools.forEach(p => {
        const id = p.netuid ?? p.subnet_id;
        if (id == null) return;
        const key = `sn${id}`;
        if (p.name && p.name !== "Unknown") { nameMap[key] = p.name; return; }
        const me = metaRaw[String(id)];
        if (me?.name) nameMap[key] = me.name;
      });

      // Apply resolved names to CoinGecko data
      const namedCgData = cgData.map(s => ({
        ...s,
        name: nameMap[s.symbol] || s.name,
      }));

      // Volume spike detection
      const newAlerts = detectSpikes(namedCgData, prevVolRef.current);
      if (newAlerts.length > 0) {
        setAlerts(prev => [...newAlerts, ...prev].slice(0, 12));
      }

      // Store current volumes for next comparison
      const volMap = {};
      namedCgData.forEach(s => { volMap[s.id || s.symbol] = s.total_volume; });
      prevVolRef.current = volMap;

      // News feed — top movers with summaries
      const topMovers = getTopMovers(namedCgData, sriData.pools, TOP_MOVERS_COUNT);
      setMovers(topMovers);

      // Institutional scores
      const instScores = scoreInstitutional(sriData.subnets, sriData.pools, sriData.meta);
      setScores(instScores);

      setTs(new Date());
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { scan(); }, []);

  const sortedScores = [...scores].sort((a, b) => {
    let aVal, bVal;
    if (sortBy === "composite") { aVal = a.composite; bVal = b.composite; }
    else if (sortBy === "REV") { aVal = a.dimensions.REV; bVal = b.dimensions.REV; }
    else if (sortBy === "TAM") { aVal = a.dimensions.TAM; bVal = b.dimensions.TAM; }
    else if (sortBy === "PMF") { aVal = a.dimensions.PMF; bVal = b.dimensions.PMF; }
    else { aVal = a.composite; bVal = b.composite; }
    return sortDir === "desc" ? bVal - aVal : aVal - bVal;
  });

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortBy(col); setSortDir("desc"); }
  };

  const S = {
    root: { fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace", background: "#070710", color: "#b0b0cc", minHeight: "100vh", fontSize: "12px" },
    header: { background: "#0d0d1a", borderBottom: "1px solid #151528", padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" },
    title: { color: "#8855ff", fontWeight: 700, fontSize: "14px", letterSpacing: "0.08em" },
    btn: (dis) => ({ background: dis ? "#10101e" : "#1818cc", border: "none", color: dis ? "#2a2a44" : "#fff", padding: "6px 16px", borderRadius: "3px", cursor: dis ? "not-allowed" : "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 600, letterSpacing: "0.05em" }),
    section: { padding: "14px 18px", borderBottom: "1px solid #0d0d1e" },
    sectionTitle: { color: "#333355", fontSize: "10px", letterSpacing: "0.15em", fontWeight: 600, marginBottom: "10px" },
    th: { padding: "6px 8px", fontWeight: 400, fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "right", cursor: "pointer", userSelect: "none" },
    thLeft: { padding: "6px 8px", fontWeight: 400, fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "left" },
    cell: { padding: "8px 8px", textAlign: "right" },
    cellLeft: { padding: "8px 8px", textAlign: "left" },
  };

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={S.title}>{"\u25C8"} INTEL FEED</span>
          {alerts.length > 0 && (
            <span style={{ background: "#ff003322", border: "1px solid #ff0033", color: "#ff4455", padding: "2px 8px", borderRadius: "3px", fontSize: "10px", animation: "pulse 1.2s infinite" }}>
              {alerts.length} ALERT{alerts.length > 1 ? "S" : ""}
            </span>
          )}
          {ts && <span style={{ color: "#2a2a44", fontSize: "10px" }}>{"\u23F1"} {ts.toLocaleTimeString()}</span>}
        </div>
        <button onClick={scan} disabled={loading} style={S.btn(loading)}>
          {loading ? "SCANNING..." : "\u27F3 REFRESH INTEL"}
        </button>
      </div>

      {/* Error */}
      {err && (
        <div style={{ margin: "12px 18px", padding: "10px 14px", background: "#ff000f10", border: "1px solid #ff003330", borderRadius: "4px", color: "#ff4455", fontSize: "11px" }}>
          {err}
        </div>
      )}

      {/* Loading */}
      {loading && scores.length === 0 && (
        <div style={{ padding: "70px", textAlign: "center", color: "#1e1e33" }}>
          <div style={{ fontSize: "28px", animation: "pulse 1s infinite" }}>{"\u25C8"}</div>
          <div style={{ marginTop: "12px", letterSpacing: "0.2em", fontSize: "13px" }}>GATHERING INTELLIGENCE...</div>
          <div style={{ color: "#141426", marginTop: "6px", fontSize: "10px" }}>CoinGecko + TaoStats</div>
        </div>
      )}

      {/* Volume Spike Alerts */}
      {alerts.length > 0 && (
        <div style={S.section}>
          <div style={S.sectionTitle}>{"\u{1F6A8}"} VOLUME SPIKE ALERTS</div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {alerts.slice(0, 6).map((a, i) => <AlertCard key={`${a.id}-${i}`} alert={a} />)}
          </div>
        </div>
      )}

      {/* News Feed — Top Movers with Summaries */}
      {movers.length > 0 && (
        <div style={S.section}>
          <div style={S.sectionTitle}>{"\u26A1"} BREAKING MOVES — WHY IT'S HAPPENING</div>
          {movers.map((m, i) => <NewsFeedCard key={`${m.symbol}-${i}`} mover={m} />)}
        </div>
      )}

      {/* Institutional Score Table */}
      {sortedScores.length > 0 && (
        <div style={{ ...S.section, padding: "14px 0" }}>
          <div style={{ ...S.sectionTitle, padding: "0 18px" }}>{"\u{1F3E6}"} INSTITUTIONAL SCORE — REVENUE / TAM / PMF</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "700px" }}>
              <thead>
                <tr style={{ background: "#0a0a14", borderBottom: "1px solid #131326" }}>
                  <th style={{ ...S.thLeft, width: "30px" }}>#</th>
                  <th style={S.thLeft}>SUBNET</th>
                  <th style={S.th} onClick={() => toggleSort("composite")}>
                    SCORE {sortBy === "composite" ? (sortDir === "desc" ? "\u25BC" : "\u25B2") : ""}
                  </th>
                  <th style={S.th}>TIER</th>
                  <th style={S.th} onClick={() => toggleSort("REV")}>
                    REV {sortBy === "REV" ? (sortDir === "desc" ? "\u25BC" : "\u25B2") : ""}
                  </th>
                  <th style={S.th} onClick={() => toggleSort("TAM")}>
                    TAM {sortBy === "TAM" ? (sortDir === "desc" ? "\u25BC" : "\u25B2") : ""}
                  </th>
                  <th style={S.th} onClick={() => toggleSort("PMF")}>
                    PMF {sortBy === "PMF" ? (sortDir === "desc" ? "\u25BC" : "\u25B2") : ""}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedScores.map((s, i) => {
                  const cfg = INST_TIER_CONFIG[s.tier];
                  const rowBg = i % 2 === 0 ? "#0b0b15" : "#090912";
                  return (
                    <tr key={s.netuid} className="trow" style={{ background: rowBg, borderBottom: "1px solid #0e0e18" }}>
                      <td style={{ ...S.cellLeft, color: "#1e1e33" }}>{i + 1}</td>
                      <td style={S.cellLeft}>
                        <SubnetLogo url={s.logo} name={s.name} />
                        <span style={{ color: "#b0b0cc", fontWeight: 500 }}>{s.name}</span>
                        <span style={{ color: "#1e1e30", fontSize: "10px", marginLeft: "7px" }}>SN{s.netuid}</span>
                      </td>
                      <td style={S.cell}>
                        <span style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color, padding: "2px 8px", borderRadius: "3px", fontSize: "12px", fontWeight: 700 }}>
                          {s.composite}
                        </span>
                      </td>
                      <td style={{ ...S.cell, color: cfg.color, fontSize: "10px", fontWeight: 600, letterSpacing: "0.05em" }}>
                        {cfg.label}
                      </td>
                      <td style={S.cell}>
                        <DimensionBar value={s.dimensions.REV} color="#33bb66" />
                        <span style={{ color: "#555577", fontSize: "10px", marginLeft: "6px" }}>{s.dimensions.REV.toFixed(0)}</span>
                      </td>
                      <td style={S.cell}>
                        <DimensionBar value={s.dimensions.TAM} color="#4488ff" />
                        <span style={{ color: "#555577", fontSize: "10px", marginLeft: "6px" }}>{s.dimensions.TAM.toFixed(0)}</span>
                      </td>
                      <td style={S.cell}>
                        <DimensionBar value={s.dimensions.PMF} color="#dd44ff" />
                        <span style={{ color: "#555577", fontSize: "10px", marginLeft: "6px" }}>{s.dimensions.PMF.toFixed(0)}</span>
                      </td>
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
        <span>Data: CoinGecko + TaoStats {"\u00B7"} Institutional Score = Revenue + TAM + PMF (percentile-ranked) {"\u00B7"} Not financial advice</span>
        <span>Crypto Millie {"\u2014"} Capital Rotation Intelligence</span>
      </div>
    </div>
  );
}
