import { useState, useEffect, useCallback, useRef } from "react";
import { useSharedData } from "./DataContext.jsx";
import { useGateConfig } from "./lib/GateConfigContext.jsx";
import { applyGate, demandFromPriceAndBurn } from "./lib/gate.js";

function lvl(v){ return v>=40?"critical":v>=20?"high":v>=10?"medium":"low"; }
function fV(v){ return v>=1e6?`${(v/1e6).toFixed(2)}M`:v>=1e3?`${(v/1e3).toFixed(0)}K`:`${v.toFixed(0)}`; }
function fM(v){ return v>=1e6?`${(v/1e6).toFixed(1)}M`:`${v.toFixed(0)}`; }
function fP(v){ return (v>=0?"+":"")+v.toFixed(1)+"%"; }

const LEVEL_CONFIG = {
  critical:{ bg:"#1a0010", border:"#ff0033", text:"#ff4455", badge:"#ff003322", label:"\u{1F6A8} CRITICAL" },
  high:    { bg:"#1a0e00", border:"#ff6600", text:"#ff8833", badge:"#ff660018", label:"\u26A1 HIGH" },
  medium:  { bg:"#1a1600", border:"#ddaa00", text:"#ffdd44", badge:"#ffcc0012", label:"\u26A0 MEDIUM" },
  low:     { bg:"transparent", border:"#1e1e30", text:"#666688", badge:"#ffffff06", label:"\u00B7 LOW" },
};

export default function VolumeScanner() {
  const { forceRefreshCoinGecko, refreshTaoStats } = useSharedData();
  const { q, h } = useGateConfig();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [ts, setTs] = useState(null);
  const [auto, setAuto] = useState(true);
  const [freq, setFreq] = useState(60);
  const [filter, setFilter] = useState("all");
  const [sortCol, setSortCol] = useState("vmp");
  const [sortAsc, setSortAsc] = useState(false);
  const [spikeLog, setSpikeLog] = useState([]);
  const prevRef = useRef({});
  const timerRef = useRef();

  const scan = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      // Force-refresh CoinGecko (Volume Scanner auto-refreshes frequently)
      // TaoStats uses shared cached data, refresh if not loaded yet
      const [raw, tsData] = await Promise.all([
        forceRefreshCoinGecko(),
        refreshTaoStats(),
      ]);
      const poolsRaw = tsData.pools;
      const metaRaw = tsData.meta;
      const subnetsRaw = tsData.subnets;

      // Build name lookup: "sn44" -> best name from TaoStats pools + GitHub meta
      const pools = Array.isArray(poolsRaw) ? poolsRaw : (poolsRaw?.data || []);
      const subnetArr = Array.isArray(subnetsRaw) ? subnetsRaw : (subnetsRaw?.data || []);
      const poolMap = {};
      pools.forEach(p => {
        const id = p.netuid ?? p.subnet_id;
        if (id != null) poolMap[id] = p;
      });
      const nameMap = {};
      pools.forEach(p => {
        const id = p.netuid ?? p.subnet_id;
        if (id == null) return;
        const key = `sn${id}`;
        if (p.name && p.name !== "Unknown") { nameMap[key] = p.name; return; }
        const me = metaRaw[String(id)];
        if (me?.name) nameMap[key] = me.name;
      });

      // v440 gate pass (taostats-proxy demand — see The Bar tab for the
      // verified on-chain source + reconciliation). Elasticity here turns a
      // volume spike into a leading indicator: projected Δemission =
      // (1 + Δdemand)^elasticity - 1, using the VMP spike as a Δdemand
      // proxy — clearly a proxy, not a direct demand measurement.
      const demandRows = subnetArr
        .filter(s => (parseFloat(s.emission) || 0) > 0)
        .map(s => {
          const netuid = s.netuid ?? s.subnet_id;
          const pool = poolMap[netuid];
          const price = pool ? parseFloat(pool.price || pool.alpha_price || 0) : 0;
          const burn = parseFloat(s.incentive_burn || 0);
          return { netuid, demand: demandFromPriceAndBurn(price, burn), emissionEnabled: true };
        });
      const gated = applyGate(demandRows, { q, h });
      const gateByNetuid = {};
      gated.forEach(g => { gateByNetuid[g.netuid] = g; });

      const processed = raw.filter(s => s.total_volume > 0).map(s => {
        const mc = s.market_cap > 0 ? s.market_cap : (s.fully_diluted_valuation || 1);
        const vmp = (s.total_volume / mc) * 100;
        const prev = prevRef.current[s.symbol];
        const spike = prev ? ((s.total_volume - prev) / prev) * 100 : null;

        // "sn{netuid}" is the CoinGecko symbol format for this category —
        // join straight back to the gate map.
        const netuidMatch = /^sn(\d+)$/i.exec(s.symbol || "");
        const netuid = netuidMatch ? parseInt(netuidMatch[1], 10) : null;
        const gate = netuid != null ? gateByNetuid[netuid] : null;
        const projectedEmissionDelta = gate && spike != null
          ? Math.pow(1 + spike / 100, gate.elasticity) - 1
          : null;

        return { ...s, mc, vmp, lv: lvl(vmp), spike,
          label: nameMap[s.symbol] || s.name,
          c24: s.price_change_percentage_24h || 0,
          c7: s.price_change_percentage_7d_in_currency || 0,
          netuid, gateRatio: gate?.ratio ?? null, projectedEmissionDelta };
      }).sort((a, b) => b.vmp - a.vmp);

      const newSpikes = processed
        .filter(s => s.lv === "critical" || s.lv === "high")
        .map(s => ({ label: s.label, sym: s.symbol, vmp: s.vmp, c24: s.c24, t: new Date().toLocaleTimeString() }));
      setSpikeLog(prev => [...newSpikes, ...prev].slice(0, 12));

      const vm = {}; raw.forEach(s => { vm[s.symbol] = s.total_volume; });
      prevRef.current = vm;
      setRows(processed); setTs(new Date());
    } catch(e) { setErr(e.message); }
    setLoading(false);
  }, [forceRefreshCoinGecko, refreshTaoStats, q, h]);

  useEffect(() => { scan(); }, [scan]);
  useEffect(() => {
    clearInterval(timerRef.current);
    if (auto) timerRef.current = setInterval(scan, freq * 1000);
    return () => clearInterval(timerRef.current);
  }, [auto, freq, scan]);

  const toggleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(false); }
  };

  const display = rows.filter(s =>
    filter === "all" ? true :
    filter === "critical" ? s.lv === "critical" :
    filter === "high" ? s.lv === "critical" || s.lv === "high" :
    s.lv !== "low"
  ).sort((a, b) => {
    const av = a[sortCol] ?? 0, bv = b[sortCol] ?? 0;
    return sortAsc ? av - bv : bv - av;
  });

  const counts = { critical: rows.filter(s=>s.lv==="critical").length, high: rows.filter(s=>s.lv==="high").length, medium: rows.filter(s=>s.lv==="medium").length, low: rows.filter(s=>s.lv==="low").length };

  const S = {
    root: { fontFamily:"'JetBrains Mono','Fira Code','Courier New',monospace", background:"#070710", color:"#b0b0cc", minHeight:"100vh", fontSize:"12px" },
    header: { background:"#0d0d1a", borderBottom:"1px solid #151528", padding:"12px 18px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"10px" },
    title: { color:"#5555ff", fontWeight:700, fontSize:"14px", letterSpacing:"0.08em" },
    badge: (type) => ({ background: type==="critical"?"#ff003322":"#ff660018", border:`1px solid ${type==="critical"?"#ff0033":"#ff6600"}`, color: type==="critical"?"#ff4455":"#ff8833", padding:"2px 8px", borderRadius:"3px", fontSize:"10px" }),
    ts: { color:"#2a2a44", fontSize:"10px" },
    controls: { display:"flex", alignItems:"center", gap:"8px", flexWrap:"wrap" },
    select: { background:"#10101e", border:"1px solid #1a1a2e", color:"#7777aa", padding:"4px 8px", borderRadius:"3px", fontSize:"11px", fontFamily:"inherit" },
    toggleTrack: (on) => ({ width:"34px", height:"18px", background:on?"#2020cc":"#10102a", border:`1px solid ${on?"#4444ff":"#1a1a2e"}`, borderRadius:"9px", cursor:"pointer", position:"relative" }),
    toggleThumb: (on) => ({ width:"12px", height:"12px", background:on?"#8888ff":"#333355", borderRadius:"50%", position:"absolute", top:"2px", left:on?"18px":"2px", transition:"left 0.2s" }),
    btn: (dis) => ({ background:dis?"#10101e":"#1818cc", border:"none", color:dis?"#2a2a44":"#fff", padding:"6px 16px", borderRadius:"3px", cursor:dis?"not-allowed":"pointer", fontSize:"11px", fontFamily:"inherit", fontWeight:600, letterSpacing:"0.05em" }),
    threshBar: { background:"#0a0a13", borderBottom:"1px solid #131326", padding:"5px 18px", display:"flex", gap:"18px", flexWrap:"wrap", fontSize:"10px" },
    spikeArea: { background:"#090912", borderBottom:"1px solid #131326", padding:"7px 18px" },
    spikePill: (crit) => ({ background:crit?"#ff000f12":"#ff660010", border:`1px solid ${crit?"#ff003330":"#ff660025"}`, color:crit?"#ff4455":"#ff8833", padding:"2px 8px", borderRadius:"3px", fontSize:"10px" }),
    statsBar: { padding:"6px 18px", display:"flex", gap:"14px", borderBottom:"1px solid #0d0d1e", fontSize:"10px", color:"#222244" },
    thead: { background:"#0a0a14", borderBottom:"1px solid #131326" },
    th: { padding:"6px 8px", fontWeight:400, fontSize:"10px", color:"#282844", letterSpacing:"0.1em", textAlign:"right", cursor:"pointer", userSelect:"none" },
    thLeft: { padding:"6px 8px", fontWeight:400, fontSize:"10px", color:"#282844", letterSpacing:"0.1em", textAlign:"left" },
    thActive: { color:"#5555ff" },
    cell: { padding:"8px 8px", textAlign:"right" },
    cellLeft: { padding:"8px 8px", textAlign:"left" },
  };

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
          <span style={S.title}>{"\u25C8"} TAO VOL SPIKE SCANNER</span>
          {counts.critical > 0 && <span style={{...S.badge("critical"), animation:"pulse 1.2s infinite"}}>{counts.critical} CRITICAL</span>}
          {counts.high > 0 && <span style={S.badge("high")}>{counts.high} HIGH</span>}
          {ts && <span style={S.ts}>{"\u23F1"} {ts.toLocaleTimeString()}</span>}
        </div>
        <div style={S.controls}>
          <select value={filter} onChange={e=>setFilter(e.target.value)} style={S.select}>
            <option value="all">All subnets</option>
            <option value="critical">Critical only</option>
            <option value="high">High+</option>
            <option value="medium">Medium+</option>
          </select>
          <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
            <span style={{ color:"#282844", fontSize:"10px" }}>AUTO</span>
            <div style={S.toggleTrack(auto)} onClick={()=>setAuto(!auto)}>
              <div style={S.toggleThumb(auto)} />
            </div>
            {auto && (
              <select value={freq} onChange={e=>setFreq(+e.target.value)} style={S.select}>
                <option value={60}>60s</option>
                <option value={120}>2m</option>
                <option value={300}>5m</option>
                <option value={900}>15m</option>
                <option value={3600}>1hr</option>
                <option value={14400}>4hr</option>
                <option value={43200}>12hr</option>
              </select>
            )}
          </div>
          <button onClick={scan} disabled={loading} style={S.btn(loading)}>
            {loading ? "SCANNING..." : "\u27F3 REFRESH"}
          </button>
        </div>
      </div>

      <div style={S.threshBar}>
        <span style={{ color:"#1e1e33" }}>THRESHOLDS:</span>
        <span style={{ color:"#ff4455" }}>CRITICAL {"\u2265"}40% Vol/MC</span>
        <span style={{ color:"#ff8833" }}>HIGH {"\u2265"}20%</span>
        <span style={{ color:"#ccaa33" }}>MEDIUM {"\u2265"}10%</span>
        <span style={{ color:"#1e1e33" }}>Vol/MC = daily volume {"\u00F7"} market cap {"\u00D7"} 100</span>
      </div>

      {spikeLog.length > 0 && (
        <div style={S.spikeArea}>
          <div style={{ color:"#1e1e33", fontSize:"10px", marginBottom:"5px", letterSpacing:"0.1em" }}>{"\u25B8"} SPIKE LOG</div>
          <div style={{ display:"flex", gap:"5px", flexWrap:"wrap" }}>
            {spikeLog.slice(0,8).map((a,i) => (
              <span key={i} style={S.spikePill(a.vmp>=40)}>
                {a.label} {"\u2014"} {a.vmp.toFixed(0)}% | {fP(a.c24)} @ {a.t}
              </span>
            ))}
          </div>
        </div>
      )}

      {err && (
        <div style={{ margin:"12px 18px", padding:"10px 14px", background:"#ff000f10", border:"1px solid #ff003330", borderRadius:"4px", color:"#ff4455", fontSize:"11px" }}>
          {err}
        </div>
      )}

      {loading && rows.length === 0 && (
        <div style={{ padding:"70px", textAlign:"center", color:"#1e1e33" }}>
          <div style={{ fontSize:"28px", animation:"pulse 1s infinite" }}>{"\u25C8"}</div>
          <div style={{ marginTop:"12px", letterSpacing:"0.2em", fontSize:"13px" }}>SCANNING SUBNETS...</div>
          <div style={{ color:"#141426", marginTop:"6px", fontSize:"10px" }}>Fetching live CoinGecko data</div>
        </div>
      )}

      {display.length > 0 && (
        <div style={{ overflowX:"auto" }}>
          <div style={S.statsBar}>
            <span>{display.length} shown</span>
            {counts.critical>0 && <span style={{color:"#ff4455"}}>{counts.critical} crit</span>}
            {counts.high>0 && <span style={{color:"#ff8833"}}>{counts.high} high</span>}
            {counts.medium>0 && <span style={{color:"#ccaa33"}}>{counts.medium} med</span>}
            <span>{"\u00B7"} {counts.low} low</span>
          </div>

          <table style={{ width:"100%", borderCollapse:"collapse", minWidth:"700px" }}>
            <thead>
              <tr style={S.thead}>
                <th style={{...S.thLeft, width:"90px"}}>LEVEL</th>
                <th style={{...S.thLeft}}>SUBNET</th>
                <th style={{...S.th, width:"72px", ...(sortCol==="current_price"?S.thActive:{})}} onClick={()=>toggleSort("current_price")}>PRICE {sortCol==="current_price"?(sortAsc?"\u25B2":"\u25BC"):""}</th>
                <th style={{...S.th, width:"72px", ...(sortCol==="mc"?S.thActive:{})}} onClick={()=>toggleSort("mc")}>MKT CAP {sortCol==="mc"?(sortAsc?"\u25B2":"\u25BC"):""}</th>
                <th style={{...S.th, width:"72px", ...(sortCol==="total_volume"?S.thActive:{})}} onClick={()=>toggleSort("total_volume")}>VOLUME {sortCol==="total_volume"?(sortAsc?"\u25B2":"\u25BC"):""}</th>
                <th style={{...S.th, width:"58px", color:sortCol==="vmp"?"#5555ff":"#555577"}} onClick={()=>toggleSort("vmp")}>VOL/MC {sortCol==="vmp"?(sortAsc?"\u25B2":"\u25BC"):""}</th>
                <th style={{...S.th, width:"78px", ...(sortCol==="projectedEmissionDelta"?S.thActive:{})}} onClick={()=>toggleSort("projectedEmissionDelta")} title="Proxy leading indicator: (1 + volume spike%)^elasticity - 1, using this refresh's volume spike as a stand-in for demand change. Not the real gate output \u2014 see The Bar tab.">{"\u0394"} EMIT (proj) {sortCol==="projectedEmissionDelta"?(sortAsc?"\u25B2":"\u25BC"):""}</th>
                <th style={{...S.th, width:"56px", ...(sortCol==="c24"?S.thActive:{})}} onClick={()=>toggleSort("c24")}>24H {sortCol==="c24"?(sortAsc?"\u25B2":"\u25BC"):""}</th>
                <th style={{...S.th, width:"56px", ...(sortCol==="c7"?S.thActive:{})}} onClick={()=>toggleSort("c7")}>7D {sortCol==="c7"?(sortAsc?"\u25B2":"\u25BC"):""}</th>
                <th style={{...S.th, width:"68px", ...(sortCol==="ath_change_percentage"?S.thActive:{})}} onClick={()=>toggleSort("ath_change_percentage")}>ATH DISC {sortCol==="ath_change_percentage"?(sortAsc?"\u25B2":"\u25BC"):""}</th>
              </tr>
            </thead>
            <tbody>
              {display.map((s, i) => {
                const cfg = LEVEL_CONFIG[s.lv];
                const c24col = s.c24>5?"#33bb66":s.c24>0?"#336633":s.c24<-10?"#cc3333":"#443333";
                const c7col = s.c7>10?"#33bb66":s.c7>0?"#336633":s.c7<-20?"#cc2222":"#332222";
                const athCol = s.ath_change_percentage>-15?"#ddbb33":s.ath_change_percentage>-35?"#776600":"#221e00";
                const rowBg = s.lv==="critical"
                  ? `linear-gradient(90deg, ${cfg.bg} 0%, #070710 60%)`
                  : s.lv==="high"
                  ? `linear-gradient(90deg, ${cfg.bg} 0%, #070710 60%)`
                  : i%2===0 ? "#0b0b15" : "#090912";

                return (
                  <tr key={s.symbol} className="trow" style={{ background:rowBg, borderBottom:`1px solid ${s.lv==="critical"?"#200018":s.lv==="high"?"#201000":"#0e0e18"}` }}>
                    <td style={S.cellLeft}>
                      <span style={{ background:cfg.badge, border:`1px solid ${cfg.border}40`, color:cfg.text, padding:"2px 6px", borderRadius:"3px", fontSize:"10px", fontWeight:s.lv==="critical"?700:400 }}>
                        {cfg.label}
                      </span>
                    </td>
                    <td style={S.cellLeft}>
                      <span style={{ color:cfg.text, fontWeight:s.lv==="critical"||s.lv==="high"?600:400 }}>{s.label}</span>
                      <span style={{ color:"#1e1e30", fontSize:"10px", marginLeft:"7px" }}>{s.symbol.toUpperCase()}</span>
                      {s.spike !== null && Math.abs(s.spike) > 20 && (
                        <span style={{ marginLeft:"7px", color:s.spike>0?"#33bb66":"#cc3333", fontSize:"10px" }}>
                          {s.spike>0?"\u25B2":"\u25BC"}{Math.abs(s.spike).toFixed(0)}%
                        </span>
                      )}
                    </td>
                    <td style={{...S.cell, color:"#555577"}}>${s.current_price<1?s.current_price.toFixed(4):s.current_price.toFixed(2)}</td>
                    <td style={{...S.cell, color:"#2a2a3a"}}>{fM(s.mc)}</td>
                    <td style={{...S.cell, color:s.lv==="critical"?"#ff4455":s.lv==="high"?"#ff8833":"#555577"}}>{fV(s.total_volume)}</td>
                    <td style={{...S.cell, color:cfg.text, fontWeight:s.lv==="critical"?700:s.lv==="high"?600:400, fontSize:s.lv==="critical"?"14px":"12px"}}>
                      {s.vmp.toFixed(0)}%
                    </td>
                    <td style={{...S.cell, color: s.projectedEmissionDelta==null?"#333355":s.projectedEmissionDelta>0?"#33bb66":s.projectedEmissionDelta<0?"#cc3333":"#666688"}}
                      title={s.gateRatio!=null?`r=${s.gateRatio.toFixed(2)}× the bar`:""}
                    >
                      {s.projectedEmissionDelta==null ? "—" : fP(s.projectedEmissionDelta*100)}
                    </td>
                    <td style={{...S.cell, color:c24col}}>{fP(s.c24)}</td>
                    <td style={{...S.cell, color:c7col}}>{fP(s.c7)}</td>
                    <td style={{...S.cell, color:athCol}}>{(s.ath_change_percentage||0).toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ padding:"12px 18px", borderTop:"1px solid #0d0d1e", color:"#141420", fontSize:"10px", display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:"6px" }}>
        <span>Data: CoinGecko API {"\u00B7"} Vol/MC = volume anomaly proxy {"\u00B7"} Not financial advice</span>
        <span>Crypto Millie {"\u2014"} Capital Rotation Intelligence</span>
      </div>
    </div>
  );
}
