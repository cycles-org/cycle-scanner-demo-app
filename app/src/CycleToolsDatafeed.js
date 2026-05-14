// Custom FintaChart datafeed with two roles:
//
// 1) **Initial load** — App.jsx pre-fetches the cycle-analysis window (the
//    configured lookback, e.g. 850 bars) via REST, then hands them to the
//    datafeed via `setBars`. FintaChart's first `send(request)` call with
//    `kind: 'bars'` returns those bars synchronously.
//
// 2) **Lazy load** — when the user scrolls left past the loaded range,
//    FintaChart calls `chart.requestMoreBars()` which fires `send(request)`
//    with `kind: 'moreBars'` and an `endDate` (the date of the oldest bar
//    currently on the chart). We fetch a fresh batch of older bars from
//    cycle-tools-api `GetDatasetSeries` using `to=endDate`, hand them back
//    via `onCompleteRequest`, and fire `onLazyLoaded(addedCount)` so App.jsx
//    can pad the composite/cycle indicator data arrays with NaN at the front
//    (keeps positional alignment to the latest bars).
//
// Per skills/fintachart/references/datafeed-contract.md §1868-1881, the
// request object carries `kind: RequestKind ('bars' | 'moreBars')`, `count`,
// and optional `endDate`.

import { loadOlderBars } from './api.js';

const RequestKind = {
  BARS:      'bars',
  MORE_BARS: 'moreBars',
};

export class CycleToolsDatafeed extends window.FintaChart.DatafeedBase {
  constructor() {
    super();
    this._bars = [];                // Initial-load bars (pushed via setBars).
    this._symbolId = null;          // For lazy-load API calls.
    this._apiKey = null;
    this._batchSize = 500;          // Per-lazy-load fetch size; settable.
    this._onLazyLoaded = null;      // (addedCount) => void
    this._lazyInFlight = false;     // Drop overlapping moreBars requests.
    this._oldestLoadedDate = null;  // Tracked for de-dupe against late callbacks.
  }

  // Set by the pipeline after each successful initial load. Hands the
  // datafeed the API credentials + which symbol to page back through, and
  // resets in-flight state for the new instrument.
  setContext({ symbolId, apiKey, batchSize, onLazyLoaded }) {
    this._symbolId = symbolId ?? this._symbolId;
    this._apiKey   = apiKey   ?? this._apiKey;
    if (typeof batchSize === 'number' && batchSize > 0) this._batchSize = batchSize;
    if (typeof onLazyLoaded === 'function') this._onLazyLoaded = onLazyLoaded;
  }

  setBars(bars) {
    this._bars = bars || [];
    this._oldestLoadedDate = this._bars.length > 0 ? this._bars[0].date : null;
    this._lazyInFlight = false;
  }

  send(request) {
    super.send(request);

    const kind = request?.kind;

    if (kind === RequestKind.MORE_BARS) {
      this._handleMoreBars(request);
      return;
    }

    // Initial load (or any non-lazy path): complete asynchronously so the
    // base class has fully registered the request first.
    Promise.resolve().then(() => {
      try { this.onCompleteRequest(request, this._bars); } catch (_) { /* noop */ }
    });
  }

  _handleMoreBars(request) {
    // Drop if we don't have enough context to fetch — chart will just stop
    // asking once it sees an empty response.
    if (!this._symbolId || !this._apiKey) {
      Promise.resolve().then(() => {
        try { this.onCompleteRequest(request, []); } catch (_) {}
      });
      return;
    }

    // Drop overlapping requests — the chart can spam these on a fast scroll.
    if (this._lazyInFlight) {
      Promise.resolve().then(() => {
        try { this.onCompleteRequest(request, []); } catch (_) {}
      });
      return;
    }

    // FintaChart's `endDate` on IBarsRequest is the cutoff: "give me bars
    // whose date is <= endDate". We trust it as the boundary; fall back to
    // the oldest bar we know about if the field is missing.
    const cutoff = request.endDate instanceof Date
      ? request.endDate
      : this._oldestLoadedDate;
    if (!cutoff) {
      Promise.resolve().then(() => {
        try { this.onCompleteRequest(request, []); } catch (_) {}
      });
      return;
    }

    this._lazyInFlight = true;
    (async () => {
      try {
        const older = await loadOlderBars(
          this._symbolId,
          this._apiKey,
          cutoff,
          this._batchSize,
        );

        // Defensive de-dupe: if the server returned bars at or after the
        // cutoff (e.g. inclusive boundary), drop those.
        const filtered = (older ?? []).filter((b) => b.date < cutoff);

        if (filtered.length > 0) {
          this._oldestLoadedDate = filtered[0].date;
        }

        try { this.onCompleteRequest(request, filtered); } catch (_) {}

        // Tell App.jsx so it can pad indicator data arrays at the front
        // (positional alignment to the most-recent bars is preserved).
        if (this._onLazyLoaded && filtered.length > 0) {
          try { this._onLazyLoaded(filtered.length); } catch (_) {}
        }
      } catch (e) {
        console.error('[CycleToolsDatafeed lazy-load]', e);
        try { this.onCompleteRequest(request, []); } catch (_) {}
      } finally {
        this._lazyInFlight = false;
      }
    })();
  }
}
