import React, { useState, useEffect, useCallback } from "react";
import { fetchAllSRIData, fetchMechDataMap } from "./sri/api.js";
import { scoreSubnets } from "./sri/scoring.js";
import { evaluateFlags } from "./sri/flags.js";
import { DIMENSION_LABELS, TIER_CONFIG, FLAG_LABELS, FLAG_CONFIG } from "./sri/constants.js";

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

function ScoreBadge({ score, tier }) {
  if (score == null) {
    return (
      <span style={{ background: "#0a0a14", border: "1px solid #1a1a2e", color: "#333355", padding: "2px 8px", borderRadius: "3px", fontSize: "12px", fontWeight: 700, minWidth: "36px", display: "inline-block", textAlign: "center" }}>
        N/A
      </span>
    );
  }
  const cfg = TIER_CONFIG[tier];
  return (
    <span style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color, padding: "2px 8px", borderRadius: "3px", fontSize: "12px", fontWeight: 700, minWidth: "36px", display: "inline-block", textAlign: "center" }}>
      {score}
    </span>
  );
}

function TierLabel({ tier }) {
  if (!tier) return <span style={{ color: "#333355", fontSize: "10px" }}>N/A</span>;
  const cfg = TIER_CONFIG[tier];
  return <span style={{ color: cfg.color, fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em" }}>{cfg.label}</span>;
}

function FlagPills({ flags }) {
  if (!flags || flags.length === 0) return <span style={{ color: "#1e1e30", fontSize: "10px" }}>{"\u2014"}</span>;
  return (
    <div style={{ display: "flex", gap: "3px", flexWrap: "wrap" }}>
      {flags.map(f => {
        const cfg = FLAG_CONFIG[f];
        return (
          <span key={f} title={FLAG_LABELS[f]} style={{ background: `${cfg.color}15`, border: `1px solid ${cfg.color}30`, color: cfg.color, padding: "1px 5px", borderRadius: "3px", fontSize: "9px", cursor: "default" }}>
            {cfg.icon} {f}
          </span>
        );
      })}
    </div>
  );
}

function ExpandedRow({ item, flags }) {
  if (!item.dimensions) {
    return (
      <tr>
        <td colSpan={9} style={{ padding: "0" }}>
          <div style={{ padding: "12px 18px 12px 40px", background: "#0a0a14", borderBottom: "1px solid #131326", color: "#333355", fontSize: "10px" }}>
            No scoring data — subnet has zero emissions.
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td colSpan={9} style={{ padding: "0" }}>
        <div style={{ padding: "12px 18px 12px 40px", background: "#0a0a14", borderBottom: "1px solid #131326" }}>
          <div style={{ display: "flex", gap: "28px", flexWrap: "wrap" }}>
            {Object.entries(DIMENSION_LABELS).map(([key, label]) => {
              const val = item.dimensions[key];
              const tier = val >= 70 ? "green" : val >= 40 ? "amber" : "red";
              const cfg = TIER_CONFIG[tier];
              return (
                <div key={key} style={{ minWidth: "140px" }}>
                  <div style={{ color: "#282844", fontSize: "9px", letterSpacing: "0.1em", marginBottom: "4px" }}>{key}: {label.toUpperCase()}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "80px", height: "8px", background: "#0d0d1a", borderRadius: "4px", overflow: "hidden" }}>
                      <div style={{ width: `${val}%`, height: "100%", background: cfg.color, borderRadius: "4px" }} />
                    </div>
                    <span style={{ color: cfg.color, fontSize: "11px", fontWeight: 600 }}>{val.toFixed(1)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {flags && flags.length > 0 && (
            <div style={{ marginTop: "10px" }}>
              <span style={{ color: "#282844", fontSize: "9px", letterSpacing: "0.1em" }}>FLAGS: </span>
              {flags.map(f => (
                <span key={f} style={{ color: FLAG_CONFIG[f].color, fontSize: "10px", marginRight: "12px" }}>
                  {FLAG_CONFIG[f].icon} {FLAG_LABELS[f]}
                </span>
              ))}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function MethodologySection() {
  const [open, setOpen] = useState(false);
  const dim = { color: "#282844" };
  const txt = { color: "#444466", fontSize: "11px", lineHeight: "1.7" };
  const heading = { color: "#5555aa", fontSize: "11px", fontWeight: 600, marginTop: "12px", marginBottom: "4px", letterSpacing: "0.06em" };

  return (
    <div style={{ borderTop: "1px solid #0d0d1e", background: "#090912" }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ padding: "10px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", userSelect: "none" }}
      >
        <span style={{ color: "#1e1e33", fontSize: "9px" }}>{open ? "\u25BC" : "\u25B6"}</span>
        <span style={{ color: "#333355", fontSize: "10px", letterSpacing: "0.1em", fontWeight: 600 }}>HOW SRI IS CALCULATED</span>
      </div>
      {open && (
        <div style={{ padding: "0 18px 16px 18px", maxWidth: "800px" }}>
          <p style={txt}>
            The <span style={{ color: "#5555ff" }}>Subnet Risk Index (SRI)</span> is a 0-100 composite score derived from 12 on-chain metrics across 4 dimensions. Each subnet is percentile-ranked against all active subnets, then dimension scores are weighted and summed.
          </p>

          <div style={heading}>D1: EMISSION VIABILITY (40%)</div>
          <p style={txt}>
            <span style={dim}>M1.1</span> TAO Flow (7d) — net TAO inflow over 7 days{"\n"}
            <br /><span style={dim}>M1.2</span> Emission Share — subnet's share of total network emissions
            <br /><span style={dim}>M1.3</span> Delist Distance — pool rank (higher = safer from delisting)
            <br /><span style={dim}>M1.4</span> Capital Retention (30d) — 30-day net flow relative to pool size
          </p>

          <div style={heading}>D2: MARKET STRUCTURE (25%)</div>
          <p style={txt}>
            <span style={dim}>M2.1</span> Liquidity Depth — total TAO in AMM pool
            <br /><span style={dim}>M2.2</span> Supply Maturity — ratio of staked alpha to total alpha supply
            <br /><span style={dim}>M2.3</span> Miner Economics — emission per active miner
          </p>

          <div style={heading}>D3: ECONOMIC SUSTAINABILITY (20%)</div>
          <p style={txt}>
            <span style={dim}>M3.1</span> Coverage Ratio — projected emission per active miner
            <br /><span style={dim}>M3.2</span> Miner Churn — registrations per active miner (lower is better)
            <br /><span style={dim}>M3.3</span> Reward Distribution — active/max validator ratio (proxy for Gini)
          </p>

          <div style={heading}>D4: GOVERNANCE & OPS (15%)</div>
          <p style={txt}>
            <span style={dim}>M4.1</span> Validator Concentration — active validator count (more = more decentralized)
            <br /><span style={dim}>M4.2</span> Validation Freshness — ratio of active to total validators
          </p>

          <div style={heading}>SCORING METHOD</div>
          <p style={txt}>
            Each metric is percentile-ranked within the active cohort (0-100). Dimension scores are the average of their metric percentiles. The composite is a weighted sum: D1{"\u00D7"}0.40 + D2{"\u00D7"}0.25 + D3{"\u00D7"}0.20 + D4{"\u00D7"}0.15.
          </p>

          <div style={heading}>TIERS</div>
          <p style={txt}>
            <span style={{ color: TIER_CONFIG.green.color }}>GREEN (70-100)</span> — Strong fundamentals across dimensions
            <br /><span style={{ color: TIER_CONFIG.amber.color }}>AMBER (40-69)</span> — Mixed signals, warrants monitoring
            <br /><span style={{ color: TIER_CONFIG.red.color }}>RED (0-39)</span> — Significant risk factors present
          </p>

          <div style={heading}>FLAGS (independent of score)</div>
          <p style={txt}>
            <span style={{ color: FLAG_CONFIG.F1.color }}>{FLAG_CONFIG.F1.icon} F1 Zero Emissions</span> — Subnet emitting zero TAO
            <br /><span style={{ color: FLAG_CONFIG.F2.color }}>{FLAG_CONFIG.F2.icon} F2 Delisting Proximity</span> — Bottom 5 subnets by pool rank
            <br /><span style={{ color: FLAG_CONFIG.F3.color }}>{FLAG_CONFIG.F3.icon} F3 Liquidity Desert</span> — Less than 2,000 TAO in pool
            <br /><span style={{ color: FLAG_CONFIG.F4.color }}>{FLAG_CONFIG.F4.icon} F4 Governance Capture</span> — Only 1 active validator
            <br /><span style={{ color: FLAG_CONFIG.F5.color }}>{FLAG_CONFIG.F5.icon} F5 Validation Abandonment</span> — Less than 30% of validators active
          </p>
        </div>
      )}
    </div>
  );
}

export default function SRIScanner() {
  const [scored, setScored] = useState([]);
  const [unscored, setUnscored] = useState([]);
  const [flagMap, setFlagMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [ts, setTs] = useState(null);
  const [expanded, setExpanded] = useState({});

  const scan = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { subnets, pools, meta } = await fetchAllSRIData();
      const mechDataMap = await fetchMechDataMap(subnets);
      const { scored: s, unscored: u } = scoreSubnets(subnets, pools, meta, mechDataMap);
      const flags = evaluateFlags(s);
      // Also evaluate flags for unscored subnets
      const allForFlags = [...s, ...u];
      const allFlags = evaluateFlags(allForFlags);
      setScored(s);
      setUnscored(u);
      setFlagMap(allFlags);
      setTs(new Date());
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { scan(); }, []);

  const toggleExpand = (netuid) => {
    setExpanded(prev => ({ ...prev, [netuid]: !prev[netuid] }));
  };

  const allSubnets = [...scored, ...unscored];
  const counts = {
    total: allSubnets.length,
    green: scored.filter(s => s.tier === "green").length,
    amber: scored.filter(s => s.tier === "amber").length,
    red: scored.filter(s => s.tier === "red").length,
    inactive: unscored.length,
    flagged: allSubnets.filter(s => (flagMap[s.netuid] || []).length > 0).length,
  };

  const S = {
    root: { fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace", background: "#070710", color: "#b0b0cc", minHeight: "100vh", fontSize: "12px" },
    header: { background: "#0d0d1a", borderBottom: "1px solid #151528", padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" },
    title: { color: "#5555ff", fontWeight: 700, fontSize: "14px", letterSpacing: "0.08em" },
    btn: (dis) => ({ background: dis ? "#10101e" : "#1818cc", border: "none", color: dis ? "#2a2a44" : "#fff", padding: "6px 16px", borderRadius: "3px", cursor: dis ? "not-allowed" : "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 600, letterSpacing: "0.05em" }),
    statsBar: { padding: "8px 18px", display: "flex", gap: "14px", borderBottom: "1px solid #0d0d1e", fontSize: "10px", color: "#222244", flexWrap: "wrap" },
    thead: { background: "#0a0a14", borderBottom: "1px solid #131326" },
    th: { padding: "6px 8px", fontWeight: 400, fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "right" },
    thLeft: { padding: "6px 8px", fontWeight: 400, fontSize: "10px", color: "#282844", letterSpacing: "0.1em", textAlign: "left" },
    cell: { padding: "8px 8px", textAlign: "right" },
    cellLeft: { padding: "8px 8px", textAlign: "left" },
  };

  function renderRow(s, i, isInactive) {
    const flags = flagMap[s.netuid] || [];
    const tierCfg = s.tier ? TIER_CONFIG[s.tier] : null;
    const isExpanded = expanded[s.netuid];
    const nameColor = tierCfg ? tierCfg.color : "#333355";
    const rowBg = isInactive
      ? (i % 2 === 0 ? "#08080e" : "#070710")
      : s.tier === "red"
      ? `linear-gradient(90deg, ${tierCfg.bg} 0%, #070710 60%)`
      : i % 2 === 0 ? "#0b0b15" : "#090912";

    return (
      <React.Fragment key={s.netuid}>
        <tr
          className="trow"
          style={{ background: rowBg, borderBottom: `1px solid ${s.tier === "red" ? "#200018" : "#0e0e18"}`, cursor: "pointer" }}
          onClick={() => toggleExpand(s.netuid)}
        >
          <td style={{ ...S.cellLeft, color: "#282844" }}>{isInactive ? "\u2014" : i + 1}</td>
          <td style={S.cellLeft}>
            <SubnetLogo url={s.logo} name={s.name} />
            <span style={{ color: nameColor, fontWeight: s.tier === "green" ? 600 : 400 }}>{s.name}</span>
            <span style={{ color: "#1e1e30", fontSize: "10px", marginLeft: "7px" }}>SN{s.netuid}</span>
            <span style={{ color: "#1a1a2e", fontSize: "9px", marginLeft: "5px" }}>{isExpanded ? "\u25BC" : "\u25B6"}</span>
          </td>
          <td style={S.cell}><ScoreBadge score={s.composite} tier={s.tier} /></td>
          <td style={S.cell}><TierLabel tier={s.tier} /></td>
          {s.dimensions ? (
            <>
              <td style={S.cell}><DimensionBar value={s.dimensions.D1} color={TIER_CONFIG[s.dimensions.D1 >= 70 ? "green" : s.dimensions.D1 >= 40 ? "amber" : "red"].color} /></td>
              <td style={S.cell}><DimensionBar value={s.dimensions.D2} color={TIER_CONFIG[s.dimensions.D2 >= 70 ? "green" : s.dimensions.D2 >= 40 ? "amber" : "red"].color} /></td>
              <td style={S.cell}><DimensionBar value={s.dimensions.D3} color={TIER_CONFIG[s.dimensions.D3 >= 70 ? "green" : s.dimensions.D3 >= 40 ? "amber" : "red"].color} /></td>
              <td style={S.cell}><DimensionBar value={s.dimensions.D4} color={TIER_CONFIG[s.dimensions.D4 >= 70 ? "green" : s.dimensions.D4 >= 40 ? "amber" : "red"].color} /></td>
            </>
          ) : (
            <>
              <td style={S.cell}><span style={{ color: "#1a1a2e", fontSize: "10px" }}>{"\u2014"}</span></td>
              <td style={S.cell}><span style={{ color: "#1a1a2e", fontSize: "10px" }}>{"\u2014"}</span></td>
              <td style={S.cell}><span style={{ color: "#1a1a2e", fontSize: "10px" }}>{"\u2014"}</span></td>
              <td style={S.cell}><span style={{ color: "#1a1a2e", fontSize: "10px" }}>{"\u2014"}</span></td>
            </>
          )}
          <td style={S.cellLeft}><FlagPills flags={flags} /></td>
        </tr>
        {isExpanded && <ExpandedRow item={s} flags={flags} />}
      </React.Fragment>
    );
  }

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={S.title}>{"\u25C8"} SRI RISK INDEX</span>
          {counts.green > 0 && <span style={{ color: TIER_CONFIG.green.color, fontSize: "10px", background: TIER_CONFIG.green.bg, border: `1px solid ${TIER_CONFIG.green.border}`, padding: "2px 8px", borderRadius: "3px" }}>{counts.green} GREEN</span>}
          {counts.amber > 0 && <span style={{ color: TIER_CONFIG.amber.color, fontSize: "10px", background: TIER_CONFIG.amber.bg, border: `1px solid ${TIER_CONFIG.amber.border}`, padding: "2px 8px", borderRadius: "3px" }}>{counts.amber} AMBER</span>}
          {counts.red > 0 && <span style={{ color: TIER_CONFIG.red.color, fontSize: "10px", background: TIER_CONFIG.red.bg, border: `1px solid ${TIER_CONFIG.red.border}`, padding: "2px 8px", borderRadius: "3px" }}>{counts.red} RED</span>}
          {ts && <span style={{ color: "#2a2a44", fontSize: "10px" }}>{"\u23F1"} {ts.toLocaleTimeString()}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button onClick={scan} disabled={loading} style={S.btn(loading)}>
            {loading ? "SCORING..." : "\u27F3 SCORE"}
          </button>
        </div>
      </div>

      <div style={{ background: "#0a0a13", borderBottom: "1px solid #131326", padding: "5px 18px", display: "flex", gap: "18px", flexWrap: "wrap", fontSize: "10px" }}>
        <span style={{ color: "#1e1e33" }}>METHODOLOGY:</span>
        <span style={{ color: "#282844" }}>D1 Emission {"\u00D7"}40%</span>
        <span style={{ color: "#282844" }}>D2 Market {"\u00D7"}25%</span>
        <span style={{ color: "#282844" }}>D3 Economic {"\u00D7"}20%</span>
        <span style={{ color: "#282844" }}>D4 Governance {"\u00D7"}15%</span>
        <span style={{ color: "#1e1e33" }}>{"\u00B7"}</span>
        <span style={{ color: TIER_CONFIG.green.color }}>GREEN {"\u2265"}70</span>
        <span style={{ color: TIER_CONFIG.amber.color }}>AMBER {"\u2265"}40</span>
        <span style={{ color: TIER_CONFIG.red.color }}>RED {"<"}40</span>
      </div>

      {err && (
        <div style={{ margin: "12px 18px", padding: "10px 14px", background: "#ff000f10", border: "1px solid #ff003330", borderRadius: "4px", color: "#ff4455", fontSize: "11px" }}>
          {err}
        </div>
      )}

      {loading && scored.length === 0 && (
        <div style={{ padding: "70px", textAlign: "center", color: "#1e1e33" }}>
          <div style={{ fontSize: "28px", animation: "pulse 1s infinite" }}>{"\u25C8"}</div>
          <div style={{ marginTop: "12px", letterSpacing: "0.2em", fontSize: "13px" }}>SCORING SUBNETS...</div>
          <div style={{ color: "#141426", marginTop: "6px", fontSize: "10px" }}>Fetching TaoStats on-chain data</div>
        </div>
      )}

      {allSubnets.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <div style={S.statsBar}>
            <span>{counts.total} subnets</span>
            {counts.green > 0 && <span style={{ color: TIER_CONFIG.green.color }}>{counts.green} green</span>}
            {counts.amber > 0 && <span style={{ color: TIER_CONFIG.amber.color }}>{counts.amber} amber</span>}
            {counts.red > 0 && <span style={{ color: TIER_CONFIG.red.color }}>{counts.red} red</span>}
            {counts.inactive > 0 && <span style={{ color: "#333355" }}>{counts.inactive} inactive</span>}
            <span>{"\u00B7"} {counts.flagged} flagged</span>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "800px" }}>
            <thead>
              <tr style={S.thead}>
                <th style={{ ...S.thLeft, width: "36px" }}>#</th>
                <th style={{ ...S.thLeft }}>SUBNET</th>
                <th style={{ ...S.th, width: "58px" }}>SRI</th>
                <th style={{ ...S.th, width: "56px" }}>TIER</th>
                <th style={{ ...S.th, width: "70px" }}>D1 EMIT</th>
                <th style={{ ...S.th, width: "70px" }}>D2 MKT</th>
                <th style={{ ...S.th, width: "70px" }}>D3 ECON</th>
                <th style={{ ...S.th, width: "70px" }}>D4 GOV</th>
                <th style={{ ...S.thLeft, width: "120px" }}>FLAGS</th>
              </tr>
            </thead>
            <tbody>
              {scored.map((s, i) => renderRow(s, i, false))}
              {unscored.length > 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: "6px 18px", background: "#08080e", borderBottom: "1px solid #0e0e18", color: "#222244", fontSize: "9px", letterSpacing: "0.1em" }}>
                    INACTIVE SUBNETS (ZERO EMISSION)
                  </td>
                </tr>
              )}
              {unscored.map((s, i) => renderRow(s, i, true))}
            </tbody>
          </table>
        </div>
      )}

      <MethodologySection />

      <div style={{ padding: "12px 18px", borderTop: "1px solid #0d0d1e", color: "#141420", fontSize: "10px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "6px" }}>
        <span>Data: TaoStats API {"\u00B7"} SRI = Subnet Risk Index (TAO Institute methodology) {"\u00B7"} Not financial advice</span>
        <span>Crypto Millie {"\u2014"} Capital Rotation Intelligence</span>
      </div>
    </div>
  );
}
