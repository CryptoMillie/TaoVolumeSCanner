import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSharedData } from "./DataContext.jsx";
import { fetchColdkeyDistributionMap } from "./sri/api.js";
import { scoreWhales } from "./whale/scoring.js";
import { WHALE_TIER_CONFIG, WHALE_SIGNAL_LABELS, WHALE_SIGNAL_WEIGHTS, IMPACT_COLORS } from "./whale/constants.js";

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

function ScoreBadge({ score, tier }) {
  const cfg = WHALE_TIER_CONFIG[tier];
  return (
    <span style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color, padding: "2px 8px", borderRadius: "3px", fontSize: "12px", fontWeight: 700, minWidth: "36px", display: "inline-block", textAlign: "center" }}>
      {score}
    </span>
  );
}

function TierLabel({ tier }) {
  const cfg = WHALE_TIER_CONFIG[tier];
  return <span style={{ color: cfg.color, fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em" }}>{cfg.icon} {cfg.label}</span>;
}

function FlagBadge({ flag }) {
  return (
    <span
      title={flag.desc}
      style={{ background: "#ff000f18", border: "1px solid #ff003340", color: "#ff4455", padding: "1px 5px", borderRadius: "3px", fontSize: "8px", fontWeight: 700, letterSpacing: "0.04em", marginRight: "3px" }}
    >
      {flag.label}
    </span>
  );
}

function ImpactBadge({ pct, severity }) {
  const color = IMPACT_COLORS[severity] || "#555577";
  return (
    <span style={{ color, fontWeight: severity === "CRITICAL" || severity === "HIGH" ? 700 : 400, fontSize: "11px" }}>
      {pct.toFixed(1)}%
    </span>
  );
}

function fTao(v) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${v.toFixed(0)}`;
}

function SignalBar({ score, label }) {
  const color = score >= 70 ? "#33bb66" : score >= 40 ? "#ddaa00" : "#ff4455";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
      <span style={{ color: "#282844", fontSize: "9px", width: "140px" }}>{label}</span>
      <div style={{ width: "80px", height: "6px", background: "#0d0d1a", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ width: `${Math.max(0, Math.min(100, score))}%`, height: "100%", background: color, borderRadius: "3px" }} />
      </div>
      <span style={{ color, fontSize: "10px", fontWeight: 600, minWidth: "28px" }}>{score.toFixed(1)}</span>
    </div>
  );
}

function truncateColdkey(ck) {
  if (!ck || ck.length < 12) return ck || "unknown";
  return ck.slice(0, 6) + "\u2026" + ck.slice(-4);
}

function ExpandedRow({ item }) {
  return (
    <tr>
      <td colSpan={10} style={{ padding: "0" }}>
        <div style={{ padding: "12px 18px 12px 40px", background: "#0a0a14", borderBottom: "1px solid #131326" }}>
          <div style={{ display: "flex", gap: "28px", flexWrap: "wrap" }}>
            {/* Signal Breakdown */}
            {item.signals ? (
              <div style={{ minWidth: "260px" }}>
                <div style={{ color: "#333355", fontSize: "9px", letterSpacing: "0.1em", marginBottom: "6px" }}>SIGNAL BREAKDOWN</div>
                <SignalBar score={item.signals.top1.score} label={`${WHALE_SIGNAL_LABELS.TOP1} (${Math.round(WHALE_SIGNAL_WEIGHTS.TOP1 * 100)}%)`} />
                <SignalBar score={item.signals.top5.score} label={`${WHALE_SIGNAL_LABELS.TOP5} (${Math.round(WHALE_SIGNAL_WEIGHTS.TOP5 * 100)}%)`} />
                <SignalBar score={item.signals.hhi.score} label={`${WHALE_SIGNAL_LABELS.HHI} (${Math.round(WHALE_SIGNAL_WEIGHTS.HHI * 100)}%)`} />
                <SignalBar score={item.signals.impact.score} label={`${WHALE_SIGNAL_LABELS.IMPACT} (${Math.round(WHALE_SIGNAL_WEIGHTS.IMPACT * 100)}%)`} />
              </div>
            ) : (
              <div style={{ minWidth: "260px" }}>
                <div style={{ color: "#333355", fontSize: "9px", letterSpacing: "0.1em", marginBottom: "6px" }}>SIGNAL BREAKDOWN</div>
                <div style={{ color: "#1e1e33", fontSize: "10px" }}>Coldkey distribution data unavailable</div>
              </div>
            )}

            {/* Top 5 Holders */}
            {item.topHolders.length > 0 && (
              <div style={{ minWidth: "240px" }}>
                <div style={{ color: "#333355", fontSize: "9px", letterSpacing: "0.1em", marginBottom: "6px" }}>TOP 5 HOLDERS</div>
                <div style={{ fontSize: "10px", lineHeight: "1.8" }}>
                  {item.topHolders.map((h, i) => (
                    <div key={i}>
                      <span style={{ color: "#282844", marginRight: "6px" }}>#{i + 1}</span>
                      <span style={{ color: "#4488ff", fontFamily: "inherit" }}>{truncateColdkey(h.coldkey)}</span>
                      <span style={{ color: "#555577", marginLeft: "8px" }}>{h.count} reg</span>
                      <span style={{ color: h.share > 0.30 ? "#ff4455" : h.share > 0.15 ? "#ddaa00" : "#555577", marginLeft: "6px", fontWeight: 600 }}>
                        {(h.share * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Raw Metrics */}
            <div style={{ minWidth: "200px" }}>
              <div style={{ color: "#333355", fontSize: "9px", letterSpacing: "0.1em", marginBottom: "6px" }}>METRICS</div>
              <div style={{ fontSize: "10px", lineHeight: "1.8" }}>
                {item.hasColdkeyData && <div><span style={{ color: "#282844" }}>HHI:</span> <span style={{ color: item.hhi > 2500 ? "#ff4455" : item.hhi > 1500 ? "#ddaa00" : "#555577" }}>{item.hhi}</span> <span style={{ color: "#1e1e33", fontSize: "9px" }}>{item.hhi > 2500 ? "(highly concentrated)" : item.hhi > 1500 ? "(moderately concentrated)" : "(competitive)"}</span></div>}
                {item.hasColdkeyData && <div><span style={{ color: "#282844" }}>Unique Coldkeys:</span> <span style={{ color: "#555577" }}>{item.uniqueColdkeys}</span></div>}
                {item.hasColdkeyData && <div><span style={{ color: "#282844" }}>Total Registrations:</span> <span style={{ color: "#555577" }}>{item.totalCount}</span></div>}
                <div><span style={{ color: "#282844" }}>Pool Size:</span> <span style={{ color: "#555577" }}>{fTao(item.poolTao)} TAO</span></div>
                {item.marketCap > 0 && <div><span style={{ color: "#282844" }}>Market Cap:</span> <span style={{ color: "#555577" }}>${fTao(item.marketCap)}</span></div>}
                {item.hasColdkeyData && <div><span style={{ color: "#282844" }}>Impact Model:</span> <span style={{ color: "#555577" }}>whale_share {"\u00D7"} (2 - whale_share)</span></div>}
                {item.hasColdkeyData && <div><span style={{ color: "#282844" }}>Top Whale Share:</span> <span style={{ color: "#555577" }}>{item.top1Pct.toFixed(1)}%</span></div>}
                {item.hasColdkeyData && <div><span style={{ color: "#282844" }}>Est. Price Impact:</span> <span style={{ color: IMPACT_COLORS[item.impactSeverity] }}>{item.impactPct.toFixed(1)}% ({item.impactSeverity})</span></div>}
              </div>
            </div>
          </div>

          {/* Red Flags */}
          {item.flags.length > 0 && (
            <div style={{ marginTop: "10px", padding: "8px 10px", background: "#120008", borderRadius: "3px", border: "1px solid #2a0015" }}>
              <div style={{ color: "#ff4455", fontSize: "9px", letterSpacing: "0.1em", marginBottom: "4px" }}>RED FLAGS</div>
              {item.flags.map((f, i) => (
                <div key={i} style={{ color: "#ff6666", fontSize: "10px", lineHeight: "1.7", marginBottom: "2px" }}>
                  {"\u26A0"} <span style={{ fontWeight: 600 }}>{f.label}:</span> {f.desc}
                </div>
              ))}
            </div>
          )}

          {/* Analysis */}
          <div style={{ marginTop: "10px", padding: "8px 10px", background: "#08080e", borderRadius: "3px", border: "1px solid #0e0e1a" }}>
            <div style={{ color: "#333355", fontSize: "9px", letterSpacing: "0.1em", marginBottom: "4px" }}>ANALYSIS</div>
            {item.explanation.map((line, i) => (
              <div key={i} style={{ color: line.startsWith("CRITICAL") ? "#ff4455" : "#555577", fontSize: "10px", lineHeight: "1.7", marginBottom: "2px" }}>
                {"\u2022"} {line}
              </div>
            ))}
          </div>
        </div>
      </td>
    </tr>
  );
}

function MethodologySection() {
  const [open, setOpen] = useState(false);
  const txt = { color: "#444466", fontSize: "11px", lineHeight: "1.7" };
  const heading = { color: "#5555aa", fontSize: "11px", fontWeight: 600, marginTop: "12px", marginBottom: "4px", letterSpacing: "0.06em" };

  return (
    <div style={{ borderTop: "1px solid #0d0d1e", background: "#090912" }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ padding: "10px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", userSelect: "none" }}
      >
        <span style={{ color: "#1e1e33", fontSize: "9px" }}>{open ? "\u25BC" : "\u25B6"}</span>
        <span style={{ color: "#333355", fontSize: "10px", letterSpacing: "0.1em", fontWeight: 600 }}>HOW WHALE SCORE IS CALCULATED</span>
      </div>
      {open && (
        <div style={{ padding: "0 18px 16px 18px", maxWidth: "800px" }}>
          <p style={txt}>
            The <span style={{ color: "#5555ff" }}>Whale Score</span> measures how concentrated subnet holder distribution is and estimates the potential price impact if the largest holder exits. Higher scores indicate healthier, more distributed ownership. Lower scores indicate whale-dominated subnets with elevated dump risk.
          </p>

          <div style={heading}>HERFINDAHL-HIRSCHMAN INDEX (HHI)</div>
          <p style={txt}>
            The HHI is a standard measure of market concentration used by regulators (including the U.S. DOJ for antitrust analysis). It sums the squares of each holder's share of total registrations, then multiplies by 10,000. An HHI below 1,500 indicates competitive/distributed ownership. 1,500-2,500 is moderately concentrated. Above 2,500 is highly concentrated — analogous to monopoly conditions.
          </p>

          <div style={heading}>TOP HOLDER CONCENTRATION</div>
          <p style={txt}>
            Measures the share of total registrations held by the top 1, 5, and 10 coldkeys. A single whale controlling &gt;50% of registrations is a severe red flag. Top 5 holders controlling &gt;80% indicates top-heavy distribution where a small group can coordinate to dump.
          </p>

          <div style={heading}>PRICE IMPACT MODEL</div>
          <p style={txt}>
            Uses a simplified constant-product AMM formula to estimate the price impact if the top whale exits: <span style={{ color: "#5555ff" }}>impact = whale_share {"\u00D7"} (2 - whale_share)</span>. This models the non-linear slippage inherent in automated market makers. A whale holding 50% of registrations would cause an estimated 75% price impact on exit. The actual impact depends on pool depth and execution speed.
          </p>

          <div style={heading}>RED FLAGS</div>
          <p style={txt}>
            <span style={{ color: "#ff4455" }}>SINGLE WHALE</span> — Top 1 holder &gt;50% of registrations<br />
            <span style={{ color: "#ff4455" }}>TOP HEAVY</span> — Top 5 holders &gt;80% of registrations<br />
            <span style={{ color: "#ff4455" }}>THIN LIQUIDITY</span> — High concentration + pool &lt;2,000 TAO<br />
            <span style={{ color: "#ff4455" }}>HHI RISK</span> — HHI exceeds 2,500 (DOJ antitrust threshold)
          </p>

          <div style={heading}>TIERS</div>
          <p style={txt}>
            <span style={{ color: WHALE_TIER_CONFIG.distributed.color }}>{WHALE_TIER_CONFIG.distributed.icon} DISTRIBUTED (70-100)</span> — Healthy holder distribution, low whale risk<br />
            <span style={{ color: WHALE_TIER_CONFIG.moderate.color }}>{WHALE_TIER_CONFIG.moderate.icon} MODERATE (40-69)</span> — Some concentration, monitor for changes<br />
            <span style={{ color: WHALE_TIER_CONFIG.concentrated.color }}>{WHALE_TIER_CONFIG.concentrated.icon} CONCENTRATED (20-39)</span> — Significant whale presence, elevated risk<br />
            <span style={{ color: WHALE_TIER_CONFIG["whale-dominated"].color }}>{WHALE_TIER_CONFIG["whale-dominated"].icon} WHALE-DOMINATED (0-19)</span> — Extreme concentration, high dump risk
          </p>
        </div>
      )}
    </div>
  );
}

export default function WhaleScanner() {
  const { refreshTaoStats } = useSharedData();
  const [scored, setScored] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [ts, setTs] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [sortKey, setSortKey] = useState("whaleScore");
  const [sortDir, setSortDir] = useState("asc");
  const [filter, setFilter] = useState("all");
  const [auto, setAuto] = useState(true);
  const [freq] = useState(60);
  const timerRef = useRef();
  const scanningRef = useRef(false);

  const scan = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setLoading(true);
    setErr(null);
    try {
      const [{ subnets, pools, meta }] = await Promise.all([
        refreshTaoStats(),
        new Promise(r => setTimeout(r, 400)),
      ]);
      const subnetArr = Array.isArray(subnets) ? subnets : (subnets?.data || []);
      const netuids = subnetArr
        .filter(s => parseFloat(s.emission) > 0)
        .map(s => s.netuid ?? s.subnet_id)
        .filter(id => id != null);
      const coldkeyMap = await fetchColdkeyDistributionMap(netuids);
      const results = scoreWhales(subnets, pools, meta, coldkeyMap);
      setScored(results);
      setTs(new Date());
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

  const toggleExpand = (netuid) => {
    setExpanded(prev => ({ ...prev, [netuid]: !prev[netuid] }));
  };

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(prev => prev === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir(key === "whaleScore" ? "asc" : "desc");
    }
  };

  const filtered = scored.filter(s =>
    filter === "all" ? true :
    filter === "whale-dominated" ? s.tier === "whale-dominated" :
    filter === "concentrated" ? s.tier === "concentrated" :
    filter === "moderate" ? s.tier === "moderate" :
    filter === "distributed" ? s.tier === "distributed" :
    filter === "flags" ? s.flags.length > 0 : true
  );

  const sorted = [...filtered].sort((a, b) => {
    let av, bv;
    switch (sortKey) {
      case "whaleScore": av = a.whaleScore; bv = b.whaleScore; break;
      case "top1Pct": av = a.top1Pct; bv = b.top1Pct; break;
      case "top5Pct": av = a.top5Pct; bv = b.top5Pct; break;
      case "top10Pct": av = a.top10Pct; bv = b.top10Pct; break;
      case "impactPct": av = a.impactPct; bv = b.impactPct; break;
      case "flags": av = a.flags.length; bv = b.flags.length; break;
      case "name": return sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      default: av = a.whaleScore; bv = b.whaleScore;
    }
    return sortDir === "desc" ? bv - av : av - bv;
  });

  const counts = {
    total: scored.length,
    distributed: scored.filter(s => s.tier === "distributed").length,
    moderate: scored.filter(s => s.tier === "moderate").length,
    concentrated: scored.filter(s => s.tier === "concentrated").length,
    whaleDominated: scored.filter(s => s.tier === "whale-dominated").length,
    flagged: scored.filter(s => s.flags.length > 0).length,
  };

  const TC = WHALE_TIER_CONFIG;

  const S = {
    root: { fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace", background: "#070710", color: "#b0b0cc", minHeight: "100vh", fontSize: "12px" },
    header: { background: "#0d0d1a", borderBottom: "1px solid #151528", padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" },
    title: { color: "#5555ff", fontWeight: 700, fontSize: "14px", letterSpacing: "0.08em" },
    btn: (dis) => ({ background: dis ? "#10101e" : "#1818cc", border: "none", color: dis ? "#2a2a44" : "#fff", padding: "6px 16px", borderRadius: "3px", cursor: dis ? "not-allowed" : "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 600, letterSpacing: "0.05em" }),
    statsBar: { padding: "8px 18px", display: "flex", gap: "14px", borderBottom: "1px solid #0d0d1e", fontSize: "10px", color: "#222244", flexWrap: "wrap" },
    thead: { background: "#0a0a14", borderBottom: "1px solid #131326" },
    th: (key) => ({ padding: "6px 8px", fontWeight: 400, fontSize: "10px", color: sortKey === key ? "#5555ff" : "#282844", letterSpacing: "0.1em", textAlign: "right", cursor: "pointer", userSelect: "none" }),
    thLeft: (key) => ({ padding: "6px 8px", fontWeight: 400, fontSize: "10px", color: sortKey === key ? "#5555ff" : "#282844", letterSpacing: "0.1em", textAlign: "left", cursor: "pointer", userSelect: "none" }),
    cell: { padding: "8px 8px", textAlign: "right" },
    cellLeft: { padding: "8px 8px", textAlign: "left" },
    select: { background: "#0a0a14", border: "1px solid #1a1a2e", color: "#555577", padding: "4px 8px", borderRadius: "3px", fontSize: "10px", fontFamily: "inherit", cursor: "pointer" },
  };

  const sortArrow = (key) => sortKey === key ? (sortDir === "desc" ? " \u25BC" : " \u25B2") : "";

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={S.title}>{"\uD83D\uDC33"} WHALE WATCHER</span>
          {counts.distributed > 0 && <span style={{ color: TC.distributed.color, fontSize: "10px", background: TC.distributed.bg, border: `1px solid ${TC.distributed.border}`, padding: "2px 8px", borderRadius: "3px" }}>{counts.distributed} DISTRIBUTED</span>}
          {counts.moderate > 0 && <span style={{ color: TC.moderate.color, fontSize: "10px", background: TC.moderate.bg, border: `1px solid ${TC.moderate.border}`, padding: "2px 8px", borderRadius: "3px" }}>{counts.moderate} MODERATE</span>}
          {counts.concentrated > 0 && <span style={{ color: TC.concentrated.color, fontSize: "10px", background: TC.concentrated.bg, border: `1px solid ${TC.concentrated.border}`, padding: "2px 8px", borderRadius: "3px" }}>{counts.concentrated} CONCENTRATED</span>}
          {counts.whaleDominated > 0 && <span style={{ color: TC["whale-dominated"].color, fontSize: "10px", background: TC["whale-dominated"].bg, border: `1px solid ${TC["whale-dominated"].border}`, padding: "2px 8px", borderRadius: "3px" }}>{counts.whaleDominated} WHALE-DOM</span>}
          {counts.flagged > 0 && <span style={{ color: "#ff4455", fontSize: "10px", background: "#ff000f10", border: "1px solid #ff003320", padding: "2px 8px", borderRadius: "3px" }}>{counts.flagged} FLAG{counts.flagged !== 1 ? "S" : ""}</span>}
          {ts && <span style={{ color: "#2a2a44", fontSize: "10px" }}>{"\u23F1"} {ts.toLocaleTimeString()}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <select value={filter} onChange={e => setFilter(e.target.value)} style={S.select}>
            <option value="all">ALL SUBNETS</option>
            <option value="whale-dominated">WHALE-DOMINATED</option>
            <option value="concentrated">CONCENTRATED</option>
            <option value="moderate">MODERATE</option>
            <option value="distributed">DISTRIBUTED</option>
            <option value="flags">RED FLAGS</option>
          </select>
          <label style={{ color: "#282844", fontSize: "10px", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}>
            <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} style={{ accentColor: "#1818cc" }} />
            AUTO
          </label>
          <button onClick={scan} disabled={loading} style={S.btn(loading)}>
            {loading ? "SCANNING..." : "\u27F3 SCAN"}
          </button>
        </div>
      </div>

      <div style={{ background: "#0a0a13", borderBottom: "1px solid #131326", padding: "5px 18px", display: "flex", gap: "18px", flexWrap: "wrap", fontSize: "10px" }}>
        <span style={{ color: "#1e1e33" }}>METRICS:</span>
        <span style={{ color: "#282844" }}>Top1/Top5/Top10 Holder %</span>
        <span style={{ color: "#282844" }}>HHI Index</span>
        <span style={{ color: "#282844" }}>AMM Impact Model</span>
        <span style={{ color: "#1e1e33" }}>{"\u00B7"}</span>
        <span style={{ color: TC.distributed.color }}>DISTRIBUTED {"\u2265"}70</span>
        <span style={{ color: TC.moderate.color }}>MODERATE {"\u2265"}40</span>
        <span style={{ color: TC.concentrated.color }}>CONCENTRATED {"\u2265"}20</span>
        <span style={{ color: TC["whale-dominated"].color }}>WHALE-DOM {"<"}20</span>
      </div>

      {err && (
        <div style={{ margin: "12px 18px", padding: "10px 14px", background: "#ff000f10", border: "1px solid #ff003330", borderRadius: "4px", color: "#ff4455", fontSize: "11px" }}>
          {err}
        </div>
      )}

      {loading && scored.length === 0 && (
        <div style={{ padding: "70px", textAlign: "center", color: "#1e1e33" }}>
          <div style={{ fontSize: "28px", animation: "pulse 1s infinite" }}>{"\uD83D\uDC33"}</div>
          <div style={{ marginTop: "12px", letterSpacing: "0.2em", fontSize: "13px" }}>SCANNING FOR WHALES...</div>
          <div style={{ color: "#141426", marginTop: "6px", fontSize: "10px" }}>Analyzing holder concentration across subnets</div>
        </div>
      )}

      {scored.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <div style={S.statsBar}>
            <span>{counts.total} subnets analyzed</span>
            {counts.distributed > 0 && <span style={{ color: TC.distributed.color }}>{counts.distributed} distributed</span>}
            {counts.moderate > 0 && <span style={{ color: TC.moderate.color }}>{counts.moderate} moderate</span>}
            {counts.concentrated > 0 && <span style={{ color: TC.concentrated.color }}>{counts.concentrated} concentrated</span>}
            {counts.whaleDominated > 0 && <span style={{ color: TC["whale-dominated"].color }}>{counts.whaleDominated} whale-dominated</span>}
            {counts.flagged > 0 && <span>{"\u00B7"} <span style={{ color: "#ff4455" }}>{counts.flagged} red flag{counts.flagged !== 1 ? "s" : ""}</span></span>}
            <span>{"\u00B7"} showing {sorted.length}</span>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "960px" }}>
            <thead>
              <tr style={S.thead}>
                <th style={{ ...S.thLeft(""), width: "36px" }}>#</th>
                <th style={S.thLeft("name")} onClick={() => handleSort("name")}>SUBNET{sortArrow("name")}</th>
                <th style={{ ...S.th("whaleScore"), width: "68px" }} onClick={() => handleSort("whaleScore")}>WHALE{sortArrow("whaleScore")}</th>
                <th style={{ ...S.th(""), width: "90px" }}>TIER</th>
                <th style={{ ...S.th("top1Pct"), width: "62px" }} onClick={() => handleSort("top1Pct")}>TOP 1%{sortArrow("top1Pct")}</th>
                <th style={{ ...S.th("top5Pct"), width: "62px" }} onClick={() => handleSort("top5Pct")}>TOP 5%{sortArrow("top5Pct")}</th>
                <th style={{ ...S.th("top10Pct"), width: "62px" }} onClick={() => handleSort("top10Pct")}>TOP 10%{sortArrow("top10Pct")}</th>
                <th style={{ ...S.th("impactPct"), width: "68px" }} onClick={() => handleSort("impactPct")}>IMPACT{sortArrow("impactPct")}</th>
                <th style={{ ...S.th("flags"), width: "90px" }} onClick={() => handleSort("flags")}>FLAGS{sortArrow("flags")}</th>
                <th style={{ ...S.th(""), width: "30px" }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s, i) => {
                const tierCfg = TC[s.tier];
                const isExpanded = expanded[s.netuid];
                const rowBg = s.flags.length > 0
                  ? `linear-gradient(90deg, #1a001010 0%, #070710 60%)`
                  : s.tier === "whale-dominated"
                  ? `linear-gradient(90deg, ${tierCfg.bg} 0%, #070710 60%)`
                  : i % 2 === 0 ? "#0b0b15" : "#090912";

                return (
                  <React.Fragment key={s.netuid}>
                    <tr
                      className="trow"
                      style={{ background: rowBg, borderBottom: `1px solid ${s.tier === "whale-dominated" ? "#200018" : "#0e0e18"}`, cursor: "pointer" }}
                      onClick={() => toggleExpand(s.netuid)}
                    >
                      <td style={{ ...S.cellLeft, color: "#282844" }}>{i + 1}</td>
                      <td style={S.cellLeft}>
                        <SubnetLogo url={s.logo} name={s.name} />
                        <span style={{ color: tierCfg.color, fontWeight: s.tier === "distributed" ? 600 : 400 }}>{s.name}</span>
                        <span style={{ color: "#1e1e30", fontSize: "10px", marginLeft: "7px" }}>SN{s.netuid}</span>
                      </td>
                      <td style={S.cell}><ScoreBadge score={s.whaleScore} tier={s.tier} /></td>
                      <td style={S.cell}><TierLabel tier={s.tier} /></td>
                      <td style={{ ...S.cell, color: !s.hasColdkeyData ? "#1e1e33" : s.top1Pct > 50 ? "#ff4455" : s.top1Pct > 30 ? "#ddaa00" : "#555577" }}>{s.hasColdkeyData ? s.top1Pct.toFixed(1) : "N/A"}</td>
                      <td style={{ ...S.cell, color: !s.hasColdkeyData ? "#1e1e33" : s.top5Pct > 80 ? "#ff4455" : s.top5Pct > 60 ? "#ddaa00" : "#555577" }}>{s.hasColdkeyData ? s.top5Pct.toFixed(1) : "N/A"}</td>
                      <td style={{ ...S.cell, color: !s.hasColdkeyData ? "#1e1e33" : "#555577" }}>{s.hasColdkeyData ? s.top10Pct.toFixed(1) : "N/A"}</td>
                      <td style={S.cell}>{s.hasColdkeyData ? <ImpactBadge pct={s.impactPct} severity={s.impactSeverity} /> : <span style={{ color: "#1e1e33" }}>N/A</span>}</td>
                      <td style={S.cell}>
                        {s.flags.length > 0
                          ? s.flags.map((f, fi) => <FlagBadge key={fi} flag={f} />)
                          : <span style={{ color: "#1e1e30", fontSize: "10px" }}>{"\u2014"}</span>
                        }
                      </td>
                      <td style={{ ...S.cell, color: "#1a1a2e", fontSize: "9px" }}>{isExpanded ? "\u25BC" : "\u25B6"}</td>
                    </tr>
                    {isExpanded && <ExpandedRow item={s} />}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <MethodologySection />

      <div style={{ padding: "12px 18px", borderTop: "1px solid #0d0d1e", color: "#141420", fontSize: "10px", display: "flex", flexDirection: "column", gap: "6px" }}>
        <span style={{ color: "#333355", fontSize: "10px", lineHeight: "1.5" }}>
          Whale Score analyzes coldkey distribution patterns. Concentration does not confirm intent to dump. Always verify on taostats.io before drawing conclusions.
        </span>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "6px" }}>
          <span>Data: TaoStats API {"\u00B7"} Holder Concentration Analysis {"\u00B7"} Not financial advice</span>
          <span>Crypto Millie {"\u2014"} Capital Rotation Intelligence</span>
        </div>
      </div>
    </div>
  );
}
