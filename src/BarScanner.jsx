import { useState, useEffect, useCallback, useRef } from "react";
import { useGateConfig } from "./lib/GateConfigContext.jsx";
import { fetchBarInputs, forceRefreshBarInputs } from "./bar/api.js";
import { scoreBar, sortRows } from "./bar/scoring.js";
import { getThetaHistory } from "./bar/thetaHistory.js";
import { ZONES, MINER_BURN_FLAG_THRESHOLD, SORT_MODES } from "./bar/constants.js";

// ─── Formatters ───────────────────────────────────────────

function fPct(v, decimals = 1) {
  if (v == null || !isFinite(v)) return "—";
  return (v * 100).toFixed(decimals) + "%";
}

function fR(v) {
  if (v == null || !isFinite(v)) return "—";
  return v.toFixed(2) + "×";
}

function fSigned(v, decimals = 1) {
  if (v == null || !isFinite(v)) return "—";
  const s = v >= 0 ? "+" : "";
  return s + (v * 100).toFixed(decimals) + "%";
}

// ─── Tooltip (same pattern as ConvictionScanner) ───────────

function Tooltip({ text, children }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const onEnter = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPos({ x: rect.left, y: rect.bottom + 6 });
    setShow(true);
  };

  return (
    <span onMouseEnter={onEnter} onMouseLeave={() => setShow(false)} style={{ cursor: "help", borderBottom: "1px dotted #333355" }}>
      {children}
      {show && (
        <div style={{
          position: "fixed", left: Math.min(pos.x, window.innerWidth - 360), top: pos.y, zIndex: 9999,
          background: "#0d0d1a", border: "1px solid #222244", borderRadius: "4px", padding: "10px 14px",
          maxWidth: "340px", fontSize: "10px", lineHeight: "1.5", color: "#8888aa", fontWeight: 400,
          boxShadow: "0 4px 20px rgba(0,0,0,0.6)", pointerEvents: "none",
        }}>
          {text}
        </div>
      )}
    </span>
  );
}

// ─── Styles (matches terminal-blue convention across all scanners) ─────

const S = {
  root: { fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace", background: "#070710", minHeight: "100vh", color: "#b0b0cc", fontSize: "12px" },
  header: { background: "#0d0d1a", borderBottom: "1px solid #151528", padding: "18px 24px 14px" },
  title: { color: "#5555ff", fontWeight: 700, fontSize: "14px", letterSpacing: "0.08em" },
  subtitle: { color: "#444466", fontSize: "10px", marginTop: "4px" },
  btn: (active) => ({ background: active ? "#1818cc" : "transparent", border: `1px solid ${active ? "#4444ff" : "#1a1a2e"}`, color: active ? "#fff" : "#555577", padding: "4px 12px", borderRadius: "3px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", fontWeight: active ? 700 : 400 }),
  statRow: { display: "flex", gap: "12px", padding: "14px 24px", flexWrap: "wrap", borderBottom: "1px solid #0d0d1e" },
  card: { background: "#0a0a14", border: "1px solid #1a1a2e", borderRadius: "4px", padding: "10px 16px", minWidth: "130px", flex: "1 1 130px" },
  cardLabel: { color: "#444466", fontSize: "9px", letterSpacing: "0.1em", textTransform: "uppercase" },
  cardValue: (color) => ({ color: color || "#b0b0cc", fontSize: "17px", fontWeight: 700, marginTop: "4px" }),
  cardSub: { color: "#333355", fontSize: "9px", marginTop: "2px" },
  govCard: { background: "#0a0a14", border: "1px solid #2a2a1a", borderRadius: "4px", padding: "10px 16px", minWidth: "160px" },
  numInput: { width: "56px", background: "#10101e", border: "1px solid #2a2a44", color: "#ddaa00", padding: "3px 6px", borderRadius: "3px", fontSize: "11px", fontFamily: "inherit" },
  section: { padding: "16px 24px" },
  sectionTitle: { color: "#5555ff", fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", marginBottom: "10px" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "right", padding: "6px 10px", fontSize: "9px", color: "#444466", borderBottom: "1px solid #151528", letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" },
  thLeft: { textAlign: "left", padding: "6px 10px", fontSize: "9px", color: "#444466", borderBottom: "1px solid #151528", letterSpacing: "0.08em", textTransform: "uppercase" },
  td: { textAlign: "right", padding: "7px 10px", fontSize: "11px", borderBottom: "1px solid #0e0e1c", whiteSpace: "nowrap" },
  tdLeft: { textAlign: "left", padding: "7px 10px", fontSize: "11px", borderBottom: "1px solid #0e0e1c" },
  loading: { textAlign: "center", padding: "70px 20px", color: "#333355", fontSize: "12px" },
  error: { margin: "16px 24px", padding: "12px 16px", background: "#ff000f10", border: "1px solid #ff003330", borderRadius: "4px", color: "#ff4455", fontSize: "11px" },
  warnBanner: { margin: "0 24px 16px", padding: "8px 14px", background: "#ffaa0010", border: "1px solid #ffaa0030", borderRadius: "4px", color: "#ddaa33", fontSize: "10px" },
};

const ZONE_LABEL_STYLE = { position: "absolute", top: "-16px", fontSize: "8px", letterSpacing: "0.08em" };

// ─── r-axis visual ──────────────────────────────────────────

function AxisVisual({ rows }) {
  const [hover, setHover] = useState(null);
  const AXIS_MAX = 3;
  const maxMcap = Math.max(1, ...rows.map((r) => r.marketCap || 0));

  return (
    <div style={{ position: "relative", padding: "34px 24px 24px", background: "#0a0a14", border: "1px solid #1a1a2e", borderRadius: "4px" }}>
      <div style={{ position: "relative", height: "8px", borderRadius: "4px", overflow: "visible" }}>
        {ZONES.map((z) => {
          const left = (z.min / AXIS_MAX) * 100;
          const width = ((Math.min(z.max, AXIS_MAX) - z.min) / AXIS_MAX) * 100;
          return (
            <div key={z.key} style={{ position: "absolute", left: `${left}%`, width: `${width}%`, top: 0, height: "8px", background: z.color, borderRadius: "2px" }}>
              <span style={{ ...ZONE_LABEL_STYLE, color: z.text }}>{z.label}</span>
            </div>
          );
        })}
        {/* bar marker at r=1 */}
        <div style={{ position: "absolute", left: `${(1 / AXIS_MAX) * 100}%`, top: "-6px", width: "2px", height: "20px", background: "#ffffff", opacity: 0.6 }} />

        {rows.filter((r) => r.ratio != null && isFinite(r.ratio)).map((r) => {
          const left = Math.min(100, (Math.min(r.ratio, AXIS_MAX) / AXIS_MAX) * 100);
          const size = 4 + 10 * Math.sqrt((r.marketCap || 0) / maxMcap);
          const zone = ZONES.find((z) => r.ratio >= z.min && r.ratio < z.max) || ZONES[ZONES.length - 1];
          return (
            <div
              key={r.netuid}
              onMouseEnter={() => setHover(r)}
              onMouseLeave={() => setHover((h) => (h?.netuid === r.netuid ? null : h))}
              style={{
                position: "absolute", left: `${left}%`, top: `${-size / 2 + 4}px`,
                width: `${size}px`, height: `${size}px`, borderRadius: "50%",
                background: zone.text, border: "1px solid #070710",
                transform: "translateX(-50%)", cursor: "pointer",
                transition: "left 0.6s ease",
                boxShadow: hover?.netuid === r.netuid ? `0 0 8px ${zone.text}` : "none",
              }}
            />
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "10px", fontSize: "9px", color: "#333355" }}>
        <span>0</span><span>0.5</span><span>1.0 (bar)</span><span>1.5</span><span>2.0</span><span>2.5</span><span>3.0+</span>
      </div>
      {hover && (
        <div style={{ marginTop: "10px", padding: "8px 12px", background: "#10101e", border: "1px solid #222244", borderRadius: "3px", fontSize: "10px", color: "#8888aa" }}>
          <strong style={{ color: "#b0b0cc" }}>{hover.name}</strong> (SN{hover.netuid}) — r={fR(hover.ratio)}, gate keeps {fPct(hover.gate, 0)}, elasticity {hover.elasticity?.toFixed(2)}
        </div>
      )}
    </div>
  );
}

// ─── theta history sparkline (inline SVG, no chart lib) ────

function ThetaSparkline({ history }) {
  if (!history || history.length < 2) {
    return <div style={{ color: "#333355", fontSize: "10px", padding: "10px 0" }}>Not enough history yet — theta is recorded once per tempo (~72 min).</div>;
  }
  const W = 560, H = 60, PAD = 4;
  const values = history.map((h) => h.theta);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const points = history.map((h, i) => {
    const x = PAD + (i / (history.length - 1)) * (W - 2 * PAD);
    const y = H - PAD - ((h.theta - min) / range) * (H - 2 * PAD);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <polyline points={points} fill="none" stroke="#5555ff" strokeWidth="1.5" />
      <text x={PAD} y={12} fill="#444466" fontSize="8">{max.toFixed(4)}</text>
      <text x={PAD} y={H - PAD} fill="#444466" fontSize="8">{min.toFixed(4)}</text>
    </svg>
  );
}

// ─── Panel table ────────────────────────────────────────────

function PanelTable({ title, hint, rows, mode }) {
  return (
    <div style={{ flex: "1 1 420px", minWidth: "380px" }}>
      <div style={{ color: "#5555ff", fontSize: "11px", fontWeight: 700, marginBottom: "4px" }}>{title}</div>
      <div style={{ color: "#333355", fontSize: "9px", marginBottom: "8px" }}>{hint}</div>
      <div style={{ overflowX: "auto" }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.thLeft}>SUBNET</th>
              <th style={S.th}>r</th>
              <th style={S.th}>GATE</th>
              <th style={S.th}>ELASTICITY</th>
              <th style={S.th}>{mode === "buffer" ? "BUFFER" : "GAP"}</th>
              <th style={S.th}>{"Δr 24h"}</th>
              <th style={S.th}>{"Δr 7d"}</th>
              <th style={S.th}>BURN</th>
              <th style={S.th}>SHARE</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", color: "#333355" }}>No subnets in this range right now</td></tr>
            )}
            {rows.map((r) => {
              const burnFlag = r.minerBurn > MINER_BURN_FLAG_THRESHOLD;
              return (
                <tr key={r.netuid} className="trow">
                  <td style={S.tdLeft}>
                    <span style={{ color: "#b0b0cc" }}>{r.name}</span>
                    <span style={{ color: "#2a2a3a", fontSize: "9px", marginLeft: "6px" }}>SN{r.netuid}</span>
                    {r.priceSource === "proxy" && <Tooltip text="Chain RPC unavailable — using taostats pool price as a proxy for SubnetMovingPrice."><span style={{ color: "#ddaa00", fontSize: "9px", marginLeft: "5px" }}>~</span></Tooltip>}
                  </td>
                  <td style={{ ...S.td, color: r.ratio >= 1 ? "#33bb66" : "#ff8833", fontWeight: 600 }}>{fR(r.ratio)}</td>
                  <td style={S.td}>{fPct(r.gate, 0)}</td>
                  <td style={S.td}>{r.elasticity?.toFixed(2)}{"×"}</td>
                  <td style={S.td}>
                    {r.ratio >= 1 ? fPct(r.bufferAboveBar, 0) : (isFinite(r.gapToBar) ? `+${fPct(r.gapToBar, 0)}` : "—")}
                  </td>
                  <td style={{ ...S.td, color: r.deltaR24h == null ? "#333355" : r.deltaR24h > 0 ? "#33bb66" : r.deltaR24h < 0 ? "#cc3333" : "#666688" }}>
                    {r.deltaR24h == null ? "—" : fSigned(r.deltaR24h, 1)}
                  </td>
                  <td style={{ ...S.td, color: r.deltaR7d == null ? "#333355" : r.deltaR7d > 0 ? "#33bb66" : r.deltaR7d < 0 ? "#cc3333" : "#666688" }}>
                    {r.deltaR7d == null ? "—" : fSigned(r.deltaR7d, 1)}
                  </td>
                  <td style={{ ...S.td, color: burnFlag ? "#ff6644" : "#555577" }}>{fPct(r.minerBurn, 0)}{burnFlag ? " ⚠" : ""}</td>
                  <td style={{ ...S.td, color: "#444466" }}>{fPct(r.share, 2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Reconciliation dev panel ───────────────────────────────

function ReconciliationPanel({ rows }) {
  const [show, setShow] = useState(false);
  const flagged = rows.filter((r) => r.reconciliationFlagged);

  return (
    <div style={{ ...S.section, borderTop: "1px solid #0d0d1e" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }} onClick={() => setShow((s) => !s)}>
        <span style={S.sectionTitle}>{"▸"} RECONCILIATION — computed vs on-chain share {show ? "▼" : "▶"}</span>
        {flagged.length > 0 && <span style={{ color: "#ff6644", fontSize: "10px" }}>{flagged.length} subnet(s) off by &gt;2%</span>}
      </div>
      {show && (
        <div style={{ overflowX: "auto", marginTop: "10px" }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.thLeft}>SUBNET</th>
                <th style={S.th}>COMPUTED SHARE</th>
                <th style={S.th}>ON-CHAIN SHARE</th>
                <th style={S.th}>DELTA</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 40).map((r) => (
                <tr key={r.netuid} className="trow">
                  <td style={S.tdLeft}>{r.name} <span style={{ color: "#2a2a3a", fontSize: "9px" }}>SN{r.netuid}</span></td>
                  <td style={S.td}>{fPct(r.share, 2)}</td>
                  <td style={S.td}>{fPct(r.onChainShare, 2)}</td>
                  <td style={{ ...S.td, color: r.reconciliationFlagged ? "#ff4455" : "#555577", fontWeight: r.reconciliationFlagged ? 700 : 400 }}>{fSigned(r.reconciliationDelta, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────

export default function BarScanner() {
  const { q, h, setQ, setH, resetToDefaults, isDefault } = useGateConfig();

  const [scored, setScored] = useState(null);
  const [thetaHist, setThetaHist] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [sortMode, setSortMode] = useState(SORT_MODES.DISTANCE);
  const timerRef = useRef();

  const scan = useCallback(async (force = false) => {
    setLoading(true);
    setErr(null);
    try {
      const inputs = force ? await forceRefreshBarInputs() : await fetchBarInputs();
      const result = scoreBar(inputs, { q, h });
      setScored(result);
      setThetaHist(getThetaHistory());
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [q, h]);

  useEffect(() => { scan(); }, [scan]);

  useEffect(() => {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => scan(), 5 * 60 * 1000); // 5-min UI poll; chain fetch itself caches per-tempo
    return () => clearInterval(timerRef.current);
  }, [scan]);

  if (loading && !scored) {
    return (
      <div style={S.root}>
        <div style={S.loading}>
          <div style={{ fontSize: "28px", animation: "pulse 1s infinite" }}>{"▰"}</div>
          <div style={{ marginTop: "12px", letterSpacing: "0.2em", fontSize: "13px" }}>READING THE GATE...</div>
          <div style={{ color: "#141426", marginTop: "6px", fontSize: "10px" }}>Querying Finney RPC + taostats</div>
        </div>
      </div>
    );
  }

  if (err && !scored) {
    return (
      <div style={S.root}>
        <div style={S.error}>{err}</div>
        <div style={{ padding: "0 24px" }}>
          <button style={S.btn(true)} onClick={() => scan()}>{"⟳"} RETRY</button>
        </div>
      </div>
    );
  }

  if (!scored) return null;

  const unifiedSorted = sortMode !== SORT_MODES.DISTANCE ? sortRows(scored.rows, sortMode) : null;
  const thetaAsShare = scored.rows.find((r) => r.demand === scored.theta)?.share;

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <span style={S.title}>{"▰"} THE BAR</span>
          <button onClick={() => scan(true)} disabled={loading} style={S.btn(loading)}>{loading ? "SCANNING..." : "⟳ REFRESH"}</button>
          {!scored.chainAvailable && (
            <Tooltip text={scored.chainError || "Chain RPC unreachable — showing taostats-proxy values for price/burn where chain data is missing."}>
              <span style={{ color: "#ddaa00", fontSize: "10px" }}>{"⚠"} proxy data in use</span>
            </Tooltip>
          )}
          {scored.rpcEndpoint && <span style={{ color: "#2a2a44", fontSize: "10px" }}>via {scored.rpcEndpoint}</span>}
        </div>
        <div style={S.subtitle}>
          v440 emission gate — proximity to theta (the bar) is the signal that matters, not raw emission. Ratios cancel absolute demand units.
        </div>
      </div>

      {!scored.chainAvailable && (
        <div style={S.warnBanner}>
          Finney RPC unreachable from this session — moving price / miner-burn are falling back to taostats pool price / incentive_burn where the on-chain map couldn't be read. See NOTES.md for the verified storage schema.
        </div>
      )}

      {/* Header strip */}
      <div style={S.statRow}>
        <div style={S.card}>
          <div style={S.cardLabel}>{"θ"} (theta / the bar)</div>
          <div style={S.cardValue("#5555ff")}>{scored.theta?.toFixed(4)}</div>
          <div style={S.cardSub}>{thetaAsShare != null ? `≈ ${fPct(thetaAsShare, 2)} share at the crossing` : ""}</div>
        </div>
        <div style={S.card}>
          <div style={S.cardLabel}>{"Δθ"} 1 tempo / 24h / 7d</div>
          <div style={{ display: "flex", gap: "8px", marginTop: "4px", fontSize: "12px" }}>
            {[["1t", scored.thetaChange1Tempo], ["24h", scored.thetaChange24h], ["7d", scored.thetaChange7d]].map(([label, chg]) => (
              <span key={label} style={{ color: chg == null ? "#333355" : chg.pctChange > 0 ? "#ff8833" : chg.pctChange < 0 ? "#33bb66" : "#666688" }}>
                {label}: {chg == null ? "—" : fSigned(chg.pctChange, 1)}
              </span>
            ))}
          </div>
          <div style={S.cardSub}>falling theta = self-limiting; rising = concentration compounding</div>
        </div>
        <div style={S.card}>
          <div style={S.cardLabel}>RANK AT BAR</div>
          <div style={S.cardValue()}>{scored.rankAtBar ?? "—"}</div>
          <div style={S.cardSub}>subnets carrying q of total demand</div>
        </div>
        <div style={S.card}>
          <div style={S.cardLabel}>EFFECTIVE SUBNET COUNT</div>
          <div style={S.cardValue()}>{scored.effectiveCount?.toFixed(1)}</div>
          <div style={S.cardSub}>1 / {"Σ"}(share{"²"}) — "network behaves like N subnets"</div>
        </div>
        <div style={S.govCard}>
          <div style={{ ...S.cardLabel, color: "#aa8833" }}>GOVERNANCE PARAMETERS</div>
          <div style={{ display: "flex", gap: "10px", marginTop: "6px", alignItems: "center" }}>
            <label style={{ fontSize: "10px", color: "#776633" }}>q <input type="number" step="0.01" min="0.01" max="0.99" value={q} onChange={(e) => setQ(parseFloat(e.target.value) || 0.61)} style={S.numInput} /></label>
            <label style={{ fontSize: "10px", color: "#776633" }}>h <input type="number" step="1" min="1" max="10" value={h} onChange={(e) => setH(parseFloat(e.target.value) || 3)} style={S.numInput} /></label>
            {!isDefault && <button onClick={resetToDefaults} style={{ ...S.btn(false), padding: "3px 8px" }}>reset</button>}
          </div>
          <div style={S.cardSub}>editing previews a scenario locally — does not change chain state. Chain q/h: {scored.onChainQ != null ? scored.onChainQ.toFixed(2) : "—"} / {scored.onChainH != null ? scored.onChainH.toFixed(0) : "—"}</div>
        </div>
      </div>

      {/* Axis visual */}
      <div style={S.section}>
        <div style={S.sectionTitle}>PROXIMITY TO THE BAR</div>
        <AxisVisual rows={scored.rows} />
      </div>

      {/* Sort mode + panels */}
      <div style={S.section}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
          <span style={S.sectionTitle}>SORT</span>
          <button style={S.btn(sortMode === SORT_MODES.DISTANCE)} onClick={() => setSortMode(SORT_MODES.DISTANCE)}>|r-1| closest (default)</button>
          <button style={S.btn(sortMode === SORT_MODES.RISING)} onClick={() => setSortMode(SORT_MODES.RISING)}>fastest rising</button>
          <button style={S.btn(sortMode === SORT_MODES.FALLING)} onClick={() => setSortMode(SORT_MODES.FALLING)}>fastest falling</button>
          <button style={S.btn(sortMode === SORT_MODES.ELASTICITY)} onClick={() => setSortMode(SORT_MODES.ELASTICITY)}>highest elasticity</button>
        </div>

        {sortMode === SORT_MODES.DISTANCE ? (
          <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
            <PanelTable title="PANEL A — JUST ABOVE (1.0–1.6×)" hint="most precarious first — ascending r" rows={scored.panelA} mode="buffer" />
            <PanelTable title="PANEL B — JUST BELOW (0.4–1.0×)" hint="closest to breaking through first — descending r" rows={scored.panelB} mode="gap" />
          </div>
        ) : (
          <PanelTable
            title={sortMode === SORT_MODES.RISING ? "FASTEST RISING (Δr 24h)" : sortMode === SORT_MODES.FALLING ? "FASTEST FALLING (Δr 24h)" : "HIGHEST ELASTICITY"}
            hint="all emission-enabled subnets, unified view"
            rows={unifiedSorted.slice(0, 30)}
            mode={null}
          />
        )}
      </div>

      {/* Theta history */}
      <div style={{ ...S.section, borderTop: "1px solid #0d0d1e" }}>
        <div style={S.sectionTitle}>{"θ"} HISTORY {thetaHist.length > 0 && <span style={{ color: "#333355", fontWeight: 400 }}>({thetaHist.length} tempo{thetaHist.length === 1 ? "" : "s"} recorded)</span>}</div>
        <ThetaSparkline history={thetaHist} />
      </div>

      <ReconciliationPanel rows={scored.reconciliation} />

      <div style={{ padding: "12px 24px", borderTop: "1px solid #0d0d1e", color: "#141420", fontSize: "10px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "6px" }}>
        <span>Data: Finney RPC (SubnetMovingPrice / MinerBurned / EmissionGateBar) + taostats fallback {"·"} q/h are governance-mutable {"·"} Not financial advice</span>
        <span>Crypto Millie {"—"} Capital Rotation Intelligence</span>
      </div>
    </div>
  );
}
