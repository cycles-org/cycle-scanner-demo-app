// Custom FintaChart indicators that play back precomputed series:
//   - CompositeCycle:        sum-of-sines around 0. Pane vs. overlay placement is
//                            chosen at add time via Pane.addIndicator() /
//                            addIndicatorInNewPane() (3.1.5+) — no two-class
//                            workaround needed.
//   - SingleCycleIndicator:  one sine wave for an individually-paned cycle.
//   - CrsiIndicator:         CRSI line + dynamic upper/lower bands, in its own pane.
//
// Every class declares standard FintaChart parameters via direct class accessors
// (`get / set` paired with `parameterValue` / `updateParameter`). The gear-icon
// settings dialog crash (#24) was fixed in FintaChart 3.1.5, so we no longer
// need `allowSettingsDialog = false`.

const FC = () => window.FintaChart;

let _classesCached = null;

export function getIndicatorClasses() {
  if (_classesCached) return _classesCached;
  const F = FC();
  const P = F.IndicatorParam;

  // ─── CompositeCycle ───────────────────────────────────────────────────────
  // Single class — used for both "own pane" and "overlay with own y-axis" mode.
  // The `isOverlay` value here is only the default; the actual pane choice is
  // made at add time via chart.primaryPane.addIndicator(ind) (overlay) or
  // chart.addIndicatorInNewPane(ind) (own pane), and Pane.addIndicator()
  // pins the pane before the add lifecycle so it wins over isOverlay.
  // See FintaChart docs/api/custom-indicators.md "Which pane?" (3.1.6+).
  class CompositeCycle extends F.Indicator {
    static get type() { return 'CompositeCycle'; }

    get inputDataRowName() { return this.parameterValue(P.SOURCE); }
    set inputDataRowName(v) { this.updateParameter(P.SOURCE, v); }

    get lineColor()  { return this.parameterValue(P.LINE_COLOR); }
    set lineColor(v) { this.updateParameter(P.LINE_COLOR, v); }

    get lineWidth()  { return this.parameterValue(P.LINE_WIDTH); }
    set lineWidth(v) { this.updateParameter(P.LINE_WIDTH, v); }

    get period()  { return this.parameterValue(P.PERIODS); }
    set period(v) { this.updateParameter(P.PERIODS, v); }

    onResetDefaults() {
      this.name = 'Composite';
      this.isOverlay = false;   // default; Pane.addIndicator() overrides at add time
      this.inputDataRowName = F.DataRowsMarker.CLOSE;
      this.lineColor = '#ec4899';
      this.lineWidth = 2;
      this.period = 1;
      this.addPlot(this.lineColor, 'Composite');
    }

    onInputTick() {
      const i = this.currentBar;
      const v = this._composite && this._composite[i];
      this.values.get('Composite').set(Number.isFinite(v) ? v : NaN);
    }
  }

  // ─── SingleCycleIndicator (one per individually-paned cycle) ─────────────
  // FintaChart re-runs onResetDefaults during addIndicators(), so we can't set
  // `name` after construction — instead pass the desired cycle length + color
  // through static "next" properties read by onResetDefaults.
  class SingleCycleIndicator extends F.Indicator {
    static get type() { return 'SingleCycle'; }
    static _nextLength = 0;
    static _nextColor = '#a78bfa';

    get inputDataRowName() { return this.parameterValue(P.SOURCE); }
    set inputDataRowName(v) { this.updateParameter(P.SOURCE, v); }

    get lineColor()  { return this.parameterValue(P.LINE_COLOR); }
    set lineColor(v) { this.updateParameter(P.LINE_COLOR, v); }

    get lineWidth()  { return this.parameterValue(P.LINE_WIDTH); }
    set lineWidth(v) { this.updateParameter(P.LINE_WIDTH, v); }

    get period()  { return this.parameterValue(P.PERIODS); }
    set period(v) { this.updateParameter(P.PERIODS, v); }

    onResetDefaults() {
      const L = SingleCycleIndicator._nextLength;
      this.name = L > 0 ? `C${L}` : 'Cycle';
      this.isOverlay = false;
      this.inputDataRowName = F.DataRowsMarker.CLOSE;
      this.lineColor = SingleCycleIndicator._nextColor;
      this.lineWidth = 2;
      this.period = L > 0 ? L : 1;
      this.addPlot(this.lineColor, 'Sine');
    }

    onInputTick() {
      const i = this.currentBar;
      const v = this._cycleSeries && this._cycleSeries[i];
      this.values.get('Sine').set(Number.isFinite(v) ? v : NaN);
    }
  }

  // ─── CrsiIndicator ────────────────────────────────────────────────────────
  class CrsiIndicator extends F.Indicator {
    static get type() { return 'CycleCRSI'; }

    get inputDataRowName() { return this.parameterValue(P.SOURCE); }
    set inputDataRowName(v) { this.updateParameter(P.SOURCE, v); }

    get lineColor()  { return this.parameterValue(P.LINE_COLOR); }
    set lineColor(v) { this.updateParameter(P.LINE_COLOR, v); }

    get lineWidth()  { return this.parameterValue(P.LINE_WIDTH); }
    set lineWidth(v) { this.updateParameter(P.LINE_WIDTH, v); }

    get period()  { return this.parameterValue(P.PERIODS); }
    set period(v) { this.updateParameter(P.PERIODS, v); }

    onResetDefaults() {
      this.name = 'Cyclic RSI';
      this.isOverlay = false;
      this.inputDataRowName = F.DataRowsMarker.CLOSE;
      // Theme-adaptive: plotTheme.lines[0] is the only theme-aware preset
      // (white on dark, black on light). The previous hard-coded '#e6edf3'
      // was invisible on light theme. Bands stay hard-coded — red/green
      // are semantic and work on both themes.
      this.lineColor = this.plotTheme?.lines?.[0]?.strokeColor || '#e6edf3';
      this.lineWidth = 2;
      this.period = 14;
      this.addPlot(this.lineColor, 'CRSI');
      this.addPlot('#f85149', 'UB');
      this.addPlot('#3fb950', 'LB');
      this.addLine(this.levelsTheme?.line5?.strokeColor || '#666666', 50);
    }

    onInputTick() {
      const i = this.currentBar;
      const pick = (arr) => {
        const v = arr && arr[i];
        return Number.isFinite(v) ? v : NaN;
      };
      this.values.get('CRSI').set(pick(this._crsi));
      this.values.get('UB').set(pick(this._ub));
      this.values.get('LB').set(pick(this._lb));
    }
  }

  _classesCached = {
    CompositeCycle,
    CrsiIndicator,
    SingleCycleIndicator,
  };
  return _classesCached;
}
