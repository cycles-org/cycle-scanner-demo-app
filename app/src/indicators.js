// Custom FintaChart indicators that play back precomputed series:
//   - CompositeCyclePane:    sum-of-sines around 0, in its own pane (isOverlay = false)
//   - CompositeCycleOverlay: same, but mapped onto the price pane (isOverlay = true)
//   - SingleCycleIndicator:  one sine wave for an individually-paned cycle
//   - CrsiIndicator:         CRSI line + dynamic upper/lower bands, in its own pane
//
// Every class declares standard FintaChart parameters via direct class accessors
// (`get / set` paired with `parameterValue` / `updateParameter`). Without at least
// one declared parameter, FintaChart's gear-icon settings dialog crashes with
// `Cannot read properties of null (reading 'appendChild')` while building rows.
//
// Class-level accessors (NOT Object.defineProperties on a prototype after
// construction) are required — that's the pattern the shipped custom-indicator.html
// example uses, and it's the only way the parameter system actually picks them up.

const FC = () => window.FintaChart;

let _classesCached = null;

export function getIndicatorClasses() {
  if (_classesCached) return _classesCached;
  const F = FC();
  const P = F.IndicatorParam;

  // ─── CompositeCyclePane (isOverlay = false) ───────────────────────────────
  class CompositeCyclePane extends F.Indicator {
    static get type() { return 'CompositeCyclePane'; }

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
      this.isOverlay = false;
      this.inputDataRowName = F.DataRowsMarker.CLOSE;
      this.lineColor = '#ec4899';
      this.lineWidth = 2;
      this.period = 1;
      // Suppress the gear-icon settings dialog: FintaChart's dialog template
      // references plot-style controls that crash for our precomputed-series
      // indicators (`appendChild(null)` from inside the bundle). Until that's
      // fixed upstream, we expose the params via the indicator legend label
      // only — color/width/period still show as e.g. "Composite (Close, 1)".
      this.allowSettingsDialog = false;
      this.addPlot(this.lineColor, 'Composite');
    }

    onInputTick() {
      const i = this.currentBar;
      const v = this._composite && this._composite[i];
      this.values.get('Composite').set(Number.isFinite(v) ? v : NaN);
    }
  }

  // ─── CompositeCycleOverlay (isOverlay = true) ─────────────────────────────
  class CompositeCycleOverlay extends F.Indicator {
    static get type() { return 'CompositeCycleOverlay'; }

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
      this.isOverlay = true;
      this.inputDataRowName = F.DataRowsMarker.CLOSE;
      this.lineColor = '#ec4899';
      this.lineWidth = 2;
      this.period = 1;
      // Suppress the gear-icon settings dialog: FintaChart's dialog template
      // references plot-style controls that crash for our precomputed-series
      // indicators (`appendChild(null)` from inside the bundle). Until that's
      // fixed upstream, we expose the params via the indicator legend label
      // only — color/width/period still show as e.g. "Composite (Close, 1)".
      this.allowSettingsDialog = false;
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
      this.allowSettingsDialog = false;
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
      this.lineColor = '#e6edf3';
      this.lineWidth = 2;
      this.period = 14;
      this.allowSettingsDialog = false;
      this.addPlot(this.lineColor, 'CRSI');
      this.addPlot('#f85149', 'UB');
      this.addPlot('#3fb950', 'LB');
      this.addLine('#666666', 50);
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

  const COMPOSITE_TYPES = new Set(['CompositeCyclePane', 'CompositeCycleOverlay']);

  _classesCached = {
    CompositeCyclePane,
    CompositeCycleOverlay,
    CrsiIndicator,
    SingleCycleIndicator,
    COMPOSITE_TYPES,
  };
  return _classesCached;
}
