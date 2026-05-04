// Custom FintaChart datafeed backed by an in-memory bar array supplied externally.
// We pre-fetch all bars via the cycle-tools-api REST layer (see api.js), then hand them
// to the chart through this datafeed. Simplest pattern for a non-streaming source.

export class CycleToolsDatafeed extends window.FintaChart.DatafeedBase {
  constructor() {
    super();
    this._bars = [];
  }

  setBars(bars) {
    this._bars = bars || [];
  }

  send(request) {
    super.send(request);
    // Complete asynchronously so onCompleteRequest fires AFTER the base class
    // has fully registered the request. We intentionally do NOT short-circuit on
    // !isBusy here — the chart's internal request bookkeeping flips in ways we
    // don't fully control, and dropping the response leaves the chart with 0 bars.
    Promise.resolve().then(() => {
      try { this.onCompleteRequest(request, this._bars); } catch (_) { /* noop */ }
    });
  }
}
