// Right-pane bottom — toggles for the composite overlay and CRSI plus the
// forward-projection slider. Mirrors the "Composite Overlay" / "Info" toggle
// row at the bottom of the .NET scanner's right pane.

import { useScannerStore } from '../state/useScannerStore.js';

export default function IndicatorPanel() {
  const showComposite = useScannerStore((s) => s.showComposite);
  const showCRSI = useScannerStore((s) => s.showCRSI);
  const compositeMode = useScannerStore((s) => s.compositeMode);
  const projectionBars = useScannerStore((s) => s.projectionBars);
  const setShowComposite = useScannerStore((s) => s.setShowComposite);
  const setShowCRSI = useScannerStore((s) => s.setShowCRSI);
  const setCompositeMode = useScannerStore((s) => s.setCompositeMode);
  const setProjectionBars = useScannerStore((s) => s.setProjectionBars);

  return (
    <div className="indicator-panel">
      <label className="toggle">
        <input type="checkbox" checked={showComposite} onChange={(e) => setShowComposite(e.target.checked)} />
        <span>Composite Cycle</span>
      </label>
      <div className="sub-row" style={{ opacity: showComposite ? 1 : 0.4 }}>
        <span className="sub-label">place on:</span>
        <label className="radio">
          <input
            type="radio" name="compMode" value="pane"
            checked={compositeMode === 'pane'}
            disabled={!showComposite}
            onChange={() => setCompositeMode('pane')}
          />
          <span>own pane</span>
        </label>
        <label className="radio">
          <input
            type="radio" name="compMode" value="overlay"
            checked={compositeMode === 'overlay'}
            disabled={!showComposite}
            onChange={() => setCompositeMode('overlay')}
          />
          <span>price overlay</span>
        </label>
      </div>
      <div className="sub-hint">use these radios to move the composite — the chart's right-click menu shows "Move pane" items in 3.1.4 but they remain disabled for indicators with precomputed series</div>
      <label className="toggle">
        <input type="checkbox" checked={showCRSI} onChange={(e) => setShowCRSI(e.target.checked)} />
        <span>Cyclic RSI</span>
      </label>
      <div className="slider-row">
        <span>Project</span>
        <input
          type="range" min="0" max="500" step="10"
          value={projectionBars}
          onChange={(e) => setProjectionBars(Number(e.target.value))}
        />
        <span className="value">{projectionBars}</span>
      </div>
    </div>
  );
}
