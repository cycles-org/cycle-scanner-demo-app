// Phase-based badge color for the Cycles table — matches .NET CycleScanner2's
// GetCyclePhaseColorBadge / GetCyclePhaseType / GetCyclePhaseBadgeColor mapping.
//
// Source of truth: the cycle-tools-api skill's "Cycle Phase Scoring Reference":
//
//   avgPhaseStatus              app-score band   phase type            badge
//   ──────────────────────────  ──────────────   ─────────────────     ─────
//   Uptrend_Starting             100              BottomDeparture       orange
//   BOTTOM_Departure              88              BottomDeparture       orange
//   BOTTOM_Arrival                78              BottomArrival         orange
//   Uptrend_Neutral             54-72             Upswing               green
//   Uptrend_ApproachingTop        48              TopArrival            orange
//   TOP_Arrival                   42              TopArrival            orange
//   TOP_Departure                 30              TopDeparture          orange
//   Downtrend_ApproachingBottom   36              BottomArrival         orange
//   Downtrend_Neutral           12-30             Downswing             red
//   Downtrend_Starting             0              TopDeparture          orange
//
// The .NET implementation uses Mud color names: Success=green, Warning=orange, Error=red.

export const PhaseType = {
  BottomDeparture: 'BottomDeparture',
  Upswing: 'Upswing',
  TopArrival: 'TopArrival',
  TopDeparture: 'TopDeparture',
  Downswing: 'Downswing',
  BottomArrival: 'BottomArrival',
};

export function classifyPhase(phaseStatus) {
  if (!phaseStatus) return PhaseType.Upswing;
  switch (phaseStatus) {
    case 'Uptrend_Starting':
    case 'BOTTOM_Departure':
      return PhaseType.BottomDeparture;
    case 'BOTTOM_Arrival':
    case 'Downtrend_ApproachingBottom':
      return PhaseType.BottomArrival;
    case 'Uptrend_Neutral':
      return PhaseType.Upswing;
    case 'Uptrend_ApproachingTop':
    case 'TOP_Arrival':
      return PhaseType.TopArrival;
    case 'TOP_Departure':
    case 'Downtrend_Starting':
      return PhaseType.TopDeparture;
    case 'Downtrend_Neutral':
      return PhaseType.Downswing;
    default:
      return PhaseType.Upswing;
  }
}

export function phaseTypeToColor(phaseType) {
  switch (phaseType) {
    case PhaseType.Upswing:        return '#3fb950';   // green  (Mud Success)
    case PhaseType.Downswing:      return '#f85149';   // red    (Mud Error)
    case PhaseType.BottomDeparture:
    case PhaseType.BottomArrival:
    case PhaseType.TopArrival:
    case PhaseType.TopDeparture:
    default:                       return '#d29922';   // orange (Mud Warning)
  }
}

export function phaseColorForPeak(peak, useCurrentPhase = false) {
  // .NET uses avgPhaseStatus by default; useCurrentPhase flag swaps to the current pass.
  const status = useCurrentPhase ? peak.phaseStatus : (peak.avgPhaseStatus ?? peak.phaseStatus);
  return phaseTypeToColor(classifyPhase(status));
}

// Bartels-score color mapper for spectrum triangles — matches the BokehJS
// LinearColorMapper(palette: ['red','blue','green'], low: 0, high: 100).
// Linear interpolation across the palette stops.
export function bartelsTriangleColor(bartelsValue) {
  if (!Number.isFinite(bartelsValue)) return '#888';
  const t = Math.max(0, Math.min(1, bartelsValue / 100));
  // Two-segment lerp: red → blue (t in [0, 0.5]); blue → green (t in [0.5, 1]).
  const stops = [
    { stop: 0.0, r: 248, g: 81,  b: 73  },   // red    (#f85149)
    { stop: 0.5, r: 88,  g: 166, b: 255 },   // blue   (#58a6ff)
    { stop: 1.0, r: 63,  g: 185, b: 80  },   // green  (#3fb950)
  ];
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (t <= stops[i + 1].stop) {
      const a = stops[i], b = stops[i + 1];
      const u = (t - a.stop) / (b.stop - a.stop);
      const r = Math.round(a.r + (b.r - a.r) * u);
      const g = Math.round(a.g + (b.g - a.g) * u);
      const bb = Math.round(a.b + (b.b - a.b) * u);
      return `rgb(${r},${g},${bb})`;
    }
  }
  return `rgb(${stops[stops.length - 1].r},${stops[stops.length - 1].g},${stops[stops.length - 1].b})`;
}
