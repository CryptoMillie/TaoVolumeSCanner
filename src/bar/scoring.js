// The Bar — ties fetched inputs (src/bar/api.js) to the shared gate math
// (src/lib/gate.js) and theta persistence (src/bar/thetaHistory.js) into the
// exact shape BarScanner.jsx renders: header stats, Panel A/B, and the
// reconciliation dev panel.

import { applyGate, gapToBar, bufferAboveBar, effectiveSubnetCount, demandFromPriceAndBurn } from "../lib/gate.js";
import { computeEmissionPerCap, poolMarketCapUsdMillions, classifyEmissionPerCap, classifyEmissionPerCapTrend } from "../lib/emissionPerCap.js";
import { PANEL_A_RANGE, PANEL_B_RANGE, RECONCILIATION_DELTA_THRESHOLD } from "./constants.js";
import { recordSnapshot, getPastRatio, getPastEmissionPerCap, getThetaChange } from "./thetaHistory.js";

export function scoreBar(barInputs, { q, h }) {
  const withDemand = barInputs.rows.map((r) => ({
    ...r,
    demand: demandFromPriceAndBurn(r.movingPrice, r.minerBurn),
  }));

  const gated = applyGate(withDemand, { q, h });
  const theta = gated[0]?.theta ?? 0;

  // Rank at the bar: position in the demand-sorted active list where the
  // crossing subnet (the one whose demand == theta) sits.
  const sortedByDemand = [...gated]
    .filter((s) => s.emissionEnabled && s.demand > 0)
    .sort((a, b) => b.demand - a.demand);
  const crossingIdx = sortedByDemand.findIndex((s) => s.demand === theta);
  const rankAtBar = crossingIdx >= 0 ? crossingIdx + 1 : null;

  const effectiveCount = effectiveSubnetCount(gated.map((s) => s.share));

  // Emission-per-cap (added 2026-07-29): emissionSharePct / marketCapUsdMillions,
  // using the real on-chain emission share (not the client-computed gated
  // share) as the numerator — this is the number taostats itself would show,
  // per the brief's framing of "taostats shows emission share and market cap
  // separately and never divides them."
  const epcByNetuid = {};
  gated.forEach((s) => {
    const emissionSharePct = barInputs.totalOnChainEmission > 0
      ? (s.onChainEmission / barInputs.totalOnChainEmission) * 100
      : 0;
    const marketCapUsdMillions = poolMarketCapUsdMillions(s.marketCap, barInputs.taoUsdPrice);
    epcByNetuid[s.netuid] = computeEmissionPerCap(emissionSharePct, marketCapUsdMillions);
  });

  // Persist this tempo's snapshot (internally gated on cadence — safe to call every render).
  const ratios = {};
  gated.forEach((s) => { ratios[s.netuid] = s.ratio; });
  recordSnapshot({
    theta,
    onChainTheta: barInputs.onChainTheta,
    rankAtBar,
    effectiveCount,
    ratios,
    emissionPerCap: epcByNetuid,
  });

  const rows = gated.map((s) => {
    const pastRatio24h = getPastRatio(s.netuid, 24);
    const pastRatio7d = getPastRatio(s.netuid, 24 * 7);
    const onChainShare = barInputs.totalOnChainEmission > 0
      ? s.onChainEmission / barInputs.totalOnChainEmission
      : 0;
    const reconciliationDelta = s.share - onChainShare;

    const emissionPerCap = epcByNetuid[s.netuid];
    const epcTier = classifyEmissionPerCap({ ratio: emissionPerCap, si: s.si, change1M: s.change1M });
    const epcPastRatio24h = getPastEmissionPerCap(s.netuid, 24);
    const epcTrend = classifyEmissionPerCapTrend({
      pastRatio: epcPastRatio24h,
      currentRatio: emissionPerCap,
      priceChangePct: s.change1M,
    });

    return {
      ...s,
      deltaR24h: pastRatio24h != null ? s.ratio - pastRatio24h : null,
      deltaR7d: pastRatio7d != null ? s.ratio - pastRatio7d : null,
      gapToBar: gapToBar(s.ratio),
      bufferAboveBar: bufferAboveBar(s.ratio),
      onChainShare,
      reconciliationDelta,
      reconciliationFlagged: Math.abs(reconciliationDelta) > RECONCILIATION_DELTA_THRESHOLD,
      emissionPerCap,
      epcTier,
      epcTrend,
    };
  });

  const panelA = rows
    .filter((r) => r.ratio >= PANEL_A_RANGE.min && r.ratio <= PANEL_A_RANGE.max && r.emissionEnabled)
    .sort((a, b) => a.ratio - b.ratio); // ascending — most precarious first

  const panelB = rows
    .filter((r) => r.ratio >= PANEL_B_RANGE.min && r.ratio < PANEL_B_RANGE.max && r.emissionEnabled)
    .sort((a, b) => b.ratio - a.ratio); // descending — closest to breaking through first

  const reconciliation = [...rows]
    .filter((r) => r.emissionEnabled)
    .sort((a, b) => Math.abs(b.reconciliationDelta) - Math.abs(a.reconciliationDelta));

  return {
    rows,
    panelA,
    panelB,
    reconciliation,
    theta,
    onChainTheta: barInputs.onChainTheta,
    onChainQ: barInputs.onChainQ,
    onChainH: barInputs.onChainH,
    rankAtBar,
    effectiveCount,
    thetaChange1Tempo: getThetaChange(1.2), // ~72 min
    thetaChange24h: getThetaChange(24),
    thetaChange7d: getThetaChange(24 * 7),
    chainAvailable: barInputs.chainAvailable,
    chainError: barInputs.chainError,
    rpcEndpoint: barInputs.rpcEndpoint,
    fetchedAt: barInputs.fetchedAt,
  };
}

/**
 * Sort-mode implementations for the two panels' combined "all subnets" view
 * (brief §5 sort modes). Operates on the flat `rows` array from scoreBar().
 */
export function sortRows(rows, mode) {
  const active = rows.filter((r) => r.emissionEnabled && r.demand > 0);
  switch (mode) {
    case "rising":
      return [...active]
        .filter((r) => r.deltaR24h != null)
        .sort((a, b) => b.deltaR24h - a.deltaR24h);
    case "falling":
      return [...active]
        .filter((r) => r.deltaR24h != null)
        .sort((a, b) => a.deltaR24h - b.deltaR24h);
    case "elasticity":
      return [...active].sort((a, b) => b.elasticity - a.elasticity);
    case "epc":
      return [...active]
        .filter((r) => r.emissionPerCap != null)
        .sort((a, b) => b.emissionPerCap - a.emissionPerCap);
    case "distance":
    default:
      return [...active].sort((a, b) => Math.abs(a.ratio - 1) - Math.abs(b.ratio - 1));
  }
}
