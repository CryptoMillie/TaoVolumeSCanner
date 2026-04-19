import React, { useState, useEffect, useCallback } from "react";
import { fetchAllSRIData, fetchMechDataMap } from "./sri/api.js";
import { scoreHealth } from "./health/scoring.js";
import { HEALTH_DIMENSION_LABELS, HEALTH_TIER_CONFIG } from "./health/constants.js";

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
  const cfg = HEALTH_TIER_CONFIG[tier];
  return (
    <span style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color, padding: "2px 8px", borderRadius: "3px", fontSize: "12px", fontWeight: 700, minWidth: "36px", display: "inline-block", textAlign: "center" }}>
      {score}
    </span>
  );
}

function TierLabel({ tier }) {
  const cfg = HEALTH_TIER_CONFIG[tier];
  return <span style={{ color: cfg.color, fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em" }}>{cfg.label}</span>;
}

function tierColor(val) {
  return HEALTH_TIER_CONFIG[val >= 70 ? "green" : val >= 40 ? "amber" : "red"].color;
}

function ExpandedRow({ item }) {
  return (
    <tr>
      <td colSpan={8} style={{ padding: "0" }}>
        <div style={{ padding: "12px 18px 12px 40px", background: "#0a0a14", borderBottom: "1px solid #131326" }}>
          <div style={{ display: "flex", gap: "28px", flexWrap: "wrap" }}>
            {Object.entries(HEALTH_DIMENSION_LABELS).map(([key, label]) => {
              const val = item.dimensions[key];
              const tier = val >= 70 ? "green" : val >= 40 ? "amber" : "red";
              const cfg = HEALTH_TIER_CONFIG[tier];
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
          <div style={{ marginTop: "10px", display: "flex", gap: "16px", flexWrap: "wrap", fontSize: "10px" }}>
            <span style={{ color: "#282844" }}>Validators: <span style={{ color: "#555577" }}>{item.subnet.active_validators}/{item.subnet.max_validators}</span></span>
            <span style={{ color: "#282844" }}>Miners: <span style={{ color: "#555577" }}>{item.subnet.active_miners}/{item.subnet.max_neurons}</span></span>
            <span style={{ color: "#282844" }}>Emission: <span style={{ color: item.hasEmission ? "#33bb66" : "#333355" }}>{item.hasEmission ? "Active" : "Zero"}</span></span>
            {item.pool && <span style={{ color: "#282844" }}>Volume 24h: <span style={{ color: "#555577" }}>{Number(item.pool.tao_volume_24_hr || 0).toLocaleString()}</span></span>}
          </div>
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
        <span style={{ color: "#333355", fontSize: "10px", letterSpacing: "0.1em", fontWeight: 600 }}>HOW HEALTH SCORE IS CALCULATED</span>
      </div>
      {open && (
        <div style={{ padding: "0 18px 16px 18px", maxWidth: "800px" }}>
          <p style={txt}>
            The <span style={{ color: "#5555ff" }}>Subnet Health Score</span> is a 0-100 composite that works for ALL subnets regardless of emission status. It uses only emission-independent on-chain and market metrics, so zero-emission subnets get meaningful scores.
          </p>

          <div style={heading}>D1: NETWORK HEALTH (40%)</div>
          <p style={txt}>
            <span style={dim}>H1.1</span> Validator Activity — active validators / max validators
            <br /><span style={dim}>H1.2</span> Miner Saturation — active miners / max neurons
            <br /><span style={dim}>H1.3</span> Key Utilization — active keys / max neurons
            <br /><span style={dim}>H1.4</span> Registration Demand — new registrations this interval
          </p>

          <div style={heading}>D2: MARKET CONFIDENCE (35%)</div>
          <p style={txt}>
            <span style={dim}>H2.1</span> Liquidity Depth — total TAO in AMM pool
            <br /><span style={dim}>H2.2</span> Staking Ratio — alpha staked vs total alpha supply
            <br /><span style={dim}>H2.3</span> Trading Activity — 24hr TAO volume
            <br /><span style={dim}>H2.4</span> Market Cap — total market capitalization
          </p>

          <div style={heading}>D3: STABILITY (25%)</div>
          <p style={txt}>
            <span style={dim}>H3.1</span> Price Stability — lower weekly price volatility scores higher
            <br /><span style={dim}>H3.2</span> Capital Flow — 7-day net TAO flow (positive = inflows)
            <br /><span style={dim}>H3.3</span> Buy Pressure — buy/sell ratio over 24hrs (above 0.5 = net buying)
          </p>

          <div style={heading}>SCORING METHOD</div>
          <p style={txt}>
            Each metric is percentile-ranked against all 129 subnets (0-100). Dimension scores are the average of their metric percentiles. The composite is a weighted sum: D1{"\u00D7"}0.40 + D2{"\u00D7"}0.35 + D3{"\u00D7"}0.25.
          </p>

          <div style={heading}>TIERS</div>
          <p style={txt}>
            <span style={{ color: HEALTH_TIER_CONFIG.green.color }}>GREEN (70-100)</span> — Strong health across all dimensions
            <br /><span style={{ color: HEALTH_TIER_CONFIG.amber.color }}>AMBER (40-69)</span> — Mixed signals, some areas need attention
            <br /><span style={{ color: HEALTH_TIER_CONFIG.red.color }}>RED (0-39)</span> — Weak fundamentals, significant concerns
          </p>

          <div style={heading}>VS SRI RISK INDEX</div>
          <p style={txt}>
            The SRI tab uses emission-dependent metrics (emission share, miner economics, coverage ratio) and can only score subnets with active emission. This Health tab is complementary — it scores ALL subnets using participation and market data only.
          </p>
        </div>
      )}
    </div>
  );
}

export default function HealthScanner() {
  const [scored, setScored] = useState([]);
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
      const results = scoreHealth(subnets, pools, meta, mechDataMap);
      setScored(results);
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

  const counts = {
    total: scored.length,
    green: scored.filter(s => s.tier === "green").length,
    amber: scored.filter(s => s.tier === "amber").length,
    red: scored.filter(s => s.tier === "red").length,
    withEmission: scored.filter(s => s.hasEmission).length,
  };

  const TC = HEALTH_TIER_CONFIG;

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

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={S.title}>{"\u25C8"} SUBNET HEALTH</span>
          {counts.green > 0 && <span style={{ color: TC.green.color, fontSize: "10px", background: TC.green.bg, border: `1px solid ${TC.green.border}`, padding: "2px 8px", borderRadius: "3px" }}>{counts.green} GREEN</span>}
          {counts.amber > 0 && <span style={{ color: TC.amber.color, fontSize: "10px", background: TC.amber.bg, border: `1px solid ${TC.amber.border}`, padding: "2px 8px", borderRadius: "3px" }}>{counts.amber} AMBER</span>}
          {counts.red > 0 && <span style={{ color: TC.red.color, fontSize: "10px", background: TC.red.bg, border: `1px solid ${TC.red.border}`, padding: "2px 8px", borderRadius: "3px" }}>{counts.red} RED</span>}
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
        <span style={{ color: "#282844" }}>D1 Network {"\u00D7"}40%</span>
        <span style={{ color: "#282844" }}>D2 Market {"\u00D7"}35%</span>
        <span style={{ color: "#282844" }}>D3 Stability {"\u00D7"}25%</span>
        <span style={{ color: "#1e1e33" }}>{"\u00B7"}</span>
        <span style={{ color: TC.green.color }}>GREEN {"\u2265"}70</span>
        <span style={{ color: TC.amber.color }}>AMBER {"\u2265"}40</span>
        <span style={{ color: TC.red.color }}>RED {"<"}40</span>
        <span style={{ color: "#1e1e33" }}>{"\u00B7"} emission-independent</span>
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

      {scored.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <div style={S.statsBar}>
            <span>{counts.total} subnets scored</span>
            {counts.green > 0 && <span style={{ color: TC.green.color }}>{counts.green} green</span>}
            {counts.amber > 0 && <span style={{ color: TC.amber.color }}>{counts.amber} amber</span>}
            {counts.red > 0 && <span style={{ color: TC.red.color }}>{counts.red} red</span>}
            <span>{"\u00B7"} {counts.withEmission} with emission</span>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "780px" }}>
            <thead>
              <tr style={S.thead}>
                <th style={{ ...S.thLeft, width: "36px" }}>#</th>
                <th style={{ ...S.thLeft }}>SUBNET</th>
                <th style={{ ...S.th, width: "58px" }}>SCORE</th>
                <th style={{ ...S.th, width: "56px" }}>TIER</th>
                <th style={{ ...S.th, width: "80px" }}>D1 NETWORK</th>
                <th style={{ ...S.th, width: "80px" }}>D2 MARKET</th>
                <th style={{ ...S.th, width: "80px" }}>D3 STABLE</th>
                <th style={{ ...S.thLeft, width: "60px" }}>EMISSION</th>
              </tr>
            </thead>
            <tbody>
              {scored.map((s, i) => {
                const tierCfg = TC[s.tier];
                const isExpanded = expanded[s.netuid];
                const rowBg = s.tier === "red"
                  ? `linear-gradient(90deg, ${tierCfg.bg} 0%, #070710 60%)`
                  : i % 2 === 0 ? "#0b0b15" : "#090912";

                return (
                  <React.Fragment key={s.netuid}>
                    <tr
                      className="trow"
                      style={{ background: rowBg, borderBottom: `1px solid ${s.tier === "red" ? "#200018" : "#0e0e18"}`, cursor: "pointer" }}
                      onClick={() => toggleExpand(s.netuid)}
                    >
                      <td style={{ ...S.cellLeft, color: "#282844" }}>{i + 1}</td>
                      <td style={S.cellLeft}>
                        <SubnetLogo url={s.logo} name={s.name} />
                        <span style={{ color: tierCfg.color, fontWeight: s.tier === "green" ? 600 : 400 }}>{s.name}</span>
                        <span style={{ color: "#1e1e30", fontSize: "10px", marginLeft: "7px" }}>SN{s.netuid}</span>
                        <span style={{ color: "#1a1a2e", fontSize: "9px", marginLeft: "5px" }}>{isExpanded ? "\u25BC" : "\u25B6"}</span>
                      </td>
                      <td style={S.cell}><ScoreBadge score={s.composite} tier={s.tier} /></td>
                      <td style={S.cell}><TierLabel tier={s.tier} /></td>
                      <td style={S.cell}><DimensionBar value={s.dimensions.D1} color={tierColor(s.dimensions.D1)} /></td>
                      <td style={S.cell}><DimensionBar value={s.dimensions.D2} color={tierColor(s.dimensions.D2)} /></td>
                      <td style={S.cell}><DimensionBar value={s.dimensions.D3} color={tierColor(s.dimensions.D3)} /></td>
                      <td style={S.cellLeft}>
                        <span style={{ color: s.hasEmission ? "#33bb66" : "#333355", fontSize: "10px" }}>
                          {s.hasEmission ? "\u25CF" : "\u25CB"}
                        </span>
                      </td>
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

      <div style={{ padding: "12px 18px", borderTop: "1px solid #0d0d1e", color: "#141420", fontSize: "10px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "6px" }}>
        <span>Data: TaoStats API {"\u00B7"} Emission-independent health scoring {"\u00B7"} Not financial advice</span>
        <span>Crypto Millie {"\u2014"} Capital Rotation Intelligence</span>
      </div>
    </div>
  );
}
