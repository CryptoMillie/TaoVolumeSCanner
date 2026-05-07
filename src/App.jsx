import { useState } from "react";
import VolumeScanner from "./VolumeScanner.jsx";
import SRIScanner from "./SRIScanner.jsx";
import HealthScanner from "./HealthScanner.jsx";
import IntelScanner from "./IntelScanner.jsx";
import AlphaScanner from "./AlphaScanner.jsx";

const TAB_STYLE = (active) => ({
  background: active ? "#1818cc" : "transparent",
  border: active ? "1px solid #4444ff" : "1px solid #1a1a2e",
  color: active ? "#ffffff" : "#444466",
  padding: "6px 18px",
  borderRadius: "3px 3px 0 0",
  cursor: "pointer",
  fontSize: "11px",
  fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace",
  fontWeight: active ? 700 : 400,
  letterSpacing: "0.08em",
});

export default function App() {
  const [tab, setTab] = useState("volume");

  return (
    <div style={{ fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace", background: "#070710", minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { margin: 0; background: #070710; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: #070710; }
        ::-webkit-scrollbar-thumb { background: #1a1a2e; border-radius: 2px; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        .trow:hover { background: #111120 !important; }
        select option { background: #0d0d1a; }
      `}</style>

      <div style={{ background: "#060610", borderBottom: "1px solid #131326", padding: "0 18px", display: "flex", gap: "4px", paddingTop: "8px" }}>
        <button onClick={() => setTab("volume")} style={TAB_STYLE(tab === "volume")}>
          VOLUME SCANNER
        </button>
        <button onClick={() => setTab("sri")} style={TAB_STYLE(tab === "sri")}>
          SRI RISK INDEX
        </button>
        <button onClick={() => setTab("health")} style={TAB_STYLE(tab === "health")}>
          SUBNET HEALTH
        </button>
        <button onClick={() => setTab("intel")} style={TAB_STYLE(tab === "intel")}>
          INTEL FEED
        </button>
        <button onClick={() => setTab("alpha")} style={TAB_STYLE(tab === "alpha")}>
          ALPHA SIGNALS
        </button>
      </div>

      {tab === "volume" ? <VolumeScanner /> : tab === "sri" ? <SRIScanner /> : tab === "health" ? <HealthScanner /> : tab === "intel" ? <IntelScanner /> : <AlphaScanner />}
    </div>
  );
}
