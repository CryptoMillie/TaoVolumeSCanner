import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSharedData } from "./DataContext.jsx";
import { useGateConfig } from "./lib/GateConfigContext.jsx";
import { fetchColdkeyDistributionMap } from "./sri/api.js";
import { scorePurity } from "./purity/scoring.js";
import { PURITY_TIER_CONFIG, SIGNAL_LABELS, SIGNAL_WEIGHTS } from "./purity/constants.js";

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
  const cfg = PURITY_TIER_CONFIG[tier];
  return (
    <span style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color, padding: "2px 8px", borderRadius: "3px", fontSize: "12px", fontWeight: 700, minWidth: "36px", display: "inline-block", textAlign: "center" }}>
      {score}
    </span>
  );
}

function TierLabel({ tier }) {
  const cfg = PURITY_TIER_CONFIG[tier];
  return <span style={{ color: cfg.color, fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em" }}>{cfg.icon} {cfg.label}</span>;
}

function PumpBadge() {
  return (
    <span style={{ background: "#ff000f18", border: "1px solid #ff003340", color: "#ff4455", padding: "1px 6px", borderRadius: "3px", fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em" }}>
      PUMP DETECTED
    </span>
  );
}

function TrendIndicator({ trend }) {
  const cfg = {
    rising: { color: "#33bb66", icon: "\u25B2", label: "RISING" },
    falling: { color: "#ff4455", icon: "\u25BC", label: "FALLING" },
    flat: { color: "#555577", icon: "\u25C6", label: "FLAT" },
  };
  const t = cfg[trend] || cfg.flat;
  return <span style={{ color: t.color, fontSize: "10px" }}>{t.icon} {t.label}</span>;
}

function fTao(v) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${v.toFixed(0)}`;
}

function SignalBar({ score, label, available }) {
  if (!available) return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
      <span style={{ color: "#282844", fontSize: "9px", width: "160px" }}>{label}</span>
      <span style={{ color: "#1e1e33", fontSize: "9px" }}>UNAVAILABLE</span>
    </div>
  );
  const color = score >= 70 ? "#33bb66" : score >= 40 ? "#ddaa00" : "#ff4455";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
      <span style={{ color: "#282844", fontSize: "9px", width: "160px" }}>{label}</span>
      <div style={{ width: "80px", height: "6px", background: "#0d0d1a", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ width: `${Math.max(0, Math.min(100, score))}%`, height: "100%", background: color, borderRadius: "3px" }} />
      </div>
      <span style={{ color, fontSize: "10px", fontWeight: 600, minWidth: "28px" }}>{score.toFixed(1)}</span>
    </div>
  );
}

function ExpandedRow({ item }) {
  return (
    <tr>
      <td colSpan={9} style={{ padding: "0" }}>
        <div style={{ padding: "12px 18px 12px 40px", background: "#0a0a14", borderBottom: "1px solid #131326" }}>
          <div style={{ display: "flex", gap: "28px", flexWrap: "wrap" }}>
            <div style={{ minWidth: "280px" }}>
              <div style={{ color: "#333355", fontSize: "9px", letterSpacing: "0.1em", marginBottom: "6px" }}>SIGNAL BREAKDOWN</div>
              <SignalBar score={item.signals.s1.score} label={`S1: ${SIGNAL_LABELS.S1} (${Math.round(SIGNAL_WEIGHTS.S1 * 100)}%)`} available={true} />
              <SignalBar score={item.signals.s2.score} label={`S2: ${SIGNAL_LABELS.S2} (${Math.round(SIGNAL_WEIGHTS.S2 * 100)}%)`} available={true} />
              <SignalBar score={item.signals.s3.score || 0} label={`S3: ${SIGNAL_LABELS.S3} (${Math.round(SIGNAL_WEIGHTS.S3 * 100)}%)`} available={item.signals.s3.available} />
              <SignalBar score={item.signals.s4.score || 0} label={`S4: ${SIGNAL_LABELS.S4} (${Math.round(SIGNAL_WEIGHTS.S4 * 100)}%)`} available={item.signals.s4.available} />
            </div>
            <div style={{ minWidth: "200px" }}>
              <div style={{ color: "#333355", fontSize: "9px", letterSpacing: "0.1em", marginBottom: "6px" }}>RAW METRICS</div>
              <div style={{ fontSize: "10px", lineHeight: "1.8" }}>
                <div><span style={{ color: "#282844" }}>Pool Size:</span> <span style={{ color: "#555577" }}>{fTao(item.poolTao)} TAO</span></div>
                <div><span style={{ color: "#282844" }}>Emission Share:</span> <span style={{ color: "#555577" }}>{item.emissionSharePct.toFixed(2)}%</span></div>
                <div><span style={{ color: "#282844" }}>S1 Ratio:</span> <span style={{ color: "#555577" }}>{item.signals.s1.ratio.toFixed(4)}</span></div>
                <div><span style={{ color: "#282844" }}>Flow Concentration:</span> <span style={{ color: "#555577" }}>{(item.signals.s2.concentration * 100).toFixed(0)}%</span></div>
                {item.signals.s3.available && <div><span style={{ color: "#282844" }}>Unique Coldkeys:</span> <span style={{ color: "#555577" }}>{item.signals.s3.uniqueColdkeys}</span></div>}
                {item.signals.s3.available && <div><span style={{ color: "#282844" }}>Total Registrations:</span> <span style={{ color: "#555577" }}>{item.signals.s3.totalCount}</span></div>}
                {item.signals.s3.available && <div><span style={{ color: "#282844" }}>Diversity Ratio:</span> <span style={{ color: "#555577" }}>{item.signals.s3.diversityRatio.toFixed(3)}</span></div>}
                <div><span style={{ color: "#282844" }}>7d Net Flow:</span> <span style={{ color: item.netFlow7d >= 0 ? "#33bb66" : "#ff4455" }}>{item.netFlow7d >= 0 ? "+" : ""}{fTao(item.netFlow7d)} TAO</span></div>
                <div><span style={{ color: "#282844" }}>30d Net Flow:</span> <span style={{ color: item.netFlow30d >= 0 ? "#33bb66" : "#ff4455" }}>{item.netFlow30d >= 0 ? "+" : ""}{fTao(item.netFlow30d)} TAO</span></div>
                {item.signals.s4.available && <div><span style={{ color: "#282844" }}>Age:</span> <span style={{ color: "#555577" }}>{item.signals.s4.ageDays < 1 ? "<1 day" : `${Math.round(item.signals.s4.ageDays)} days`}</span></div>}
              </div>
            </div>
          </div>
          <div style={{ marginTop: "10px", padding: "8px 10px", background: "#08080e", borderRadius: "3px", border: "1px solid #0e0e1a" }}>
            <div style={{ color: "#333355", fontSize: "9px", letterSpacing: "0.1em", marginBottom: "4px" }}>ANALYSIS</div>
            {item.explanation.map((line, i) => (
              <div key={i} style={{ color: line.startsWith("PUMP") ? "#ff4455" : "#555577", fontSize: "10px", lineHeight: "1.7", marginBottom: "2px" }}>
                {line.startsWith("PUMP") ? "\u26A0 " : "\u2022 "}{line}
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
        <span style={{ color: "#333355", fontSize: "10px", letterSpacing: "0.1em", fontWeight: 600 }}>HOW PURITY SCORE IS CALCULATED</span>
      </div>
      {open && (
        <div style={{ padding: "0 18px 16px 18px", maxWidth: "800px" }}>
          <p style={txt}>
            The <span style={{ color: "#5555ff" }}>Purity Score</span> detects which subnets have genuine organic staking patterns versus coordinated pump-and-dump behavior. Under v3.4.6, emission is now price-based (price {"\u00D7"} root_prop {"\u00D7"} (1{"\u2212"}miner_burn)), eliminating the old TaoFlow EMA cycling exploit. However, coordinated staking bursts, wallet concentration, and disproportionate pool/emission ratios remain valid signals for detecting manufactured demand.
          </p>

          <div style={heading}>S1: POOL SIZE vs EMISSION SHARE (40%)</div>
          <p style={txt}>
            Flags subnets where emission share is disproportionately high relative to pool size. A small pool earning outsized emissions is suspicious. Calculated as emission_share_pct / pool_size_tao — higher ratio = more suspicious. Inverted for purity score.
          </p>

          <div style={heading}>S2: STAKING CONCENTRATION (25%)</div>
          <p style={txt}>
            Detects subnets where staking inflows are temporally concentrated rather than accumulated gradually. If 70%+ of a subnet's 30-day cumulative flow happened in the last 7 days, that suggests coordinated staking rather than organic growth. Note: The old TaoFlow EMA cycling exploit is dead under v3.4.6, but concentrated staking bursts remain a valid signal for manufactured demand.
          </p>

          <div style={heading}>S3: WALLET CONCENTRATION (20%)</div>
          <p style={txt}>
            Measures coldkey diversity per subnet using TaoStats coldkey distribution data. Calculates a diversity ratio: unique_coldkeys / total_registrations. A ratio near 1.0 means every coldkey has a single registration — maximally distributed and organic. A low ratio means a few wallets control many registrations — concentrated and suspicious. If a subnet received heavy staking from only 3 wallets, that's manufactured. If it came from 400 wallets, that's organic.
          </p>

          <div style={heading}>S4: AGE vs EMISSION SHARE (15%)</div>
          <p style={txt}>
            New subnets under 14 days old with high emission share are high risk for manufactured demand. Subnets over 90 days old with consistent emission share are lower risk. Score combines age factor with emission share normalization.
          </p>

          <div style={heading}>PUMP DETECTION</div>
          <p style={txt}>
            A "Pump Detected" flag fires when Signal 1 AND Signal 2 both breach thresholds simultaneously — meaning a small pool has disproportionate emissions AND staking is temporally concentrated. While this no longer exploits emission allocation directly (v3.4.6 uses symmetric price-based emission), it still indicates coordinated manipulation of pool prices and manufactured demand.
          </p>

          <div style={heading}>TIERS</div>
          <p style={txt}>
            <span style={{ color: PURITY_TIER_CONFIG.organic.color }}>{PURITY_TIER_CONFIG.organic.icon} ORGANIC (75-100)</span> — All signals indicate genuine staking behavior
            <br /><span style={{ color: PURITY_TIER_CONFIG.mixed.color }}>{PURITY_TIER_CONFIG.mixed.icon} MIXED (40-74)</span> — Some signals elevated, warrants monitoring
            <br /><span style={{ color: PURITY_TIER_CONFIG.suspicious.color }}>{PURITY_TIER_CONFIG.suspicious.icon} SUSPICIOUS (0-39)</span> — Multiple signals triggered, high probability of coordination
          </p>
        </div>
      )}
    </div>
  );
}

export default function PurityScanner() {
  const { refreshTaoStats } = useSharedData();
  const { q, h } = useGateConfig();
  const [scored, setScored] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [ts, setTs] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [sortKey, setSortKey] = useState("purityScore");
  const [sortDir, setSortDir] = useState("desc");
  const [filter, setFilter] = useState("all");
  const [auto, setAuto] = useState(true);
  const [freq] = useState(60);
  const timerRef = useRef();

  const scanningRef = useRef(false);
  const scan = useCallback(async () => {
    if (scanningRef.current) return; // prevent concurrent scans
    scanningRef.current = true;
    setLoading(true);
    setErr(null);
    try {
      const [{ subnets, pools, meta }] = await Promise.all([
        refreshTaoStats(),
        new Promise(r => setTimeout(r, 400)), // minimum visual feedback
      ]);
      // Extract netuids from active subnets for coldkey distribution fetch
      const subnetArr = Array.isArray(subnets) ? subnets : (subnets?.data || []);
      const netuids = subnetArr
        .filter(s => parseFloat(s.emission) > 0)
        .map(s => s.netuid ?? s.subnet_id)
        .filter(id => id != null);
      // Fetch coldkey distribution in parallel batches
      const coldkeyMap = await fetchColdkeyDistributionMap(netuids);
      const results = scorePurity(subnets, pools, meta, coldkeyMap, { q, h });
      setScored(results);
      setTs(new Date());
    } catch (e) {
      setErr(e.message || String(e));
    }
    setLoading(false);
    scanningRef.current = false;
  }, [refreshTaoStats, q, h]);

  useEffect(() => { scan(); }, [scan]);
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
      setSortDir("desc");
    }
  };

  const filtered = scored.filter(s =>
    filter === "all" ? true :
    filter === "suspicious" ? s.tier === "suspicious" :
    filter === "organic" ? s.tier === "organic" :
    filter === "mixed" ? s.tier === "mixed" :
    filter === "pump" ? s.pumpDetected : true
  );

  const sorted = [...filtered].sort((a, b) => {
    let av, bv;
    switch (sortKey) {
      case "purityScore": av = a.purityScore; bv = b.purityScore; break;
      case "emissionSharePct": av = a.emissionSharePct; bv = b.emissionSharePct; break;
      case "poolTao": av = a.poolTao; bv = b.poolTao; break;
      case "pump": av = a.pumpDetected ? 1 : 0; bv = b.pumpDetected ? 1 : 0; break;
      case "name": return sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      default: av = a.purityScore; bv = b.purityScore;
    }
    return sortDir === "desc" ? bv - av : av - bv;
  });

  const counts = {
    total: scored.length,
    organic: scored.filter(s => s.tier === "organic").length,
    mixed: scored.filter(s => s.tier === "mixed").length,
    suspicious: scored.filter(s => s.tier === "suspicious").length,
    pumps: scored.filter(s => s.pumpDetected).length,
  };

  const TC = PURITY_TIER_CONFIG;

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
          <span style={S.title}>{"\u25C8"} PURITY SCANNER</span>
          {counts.organic > 0 && <span style={{ color: TC.organic.color, fontSize: "10px", background: TC.organic.bg, border: `1px solid ${TC.organic.border}`, padding: "2px 8px", borderRadius: "3px" }}>{counts.organic} ORGANIC</span>}
          {counts.mixed > 0 && <span style={{ color: TC.mixed.color, fontSize: "10px", background: TC.mixed.bg, border: `1px solid ${TC.mixed.border}`, padding: "2px 8px", borderRadius: "3px" }}>{counts.mixed} MIXED</span>}
          {counts.suspicious > 0 && <span style={{ color: TC.suspicious.color, fontSize: "10px", background: TC.suspicious.bg, border: `1px solid ${TC.suspicious.border}`, padding: "2px 8px", borderRadius: "3px" }}>{counts.suspicious} SUSPICIOUS</span>}
          {counts.pumps > 0 && <span style={{ color: "#ff4455", fontSize: "10px", background: "#ff000f10", border: "1px solid #ff003320", padding: "2px 8px", borderRadius: "3px" }}>{counts.pumps} PUMP{counts.pumps !== 1 ? "S" : ""}</span>}
          {ts && <span style={{ color: "#2a2a44", fontSize: "10px" }}>{"\u23F1"} {ts.toLocaleTimeString()}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <select value={filter} onChange={e => setFilter(e.target.value)} style={S.select}>
            <option value="all">ALL SUBNETS</option>
            <option value="suspicious">SUSPICIOUS ONLY</option>
            <option value="mixed">MIXED ONLY</option>
            <option value="organic">ORGANIC ONLY</option>
            <option value="pump">PUMP DETECTED</option>
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
        <span style={{ color: "#1e1e33" }}>SIGNALS:</span>
        <span style={{ color: "#282844" }}>S1 Pool/Emit {"\u00D7"}40%</span>
        <span style={{ color: "#282844" }}>S2 Stake Conc {"\u00D7"}25%</span>
        <span style={{ color: "#282844" }}>S3 Wallets {"\u00D7"}20%</span>
        <span style={{ color: "#282844" }}>S4 Age/Emit {"\u00D7"}15%</span>
        <span style={{ color: "#1e1e33" }}>{"\u00B7"}</span>
        <span style={{ color: TC.organic.color }}>ORGANIC {"\u2265"}75</span>
        <span style={{ color: TC.mixed.color }}>MIXED {"\u2265"}40</span>
        <span style={{ color: TC.suspicious.color }}>SUS {"<"}40</span>
      </div>

      {err && (
        <div style={{ margin: "12px 18px", padding: "10px 14px", background: "#ff000f10", border: "1px solid #ff003330", borderRadius: "4px", color: "#ff4455", fontSize: "11px" }}>
          {err}
        </div>
      )}

      {loading && scored.length === 0 && (
        <div style={{ padding: "70px", textAlign: "center", color: "#1e1e33" }}>
          <div style={{ fontSize: "28px", animation: "pulse 1s infinite" }}>{"\u25C8"}</div>
          <div style={{ marginTop: "12px", letterSpacing: "0.2em", fontSize: "13px" }}>ANALYZING PURITY...</div>
          <div style={{ color: "#141426", marginTop: "6px", fontSize: "10px" }}>Detecting staking patterns across subnets</div>
        </div>
      )}

      {scored.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <div style={S.statsBar}>
            <span>{counts.total} subnets scanned</span>
            {counts.organic > 0 && <span style={{ color: TC.organic.color }}>{counts.organic} organic</span>}
            {counts.mixed > 0 && <span style={{ color: TC.mixed.color }}>{counts.mixed} mixed</span>}
            {counts.suspicious > 0 && <span style={{ color: TC.suspicious.color }}>{counts.suspicious} suspicious</span>}
            {counts.pumps > 0 && <span>{"\u00B7"} <span style={{ color: "#ff4455" }}>{counts.pumps} pump{counts.pumps !== 1 ? "s" : ""} detected</span></span>}
            <span>{"\u00B7"} showing {sorted.length}</span>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "880px" }}>
            <thead>
              <tr style={S.thead}>
                <th style={{ ...S.thLeft(""), width: "36px" }}>#</th>
                <th style={S.thLeft("name")} onClick={() => handleSort("name")}>SUBNET{sortArrow("name")}</th>
                <th style={{ ...S.th("purityScore"), width: "68px" }} onClick={() => handleSort("purityScore")}>PURITY{sortArrow("purityScore")}</th>
                <th style={{ ...S.th(""), width: "80px" }}>TIER</th>
                <th style={{ ...S.th("emissionSharePct"), width: "72px" }} onClick={() => handleSort("emissionSharePct")}>EMIT %{sortArrow("emissionSharePct")}</th>
                <th style={{ ...S.th("poolTao"), width: "80px" }} onClick={() => handleSort("poolTao")}>POOL SIZE{sortArrow("poolTao")}</th>
                <th style={{ ...S.th(""), width: "60px" }}>TREND</th>
                <th style={{ ...S.th("pump"), width: "50px" }} onClick={() => handleSort("pump")}>FLAG{sortArrow("pump")}</th>
                <th style={{ ...S.th(""), width: "30px" }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s, i) => {
                const tierCfg = TC[s.tier];
                const isExpanded = expanded[s.netuid];
                const rowBg = s.pumpDetected
                  ? `linear-gradient(90deg, #1a001010 0%, #070710 60%)`
                  : s.tier === "suspicious"
                  ? `linear-gradient(90deg, ${tierCfg.bg} 0%, #070710 60%)`
                  : i % 2 === 0 ? "#0b0b15" : "#090912";

                return (
                  <React.Fragment key={s.netuid}>
                    <tr
                      className="trow"
                      style={{ background: rowBg, borderBottom: `1px solid ${s.tier === "suspicious" ? "#200018" : "#0e0e18"}`, cursor: "pointer" }}
                      onClick={() => toggleExpand(s.netuid)}
                    >
                      <td style={{ ...S.cellLeft, color: "#282844" }}>{i + 1}</td>
                      <td style={S.cellLeft}>
                        <SubnetLogo url={s.logo} name={s.name} />
                        <span style={{ color: tierCfg.color, fontWeight: s.tier === "organic" ? 600 : 400 }}>{s.name}</span>
                        <span style={{ color: "#1e1e30", fontSize: "10px", marginLeft: "7px" }}>SN{s.netuid}</span>
                      </td>
                      <td style={S.cell}><ScoreBadge score={s.purityScore} tier={s.tier} /></td>
                      <td style={S.cell}><TierLabel tier={s.tier} /></td>
                      <td style={{ ...S.cell, color: "#555577" }}>{s.emissionSharePct.toFixed(2)}%</td>
                      <td style={{ ...S.cell, color: "#555577" }}>{fTao(s.poolTao)}</td>
                      <td style={S.cell}><TrendIndicator trend={s.trend} /></td>
                      <td style={S.cell}>{s.pumpDetected ? <PumpBadge /> : <span style={{ color: "#1e1e30", fontSize: "10px" }}>{"\u2014"}</span>}</td>
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
          Purity Score identifies statistical patterns in staking behavior. It does not confirm intent. Always verify on taostats.io before drawing conclusions.
        </span>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "6px" }}>
          <span>Data: TaoStats API {"\u00B7"} Coordinated Staking Detection {"\u00B7"} Not financial advice</span>
          <span>Crypto Millie {"\u2014"} Capital Rotation Intelligence</span>
        </div>
      </div>
    </div>
  );
}
