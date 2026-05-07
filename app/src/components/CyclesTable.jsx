// Right-pane cycles table. Sortable headers, two multi-select columns:
//   - "C" (composite) — selected cycles are summed into the pink composite line
//   - "P" (pane)      — selected cycles each get their own pane below the chart
// Each cycle's Len cell shows a small PhaseIcon (mini sine wave + chevron)
// next to the cycle length, communicating both phase position AND direction
// at a glance. Light-green row tint for cycles with dominantRank in {1, 2, 3}.

import { useMemo, useState } from 'react';
import { useScannerStore } from '../state/useScannerStore.js';
import PhaseIcon from './PhaseIcon.jsx';

const COLUMNS = [
  { key: 'cycleLength',    label: 'Len',  fmt: (v) => Math.round(v) },
  { key: 'amplitude',      label: 'Amp',  fmt: (v) => v?.toFixed(2) },
  { key: 'strength',       label: 'Strg', fmt: (v) => v?.toFixed(2) },
  { key: 'stabilityScore', label: 'Stab', fmt: (v) => v != null ? v.toFixed(2) : '–' },
  { key: 'dominantRank',   label: 'R',    fmt: (v) => (v > 0 ? v : '') },
];

export default function CyclesTable() {
  const peaks = useScannerStore((s) => s.peaks);
  const selected = useScannerStore((s) => s.selected);
  const paneSelected = useScannerStore((s) => s.paneSelected);
  const toggleSelected = useScannerStore((s) => s.toggleSelected);
  const togglePaneSelected = useScannerStore((s) => s.togglePaneSelected);
  const clearSelected = useScannerStore((s) => s.clearSelected);
  const clearPaneSelected = useScannerStore((s) => s.clearPaneSelected);

  const [sortKey, setSortKey] = useState('stabilityScore');
  const [sortDir, setSortDir] = useState('desc');

  const rows = useMemo(() => {
    const sign = sortDir === 'asc' ? 1 : -1;
    return [...peaks].sort((a, b) => {
      const va = a[sortKey] ?? -Infinity;
      const vb = b[sortKey] ?? -Infinity;
      return va < vb ? -sign : va > vb ? sign : 0;
    });
  }, [peaks, sortKey, sortDir]);

  const onHeaderClick = (key) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  if (peaks.length === 0) {
    return (
      <div className="cycles-table empty">
        <div className="hint">cycle list loads after a scan</div>
      </div>
    );
  }

  return (
    <div className="cycles-table">
      <div className="cycles-toolbar">
        <span className="title">Cycle Spectrum (p: 0)</span>
        <button onClick={clearSelected} title="clear composite selection">×C</button>
        <button onClick={clearPaneSelected} title="clear individual panes">×P</button>
      </div>
      <div className="cycles-scroll">
        <table>
          <thead>
            <tr>
              <th className="col-pick" title="add to composite">C</th>
              <th className="col-pick col-pane" title="show in own pane">P</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => onHeaderClick(c.key)}
                  className={sortKey === c.key ? `sorted ${sortDir}` : ''}
                >
                  {c.label}
                  {sortKey === c.key && <span className="arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const isSelected = selected.has(p.cycleLength);
              const isPaneSelected = paneSelected.has(p.cycleLength);
              const isDominant = p.dominantRank > 0 && p.dominantRank <= 3;
              const phaseStatus = p.avgPhaseStatus ?? p.phaseStatus ?? '';
              return (
                <tr
                  key={`${p.cycleLength}-${p.minBarNum}`}
                  className={[
                    isSelected ? 'is-selected' : '',
                    isDominant ? 'is-dominant' : '',
                  ].join(' ').trim()}
                  onClick={() => toggleSelected(p.cycleLength)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="col-pick" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="select-cycle"
                      checked={isSelected}
                      onChange={() => toggleSelected(p.cycleLength)}
                      title="add to composite"
                    />
                  </td>
                  <td className="col-pick col-pane" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="select-cycle pane-cycle"
                      checked={isPaneSelected}
                      onChange={() => togglePaneSelected(p.cycleLength)}
                      title="show in own pane"
                    />
                  </td>
                  <td>
                    <span className="cycle-len-cell" title={`phase: ${phaseStatus || '?'}`}>
                      <PhaseIcon
                        phaseStatus={phaseStatus}
                        avgPhaseScore={p.avgPhaseScore}
                        size={16}
                      />
                      <span className="len-num">{Math.round(p.cycleLength)}</span>
                    </span>
                  </td>
                  {COLUMNS.slice(1).map((c) => (
                    <td key={c.key}>{c.fmt(p[c.key])}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
