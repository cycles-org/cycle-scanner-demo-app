// Cycle spectrum visualization — SVG. Filled area shows the amplitude curve
// (period → amplitude); triangle markers sit at peak positions, colored by
// Bartels score (red ≤33 → blue ≈50 → green ≥67) matching the BokehJS palette
// in the .NET app. Clicking a triangle toggles the cycle's selection.
// Hover anywhere shows crosshair lines; hovering a peak shows a tooltip with
// the cycle's full set of details.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useScannerStore } from '../state/useScannerStore.js';
import { bartelsTriangleColor } from '../utils/phaseColor.js';

const PADDING = { top: 10, right: 12, bottom: 22, left: 36 };

export default function SpectrumChart() {
  const spectrum = useScannerStore((s) => s.spectrum);
  const cycleStart = useScannerStore((s) => s.cycleStart);
  const cycleResolution = useScannerStore((s) => s.cycleResolution);
  const peaks = useScannerStore((s) => s.peaks);
  const selected = useScannerStore((s) => s.selected);
  const toggleSelected = useScannerStore((s) => s.toggleSelected);

  const containerRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 200 });
  const [hover, setHover] = useState(null);   // { x, y, period, amp, peak? }

  // ResizeObserver keeps the SVG dimensions in sync with the container.
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: Math.max(200, Math.floor(width)), h: Math.max(100, Math.floor(height)) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const innerW = Math.max(10, w - PADDING.left - PADDING.right);
  const innerH = Math.max(10, h - PADDING.top - PADDING.bottom);

  const periods = useMemo(
    () => spectrum.map((_, i) => cycleStart + i * cycleResolution),
    [spectrum, cycleStart, cycleResolution],
  );
  const periodMin = periods[0] ?? 0;
  const periodMax = periods[periods.length - 1] ?? 1;
  const ampMax = useMemo(() => spectrum.reduce((m, v) => (v > m ? v : m), 0), [spectrum]);

  const px = (period) => PADDING.left + ((period - periodMin) / (periodMax - periodMin || 1)) * innerW;
  const py = (amp) => PADDING.top + innerH - (amp / (ampMax || 1)) * innerH;

  // Inverse — pixel x → cycle period (for the crosshair label)
  const pxToPeriod = (x) =>
    periodMin + ((x - PADDING.left) / innerW) * (periodMax - periodMin || 1);

  const areaPath = useMemo(() => {
    if (spectrum.length === 0) return '';
    const pts = spectrum.map((v, i) => `${px(periods[i])},${py(v)}`);
    return `M${PADDING.left},${PADDING.top + innerH} L${pts.join(' L')} L${PADDING.left + innerW},${PADDING.top + innerH} Z`;
  }, [spectrum, periods, ampMax, w, h]);   // eslint-disable-line react-hooks/exhaustive-deps

  const xTicks = useMemo(() => {
    const ticks = [];
    const step = Math.max(50, Math.round((periodMax - periodMin) / 8 / 50) * 50);
    for (let p = Math.ceil(periodMin / step) * step; p <= periodMax; p += step) ticks.push(p);
    return ticks;
  }, [periodMin, periodMax]);

  // Find the closest peak (within 10 px) to the mouse — for tooltip pinning.
  const peakNear = (mouseX, mouseY) => {
    let best = null;
    let bestD = 12;
    for (const peak of peaks) {
      const dx = px(peak.cycleLength) - mouseX;
      const dy = py(peak.amplitude) - mouseY;
      const d = Math.hypot(dx, dy);
      if (d < bestD) { bestD = d; best = peak; }
    }
    return best;
  };

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < PADDING.left || x > PADDING.left + innerW) { setHover(null); return; }
    const period = pxToPeriod(x);
    // Find amplitude at this period (nearest spectrum index)
    const idx = Math.max(0, Math.min(spectrum.length - 1,
      Math.round((period - periodMin) / cycleResolution)));
    const amp = spectrum[idx];
    const peak = peakNear(x, y);
    setHover({ x, y, period, amp, peak });
  };
  const onLeave = () => setHover(null);

  if (spectrum.length === 0) {
    return (
      <div ref={containerRef} className="spectrum-empty">
        <span>spectrum loads after a cycle scan</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="spectrum-host"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <svg width={w} height={h} className="spectrum-svg">
        <path d={areaPath} fill="rgba(88, 166, 255, 0.18)" stroke="#58a6ff" strokeWidth="1.2" />

        <line
          x1={PADDING.left} y1={PADDING.top + innerH}
          x2={PADDING.left + innerW} y2={PADDING.top + innerH}
          stroke="#30363d" strokeWidth="1"
        />
        {xTicks.map((p) => (
          <g key={p}>
            <line
              x1={px(p)} y1={PADDING.top + innerH}
              x2={px(p)} y2={PADDING.top + innerH + 4}
              stroke="#30363d" strokeWidth="1"
            />
            <text x={px(p)} y={h - 6} textAnchor="middle" fontSize="10" fill="#8b949e">
              {p}
            </text>
          </g>
        ))}
        <text x={4} y={PADDING.top + 8} fontSize="10" fill="#8b949e">amp</text>
        <text x={4} y={PADDING.top + innerH - 2} fontSize="10" fill="#8b949e">0</text>

        {/* Crosshair lines (when hovering inside the plot area) */}
        {hover && (
          <g pointerEvents="none">
            <line
              x1={hover.x} y1={PADDING.top}
              x2={hover.x} y2={PADDING.top + innerH}
              stroke="#8b949e" strokeWidth="0.7" strokeDasharray="3,3"
            />
            <line
              x1={PADDING.left} y1={hover.y}
              x2={PADDING.left + innerW} y2={hover.y}
              stroke="#8b949e" strokeWidth="0.7" strokeDasharray="3,3"
            />
            {/* Period label on the x-axis */}
            <rect
              x={hover.x - 22} y={PADDING.top + innerH + 2}
              width="44" height="14" fill="#0d1117" stroke="#30363d"
            />
            <text
              x={hover.x} y={PADDING.top + innerH + 12}
              textAnchor="middle" fontSize="10" fill="#c9d1d9"
            >
              {Math.round(hover.period)}
            </text>
          </g>
        )}

        {peaks.map((peak) => {
          const cx = px(peak.cycleLength);
          const cy = py(peak.amplitude);
          const fill = bartelsTriangleColor(peak.bartelsValue);
          const isSelected = selected.has(peak.cycleLength);
          const r = isSelected ? 7 : 5;
          const path = `M${cx},${cy - r} L${cx - r},${cy + r * 0.7} L${cx + r},${cy + r * 0.7} Z`;
          return (
            <g key={`${peak.cycleLength}-${peak.minBarNum}`} className="spectrum-peak"
               style={{ cursor: 'pointer' }}
               onClick={() => toggleSelected(peak.cycleLength)}>
              <path
                d={path}
                fill={fill}
                stroke={isSelected ? '#ffffff' : '#000'}
                strokeWidth={isSelected ? 1.5 : 0.5}
                opacity={isSelected ? 1 : 0.85}
              />
            </g>
          );
        })}
      </svg>

      {/* HTML tooltip overlay — shows peak details when hovering near a triangle */}
      {hover?.peak && (
        <div
          className="spectrum-tooltip"
          style={{
            left: Math.min(hover.x + 14, w - 200),
            top: Math.max(8, hover.y - 100),
          }}
        >
          <div className="row title">
            <span className="badge" style={{ backgroundColor: bartelsTriangleColor(hover.peak.bartelsValue) }}>
              C{Math.round(hover.peak.cycleLength)}
            </span>
            <span className="rank">{hover.peak.dominantRank > 0 ? `rank ${hover.peak.dominantRank}` : ''}</span>
          </div>
          <div className="grid">
            <div><span>length</span><b>{hover.peak.cycleLength?.toFixed(1)}</b></div>
            <div><span>amplitude</span><b>{hover.peak.amplitude?.toFixed(2)}</b></div>
            <div><span>strength</span><b>{hover.peak.strength?.toFixed(2)}</b></div>
            <div><span>stability</span><b>{(hover.peak.stabilityScore * 100)?.toFixed(0)}%</b></div>
            <div><span>bartels</span><b>{hover.peak.bartelsValue?.toFixed(0)}</b></div>
            <div><span>phase</span><b>{(hover.peak.avgPhase ?? hover.peak.phase)?.toFixed(2)} rad</b></div>
            <div className="full"><span>status</span><b>{hover.peak.avgPhaseStatus ?? hover.peak.phaseStatus ?? '–'}</b></div>
          </div>
        </div>
      )}
    </div>
  );
}
