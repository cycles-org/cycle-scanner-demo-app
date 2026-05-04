// Floats over the top-left of the chart pane: symbol label + correlation chips
// (in-sample, visible-range) + selected-cycle chips. Matches the badge row of
// the .NET scanner page.

import { useMemo } from 'react';
import { useScannerStore } from '../state/useScannerStore.js';
import { phaseColorForPeak } from '../utils/phaseColor.js';

function corrColor(v) {
  if (!Number.isFinite(v)) return '#444';
  return Math.abs(v) > 0.5 ? '#3fb950' : '#d29922';
}

export default function SymbolHeader() {
  const picked = useScannerStore((s) => s.picked);
  const inSampleCorr = useScannerStore((s) => s.inSampleCorr);
  const visibleCorr = useScannerStore((s) => s.visibleCorr);
  const peaks = useScannerStore((s) => s.peaks);
  const selected = useScannerStore((s) => s.selected);
  const bars = useScannerStore((s) => s.bars);
  const projectionBars = useScannerStore((s) => s.projectionBars);
  const selectedCycles = useMemo(
    () => peaks.filter((p) => selected.has(p.cycleLength)),
    [peaks, selected],
  );

  if (!picked) return null;

  const symLabel = `${picked.symbol ?? '?'} · ${picked.exchange ?? ''} · ${picked.shortName ?? ''}`;
  const sampleStart = bars[0]?.date?.toISOString?.()?.slice(0, 10);
  const sampleEnd = bars[bars.length - 1]?.date?.toISOString?.()?.slice(0, 10);

  return (
    <div className="symbol-header">
      <div className="row">
        <span className="symbol">{symLabel}</span>
        {Number.isFinite(inSampleCorr) && (
          <span className="chip" style={{ backgroundColor: corrColor(inSampleCorr) }} title="in-sample correlation">
            {inSampleCorr.toFixed(2)}
          </span>
        )}
        {Number.isFinite(visibleCorr) && (
          <span className="chip" style={{ backgroundColor: corrColor(visibleCorr) }} title="visible-range correlation">
            {visibleCorr.toFixed(2)}
          </span>
        )}
      </div>
      <div className="row">
        {selectedCycles.length > 0 && (
          <>
            <span className="muted">selected:</span>
            {selectedCycles.map((c) => (
              <span
                key={c.cycleLength}
                className="cycle-chip"
                style={{ backgroundColor: phaseColorForPeak(c, false) }}
                title={`amp ${c.amplitude?.toFixed(1)}  stab ${(c.stabilityScore * 100)?.toFixed(0)}%`}
              >
                C{Math.round(c.cycleLength)}
              </span>
            ))}
            <span className="muted">(p: 0)</span>
          </>
        )}
      </div>
      {sampleStart && sampleEnd && (
        <div className="row sample">
          In-sample: {sampleStart} – {sampleEnd} ({bars.length}/{projectionBars} bars)
        </div>
      )}
    </div>
  );
}
