// Runtime-configurable q/h for the v440 emission gate. These are root-sudo
// governance parameters on-chain and can change at any time — every tab
// that imports lib/gate.js should read q/h from here rather than hardcoding
// GATE_DEFAULTS, so a governance change re-prices every position in the
// tool consistently and is visibly labeled as such (see The Bar tab header).
import { createContext, useContext, useState, useMemo } from "react";
import { GATE_DEFAULTS } from "./gate.js";

const GateConfigContext = createContext(null);

export function GateConfigProvider({ children }) {
  const [q, setQ] = useState(GATE_DEFAULTS.q);
  const [h, setH] = useState(GATE_DEFAULTS.h);

  const value = useMemo(() => ({
    q,
    h,
    setQ,
    setH,
    resetToDefaults: () => { setQ(GATE_DEFAULTS.q); setH(GATE_DEFAULTS.h); },
    isDefault: q === GATE_DEFAULTS.q && h === GATE_DEFAULTS.h,
  }), [q, h]);

  return <GateConfigContext.Provider value={value}>{children}</GateConfigContext.Provider>;
}

export function useGateConfig() {
  const ctx = useContext(GateConfigContext);
  if (!ctx) throw new Error("useGateConfig must be used within GateConfigProvider");
  return ctx;
}
