// Static SVG icon representing the current cycle phase as a mini sine
// wave with a colored chevron arrow at the correct position, pointing
// along the wave's tangent. Each of the 10 CycleScanner phase strings
// maps to a fixed position [0, 1) where 0.0 = trough and 0.5 = peak.
//
// Spec: cycle-tools-api skill — references/phase-visualization-guide.md
// Reference impl: EconomicCycleComposite/src/components/PhaseIcon.tsx

const VW = 52;
const VH = 26;
const AMP = 7.5;
const CY = VH / 2;

// Theme-aware colors — wired to the app's existing CSS custom properties
// (defined in styles.css for both dark and light themes).
const GREEN  = 'var(--good)';
const ORANGE = 'var(--warn)';
const RED    = 'var(--danger)';
const BLUE   = 'var(--accent)';
const WAVE        = 'var(--accent)';
const WAVE_FUTURE = 'var(--text-dim)';

function waveY(t, cy, amp) {
  return cy - amp * Math.sin(2 * Math.PI * t - Math.PI / 2);
}

// Tangent angle at position t (radians, SVG coords where y-down).
// dy/dt = -amp * 2π * cos(2πt - π/2). Negative dy = going up on screen.
function waveTangentAngle(t, amp, width) {
  const dydt = -amp * 2 * Math.PI * Math.cos(2 * Math.PI * t - Math.PI / 2);
  return Math.atan2(dydt, width);
}

function wavePath(t0, t1, cy, amp, width, steps = 40) {
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = t0 + (t1 - t0) * (i / steps);
    pts.push(`${(t * width).toFixed(1)},${waveY(t, cy, amp).toFixed(1)}`);
  }
  return pts.join(' ');
}

// Two-line chevron forming a > shape, centered at origin pointing right.
// Rotated via transform to follow the wave's tangent.
function chevronPath(len) {
  const spread = len * 0.7;
  return `M${-len * 0.4},${-spread} L${len * 0.6},0 L${-len * 0.4},${spread}`;
}

function resolvePhase(phaseStatus, avgPhaseScore) {
  switch (phaseStatus) {
    case 'BOTTOM_Arrival':              return { pos: 0.95, color: BLUE };
    case 'BOTTOM_Departure':            return { pos: 0.05, color: GREEN };
    case 'Uptrend_Starting':            return { pos: 0.10, color: GREEN };
    case 'Uptrend_Neutral': {
      const t = avgPhaseScore != null
        ? Math.max(0, Math.min(1, (avgPhaseScore - 30) / 30))
        : 0.5;
      return { pos: 0.15 + t * 0.25, color: GREEN };
    }
    case 'Uptrend_ApproachingTop':      return { pos: 0.42, color: ORANGE };
    case 'TOP_Arrival':                 return { pos: 0.48, color: ORANGE };
    case 'TOP_Departure':               return { pos: 0.52, color: RED };
    case 'Downtrend_Starting':          return { pos: 0.55, color: RED };
    case 'Downtrend_Neutral': {
      const t = avgPhaseScore != null
        ? Math.max(0, Math.min(1, (avgPhaseScore - (-30)) / (-30)))
        : 0.5;
      return { pos: 0.60 + t * 0.25, color: RED };
    }
    case 'Downtrend_ApproachingBottom': return { pos: 0.88, color: BLUE };

    // Fallback simple phases (CycleExplorer-style)
    case 'Rising':  return { pos: 0.25, color: GREEN };
    case 'Falling': return { pos: 0.75, color: RED };
    case 'Top':     return { pos: 0.50, color: ORANGE };
    case 'Bottom':  return { pos: 0.00, color: BLUE };
    default:        return { pos: 0.25, color: GREEN };
  }
}

export default function PhaseIcon({ phaseStatus, avgPhaseScore, size = 16, title }) {
  const { pos, color } = resolvePhase(phaseStatus, avgPhaseScore);
  const width = size * (VW / VH);

  const ax = pos * VW;
  const ay = waveY(pos, CY, AMP);
  const angle = waveTangentAngle(pos, AMP, VW) * (180 / Math.PI);

  const pastP = wavePath(0, pos, CY, AMP, VW);
  const futureP = wavePath(pos, 1, CY, AMP, VW);

  return (
    <svg
      width={width}
      height={size}
      viewBox={`0 0 ${VW} ${VH}`}
      style={{ display: 'inline-block', flexShrink: 0, verticalAlign: 'middle' }}
    >
      {title ? <title>{title}</title> : null}
      {/* Past wave */}
      <polyline
        points={pastP}
        fill="none"
        stroke={WAVE}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Future wave */}
      <polyline
        points={futureP}
        fill="none"
        stroke={WAVE_FUTURE}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="2 1.5"
      />
      {/* Dot + chevron at current position */}
      <circle cx={ax.toFixed(1)} cy={ay.toFixed(1)} r="2" fill={color} />
      <g transform={`translate(${ax.toFixed(1)},${ay.toFixed(1)}) rotate(${angle.toFixed(1)})`}>
        <path
          d={chevronPath(6)}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
