# Custom Indicators & Overlays in FintaChart

> Verified against `@fintatech/fintachart@3.1.2`. Authoritative reference: the new (in 3.1.2) `docs/api/custom-indicators.md` (458 lines) covers reserved private fields, registration patterns, parameter accessors, and lifecycle hooks. Authoritative working example: `node_modules/@fintatech/fintachart/custom-indicator.html`. Validated end-to-end in this project's `app/src/indicators.js`.

The cleanest way to plot a custom series on top of price (sine wave, regression line, custom oscillator, externally-computed signal) is to extend `FintaChart.Indicator` as an ES6 class and add it via `chart.addIndicators(new MyIndicator())`.

## Why use the indicator API instead of building a Plot manually

| | Custom Indicator | Manual Plot + DataRows |
|---|---|---|
| Aligns to bar timeline | automatic (per-bar `onInputTick`) | you must align by date manually |
| Survives instrument/timeframe change | yes (recomputes via `onInputTick`) | data rows must be cleared/repushed |
| Appears in indicators list / context menu | yes | no |
| Save/restore via chart state | yes | no |
| Public docs / examples | well-documented, working example shipped | sparse — `Plot` class docs are thin |

Use the **custom indicator** approach for anything that derives from price or maps to bars. Use **manual Plot + DataRows** only when you need a series that's completely decoupled from the price timeline.

## Custom indicator — minimum viable shape

```js
class MyIndicator extends FintaChart.Indicator {
  // Required: unique type identifier.
  static get type() { return 'MyIndicator'; }

  // 1. Default settings — display name, overlay vs separate pane, plots.
  onResetDefaults() {
    this.name = 'My Indicator';
    this.isOverlay = true;                                 // true = on price pane; false = new pane below
    this.inputDataRowName = FintaChart.DataRowsMarker.CLOSE; // bind to close as input
    this.addPlot('#3b82f6', 'Main');                       // creates a named output series
    // this.addPlot('#ef4444', 'Secondary');               // for multi-line indicators
    // this.addLine('#666666', 50);                        // optional level/threshold line
  }

  // 2. Per-instance state reset (called when bound to chart and on full reload).
  onInitializeIndicator() {
    this._myCounter = 0;
  }

  // 3. Per-bar calculation callback — fires once per loaded bar AND for each new bar.
  onInputTick() {
    const i = this.currentBar;          // built-in bar index, NO manual counter needed
    const close = this.input.get(0);    // current close price (input is the bound source)
    const value = computeSomething(close, i);
    this.values.get('Main').set(value); // write to the named plot
  }
}

// Add to a chart:
chart.addIndicators(new MyIndicator());
```

## Registration patterns — direct vs factory

The 3.1.2 `docs/api/custom-indicators.md` formalizes the two registration patterns. Pick based on whether you need state save/restore by string type-name.

**Pattern A — direct (most cases):**

```js
chart.addIndicators(new MyIndicator());
```

No factory call needed. Simplest path. Works for everything *except* round-tripping through `chart.saveState()` / `restoreState()` where the indicator is identified only by its `static get type()` string.

**Pattern B — register with `IndicatorFactory`:**

```js
FintaChart.IndicatorFactory.add(MyIndicator);   // once, at app startup
// ...later:
chart.addIndicators(new MyIndicator());          // OR: IndicatorFactory.create('MyIndicator', chart)
```

Required when:

1. **State save/restore.** `chart.saveState()` serializes indicators as `{ type: 'TypeName', ... }`. On `restoreState()` the chart calls `IndicatorFactory.restore(state)`, which looks up the type name in the factory's registry. **Without registration the indicator is silently dropped on restore.**
2. **Constructing by string name.** Calling `FintaChart.IndicatorFactory.create('MyIndicator', chart)` — useful when driving indicators from a saved-workspace JSON or a remote config.
3. **Surfacing in the built-in *Indicators* picker dialog.** The picker walks the factory registry to populate its list. Unregistered indicators don't appear.

> Rule of thumb: if your custom indicator is added imperatively each session and you don't need it in the built-in picker, Pattern A is enough. If you persist layouts, drive indicators by type name, or want users to discover the indicator from the toolbar, use Pattern B.

## Key API of the `Indicator` base class

| Member | Purpose |
|--------|---------|
| `this.name` | Display name (set in `onResetDefaults`) |
| `this.isOverlay` | `true` = price pane; `false` = own pane below |
| `this.inputDataRowName` | Which source row to read — usually `FintaChart.DataRowsMarker.CLOSE` |
| `this.input` | Source data row. `this.input.get(0)` = current bar's value |
| `this.input.get(N)` | Source value `N` bars back (`0` = current) |
| `this.firstTickOfBar` | `true` when this `onInputTick` call is the first tick of a *new* bar — use this guard before snapshotting prior values for live-tick consumers (intra-bar ticks would otherwise corrupt your "previous bar" reference) |
| `this.values.get(plotName).get(N)` | Read a previously emitted output value `N` bars back. Useful for indicators whose current output depends on the previous one. |
| `this.chart.dataContext.dataRows.get(rowName).get(N)` | Read directly from any data row (e.g. `'high'`, `'low'`, `'volume'`, custom rows) without changing `inputDataRowName`. Required when an indicator needs multiple inputs (e.g. an oscillator using both high and low on the current bar). |
| `this.period` | Convenience accessor backed by `IndicatorParam.PERIODS`. Set in `onResetDefaults` (`this.period = 14`); the user sees and edits it in the built-in settings dialog automatically. |
| `this.levelsTheme.line1` … `line5` | Preset theme-aware colors for `addLine(color, value)` levels. Use these instead of hard-coding so levels remain readable across theme switches. |
| `this.plotTheme.lines[0].strokeColor`, `.lines[1]`, … | Preset theme-aware colors for `addPlot`. Same rationale. |
| `this.currentBar` | Current bar index (0-based, automatic) |
| `this.values.get(name)` | Returns the named output row created by `addPlot(color, name)`. Call `.set(v)` inside `onInputTick` |
| `this.addPlot(color, name, plotStyle?)` | Create a named output series + its plot line. Optional 3rd arg is plot style (e.g. `FintaChart.HistogramPlot.Style.COLUMN`) |
| `this.addLine(color, value)` | Add a horizontal level line (e.g. RSI 70/30). **NOTE: it's `addLine`, not `addLevel`.** |
| `this.parameterValue(name)` | Read a parameter value |
| `this.updateParameter(name, value)` / `updateParameters({...})` | Programmatic change |

## Lifecycle hooks (override the ones you need)

| Hook | When |
|------|------|
| `onResetDefaults()` | Once, on construction — set `name`, `isOverlay`, `inputDataRowName`, `addPlot()` calls, `addLine()` calls. Also the right place for `this.allowSettingsDialog = false` (see below). |
| `onInitializeIndicator()` | Reset internal state (counters, EMAs, accumulators) — called when bound to chart and on full reload |
| `onInputTick()` | Once per bar (historical replay + each new bar) — main calculation |

A **full recalculation pass** (re-running `onInitializeIndicator` followed by one `onInputTick` per bar) is triggered by:

1. The indicator being added to a chart.
2. The source bars changing (new instrument, timeframe switch, datafeed refresh).
3. A parameter being updated via `updateParameter` / `updateParameters`.
4. The user invoking *Reset to defaults* in the settings dialog.

## Pane placement: docs vs. runtime (2026-05-06)

`chart.addIndicators(...)` decides pane placement based on `this.isOverlay`:
- `true` → primary (price) pane as overlay
- `false` → new pane below

The 3.1.2 `docs/api/custom-indicators.md` § *Which pane?* documents an explicit pane-placement API:

```js
chart.primaryPane.addIndicator(new MyIndicator());
const pane = chart.addPane();
pane.addIndicator(new MyOscillator());
```

**This API does not exist in the 3.1.2 runtime — verified empirically.** `chart.primaryPane` is a real Pane with `addComponent`, `addObjects`, `addPlot`, `addShapes`, but **no `addIndicator`**. Same for `chart.addPane()`-created panes. The doc is ahead of the runtime.

Use `chart.addIndicators(ind)` (which uses `isOverlay`) until the maintainers ship `Pane.addIndicator`. Combined with `isOverlay`'s immutability after construction, this means the two-class pattern (one `isOverlay = false`, one `isOverlay = true`) is currently the only way to support runtime overlay/pane toggle.

## Custom parameters (beyond `period`)

For tunable values beyond a simple period, declare parameters via the `addParameter` / `addParameters` family in `onResetDefaults`. Inside `onInitializeIndicator` or `onInputTick`, read with `this.parameterValue('NAME')` and write with `this.updateParameter('NAME', value)` (or batch via `updateParameters({ NAME: value, ... })`).

The full parameter-type reference is at `docs/api/indicator-params.md` — copy declarations from the built-in indicators (e.g. `SMA`, `BollingerBands`) for the right shape.

## Common pitfalls (from the official docs)

- **Don't allocate plots inside `onInputTick`.** `addPlot` is a one-time setup call; calling it per bar accumulates stale plots and the chart redraws all of them.
- **Don't forget `static get type()`.** `IndicatorFactory.add(MyIndicator)` reads `MyIndicator.type` to register the class. If the getter is missing or returns a duplicate of an existing type, the registration silently overwrites the previous one (or registers under `undefined`). State-restore depends on this string.
- **`onInitializeIndicator` runs before *every* recalc, not just once.** Stash anything that should survive recalcs in `onResetDefaults`. Per-pass state (running sums, EMA seeds) goes in `onInitializeIndicator`.

## ⚠️ Suppress the gear-icon settings dialog (still required in 3.1.2)

Clicking the gear in the legend of any custom indicator throws:

```
TypeError: Cannot read properties of null (reading 'appendChild')
  at FintaChart.min.js
```

The crash fires from inside the bundle's Style-tab rendering — the Parameters tab works, but the Style tab tries to append into a null root. Even with proper parameter accessors registered (e.g. `SOURCE`, `LINE_COLOR`, `LINE_WIDTH`, `PERIODS`), the Style tab still crashes.

**Workaround:** disable the dialog from `onResetDefaults`:

```js
onResetDefaults() {
  this.name = 'My Indicator';
  this.isOverlay = true;
  this.allowSettingsDialog = false;     // hides the gear icon entirely — no crash
  this.inputDataRowName = FintaChart.DataRowsMarker.CLOSE;
  this.addPlot('#3b82f6', 'Main');
}
```

You lose dialog-based configurability, but the parameter values still appear in the indicator's legend label (e.g. `Composite (Close, 1) -68.010`). For interactive parameter tweaking, render your own controls outside the chart and call `ind.updateParameters({ ... })` programmatically.

## ⚠️ `isOverlay` cannot be changed after construction (still in 3.1.2)

Setting `ind.isOverlay = false` after `new MyIndicator()` is reverted by the `addIndicators()` lifecycle. Workaround: **define two subclasses** — one with `isOverlay = true` in `onResetDefaults`, one with `isOverlay = false` — and instantiate the right class at add time:

```js
class MyIndicatorOverlay extends MyIndicatorBase {
  static get type() { return 'MyIndicatorOverlay'; }
  onResetDefaults() { super.onResetDefaults(); this.isOverlay = true;  }
}
class MyIndicatorPane extends MyIndicatorBase {
  static get type() { return 'MyIndicatorPane'; }
  onResetDefaults() { super.onResetDefaults(); this.isOverlay = false; }
}
```

The right-click context-menu's "Move pane top / bottom / Separate pane" items are also no-ops for custom indicators — provide your own UI (e.g. radio buttons that remove + re-add the indicator using the chosen subclass).

## ⚠️ Reserved private fields on the `Indicator` base class

The 3.1.2 `docs/api/custom-indicators.md` § *Reserved private fields* makes this contract explicit:

> The `Indicator` base class uses `_values`, `_plots`, `_parameters`, `_chart`, and a number of other single-underscore fields internally. **Do not assign to them from your subclass.** Direct writes appear to work but are clobbered by the next lifecycle pass — the symptom is "my indicator draws nothing" with no error.

| Don't | Do |
|-------|----|
| `this._values = newDataRows` | Use `this.values.get(name).set(value)` per bar inside `onInputTick` |
| `this._plots.push({ … })` | Call `this.addPlot(color, name)` from `onResetDefaults` |
| `this._parameters.set(...)` | Call `this.updateParameter(name, value)` / `updateParameters({...})` |
| `this._chart = ...` | Read-only — managed by `addIndicators` |

**For the "bring your own data" pattern, use any other prefix** — `_sineSeries`, `_externalCrsi`, `_payload`, `_series`, etc. Other underscore-prefixed names that don't collide with the reserved set work fine (`_crsi`, `_ub`, `_lb` are all safe).

Symptom of a collision: data appears to be stored on the instance, but every read returns `undefined`, the indicator silently draws nothing, and the value label shows `0.00`. No console error.

## "Bring your own data" pattern (precomputed series)

When your custom series comes from outside (e.g. a REST call to a cycle/regression/ML service), attach the precomputed array to the indicator instance and play it back per-bar:

```js
class PrecomputedSeries extends FintaChart.Indicator {
  static get type() { return 'Precomputed'; }
  onResetDefaults() {
    this.name = 'Precomputed';
    this.isOverlay = true;
    this.inputDataRowName = FintaChart.DataRowsMarker.CLOSE;
    this.addPlot('#3b82f6', 'V');
  }
  onInputTick() {
    const i = this.currentBar;
    const v = this._series && this._series[i];   // ← do NOT name this `_values`
    if (Number.isFinite(v)) this.values.get('V').set(v);
  }
}

const ind = new PrecomputedSeries();
ind._series = mySeriesArray;                     // length should match (or exceed) loaded bar count
chart.addIndicators(ind);
```

When the user changes timeframe or symbol, drop the indicator and re-add with a fresh array. The indicator's `onInputTick` will re-run from index 0.

## Multi-line indicator (e.g. CRSI with upper/lower bands)

```js
class CRSI extends FintaChart.Indicator {
  static get type() { return 'CustomCRSI'; }

  onResetDefaults() {
    this.name = 'Cyclic RSI';
    this.isOverlay = false;                                  // own pane
    this.inputDataRowName = FintaChart.DataRowsMarker.CLOSE;
    this.addPlot('#ffffff', 'CRSI');
    this.addPlot('#ef4444', 'UB');
    this.addPlot('#22c55e', 'LB');
    this.addLine('#666666', 50);                             // midline at 50
  }

  onInputTick() {
    const i = this.currentBar;
    const pick = (arr) => {
      const v = arr && arr[i];
      // Setting NaN tells the chart to skip this bar AND exclude it from auto-scale.
      // Without this, missing values default to 0 which pulls the y-axis to 0.
      return Number.isFinite(v) ? v : NaN;
    };
    this.values.get('CRSI').set(pick(this._crsi));
    this.values.get('UB').set(pick(this._ub));
    this.values.get('LB').set(pick(this._lb));
  }
}

const ind = new CRSI();
ind._crsi = crsiArr; ind._ub = ubArr; ind._lb = lbArr;
chart.addIndicators(ind);
```

## Server-computed parameter sync — making the settings dialog actually work

A trap that's easy to fall into with the "bring your own data" pattern: your indicator class declares a `period` (or any other) parameter, FintaChart's gear-icon settings dialog auto-renders an editable input for it, the user changes the value — **and nothing happens**. The plotted line stays the same because `onInputTick` reads from your pre-fetched array, not from a parameter-driven calculation.

The fix is two-sided:

### 1. Indicator side — override `onParameterUpdated` and forward to a host callback

The `Indicator` base class exposes `onParameterUpdated(changes: IIndicatorParameterChanges)` (d.ts:8757). It fires when any parameter is updated via `updateParameter` / `updateParameters` (which is what the settings-dialog inputs call). Override it, watch for the parameter you care about, and delegate to a host-supplied callback:

```js
class CRSI extends FintaChart.Indicator {
  static get type() { return 'CustomCRSI'; }
  // ... onResetDefaults, onInputTick as before ...

  onParameterUpdated(changes) {
    super.onParameterUpdated?.(changes);
    if (!changes) return;
    const periodChange = changes[FintaChart.IndicatorParam.PERIODS];
    if (!periodChange) return;
    const next = Number(periodChange.currentValue);
    if (!Number.isFinite(next)) return;
    if (typeof this._onPeriodChange === 'function') {
      try { this._onPeriodChange(next); }
      catch (e) { console.error('[param sync]', e); }
    }
  }
}
```

**`changes` shape** (from d.ts:`IIndicatorParameterChanges`):
```ts
{ [paramName: string]: { prevValue: any; currentValue: any } }
```
The key is the parameter's string name — e.g. `FintaChart.IndicatorParam.PERIODS === 'periods'` (lowercase, verified at runtime).

**Empirical 3.1.6 gotcha:** FintaChart writes the parameter value *before* invoking `onParameterUpdated`, so by the time you see `changes`, `prevValue` is usually equal to `currentValue` (the diff is computed against already-updated internal state). **Don't rely on `prevValue` for change detection** — just always forward to the callback if the parameter appears in the change set. Debounce on the host side instead.

### 2. Host side — debounce + refetch + force values-cache invalidation

After construction, attach a callback that does the actual refetch:

```js
const ind = new CRSI();
ind._crsi = initialCrsi; ind._ub = initialUb; ind._lb = initialLb;

let refetchTimer = null;
ind._onPeriodChange = (newPeriod) => {
  if (!Number.isFinite(newPeriod) || newPeriod < 5) return;
  if (refetchTimer) clearTimeout(refetchTimer);
  // 300 ms is enough to collapse the burst of `updateParameter` calls
  // FintaChart's dialog emits while the user is typing in a number input.
  refetchTimer = setTimeout(async () => {
    if (!chart.indicators.includes(ind)) return;   // dropped during the wait
    const r = await fetchSeriesFromServer(closes, newPeriod);
    if (!chart.indicators.includes(ind)) return;
    ind._crsi = r.crsi;
    ind._ub   = r.ub;
    ind._lb   = r.lb;
    // CRITICAL: refreshAsync(true) only redraws using cached values.
    // refreshIndicators() forces every indicator's onInputTick to re-run
    // against the freshly replaced arrays — without it the line stays
    // bound to the old values. See gotchas.md.
    chart.refreshIndicators();
    chart.refreshAsync(true);
  }, 300);
};

chart.addIndicators(ind);
```

### 3. Sync the *displayed* parameter to the *actual* computation value

If your initial fetch uses a derived value (e.g. half the dominant cycle, clamped) but `onResetDefaults` hardcodes `this.period = 14`, the dialog shows a value that doesn't match what's actually plotted. Symptom: indicator label reads `Cyclic RSI (Close, 14)` even though the data is from a length-50 fetch.

Pre-set the value via a static "next" field that `onResetDefaults` reads — same pattern as the `_nextLength` / `_nextColor` indirection in the SingleCycleIndicator. FintaChart re-runs `onResetDefaults` during `addIndicators()`, so any post-construction `ind.period = N` assignments get clobbered.

```js
class CRSI extends FintaChart.Indicator {
  static _nextPeriod = 14;
  onResetDefaults() {
    // ... other defaults ...
    this.period = CRSI._nextPeriod || 14;
  }
}

// Host:
CRSI._nextPeriod = Math.round(autoCrsiLength);
const ind = new CRSI();
chart.addIndicators(ind);
```

## Extending an indicator over lazy-loaded older bars

When the user scrolls left and the datafeed prepends N older bars via `requestMoreBars()` → `onCompleteRequest`, the indicator's data array needs to grow by N at the front to stay aligned with `currentBar`. Two options:

1. **NaN-pad** with leading NaN — easy, but the indicator line abruptly stops at the boundary of the originally-loaded data. Users see the cycle / RSI / whatever disappear over the older bars even though those bars are now visible.
2. **Extend with real values** — better UX, but the work depends on what kind of indicator it is.

### Pure-math indicators (sine waves, regression lines, anything parameterized)

Use an `offset` parameter in your value-generating function so it can compute at negative time indices (in the scan's original frame). Same parameters, just evaluated outside the original window.

```js
// Cycle reconstruction: composite[i] = Σ amp · sin(2π·((i-offset)-minBarNum)/length - π/2)
export function buildCompositeSeries(selectedCycles, totalBars, offset = 0) {
  const out = new Float64Array(totalBars);
  for (const c of selectedCycles) {
    for (let i = 0; i < totalBars; i++) {
      const t = i - offset;                     // index in scan's original frame
      const angle = (2 * Math.PI * (t - c.minBarNum)) / c.cycleLength - Math.PI / 2;
      out[i] += c.amplitude * Math.sin(angle);
    }
  }
  return out;
}

// On lazy-load completion:
const total = chart.barDataRows().close.length;
const intendedLen = analysisBars + projectionBars;
const frontPad = Math.max(0, total - intendedLen);
if (frontPad > 0) {
  ind._composite = buildCompositeSeries(selectedCycles, total, frontPad);
  chart.refreshIndicators();        // invalidate the values cache
}
```

No rescan, no network call — pure CPU. The sine waves keep going backward indefinitely.

### Server-computed indicators (CRSI, ML signals, anything causal)

For causal indicators (each output bar depends only on prior input bars), re-fetch with the **full extended history**. Values at the original-window positions are mathematically unchanged because the same prior context is available; only the older bars get newly computed values.

```js
// On lazy-load completion (this runs alongside the sine-extension above):
const rows = chart.barDataRows();
const histLen = rows.close.length - projectionBars;
const extendedCloses = new Array(histLen);
for (let i = 0; i < histLen; i++) extendedCloses[i] = rows.close.value(i);

// Version guard: if a period change or another lazy-load races with this
// refetch, the later request's response wins.
const version = ++crsiFetchVersion.current;
const r = await fetchSeriesFromServer(extendedCloses, ind.period);
if (version !== crsiFetchVersion.current) return;
if (!chart.indicators.includes(ind)) return;

ind._crsi = padTrailingNaN(r.crsi, projectionBars);
ind._ub   = padTrailingNaN(r.ub,   projectionBars);
ind._lb   = padTrailingNaN(r.lb,   projectionBars);
chart.refreshIndicators();
chart.refreshAsync(true);
```

**Refresh ordering** — the synchronous composite/single-cycle update can refresh immediately so the user sees cycles extend without waiting for the network. The async CRSI refetch refreshes again when it lands. Use a version counter to discard stale CRSI responses if the user keeps scrolling or changes the period mid-flight.

## Forward projection of a cycle (sine wave into the future)

To draw a cycle/regression/forecast past the last real bar, append placeholder bars with `NaN` close and extend your precomputed series accordingly. The price line stops naturally at the boundary; your indicator continues drawing.

```js
// 1. Build the series for ALL bars (real + future).
const FUTURE_BARS = 300;
const sine = buildSineSeries(cycleParams, bars.length, closes, FUTURE_BARS);
//   sine.length === bars.length + FUTURE_BARS

// 2. Generate placeholder business-day bars (skip Sat/Sun for daily).
function generateFutureBars(lastDate, count) {
  const out = [];
  const d = new Date(lastDate);
  for (let i = 0; i < count; i += 1) {
    do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    out.push({ date: new Date(d), open: NaN, high: NaN, low: NaN, close: NaN, volume: 0 });
  }
  return out;
}

// 3. Append both real bars and placeholder future bars to the chart.
chart.appendBars(realBars);
chart.appendBars(generateFutureBars(realBars[realBars.length - 1].date, FUTURE_BARS));
const total = realBars.length + FUTURE_BARS;
chart.recordRange(realBars.length - 200, total - 1);    // show last 200 historical + all 300 projected
chart.refreshAsync(true);

// 4. Add the indicator with the extended series; it draws across both real and future bars.
const sineInd = new MyCycleSineIndicator();
sineInd._sineSeries = sine;     // length matches the chart's total bar count
chart.addIndicators(sineInd);
```

The price line draws only for bars where `close` is finite. The custom indicator draws for every bar with a finite `_series[i]` value, so the sine wave continues smoothly into the projection window.

## Removing / refreshing indicators on data reload

```js
// Drop existing custom indicators that depend on the symbol.
const stale = chart.indicators.filter(i => {
  const t = i?.constructor?.type;
  return t === 'CustomCRSI' || t === 'MyCycleSine';
});
if (stale.length > 0) chart.removeIndicators(stale);

// Rebuild and re-add with fresh data.
const fresh = new CRSI();
fresh._crsi = newCrsi; fresh._ub = newUb; fresh._lb = newLb;
chart.addIndicators(fresh);
```

## Built-in indicators

```js
// Direct construction (most have a class form):
const sma = new FintaChart.SMAIndicator();
sma.updateParameters({ period: 20 });
chart.addIndicators(sma);

// Or via factory by type name:
const ema = FintaChart.IndicatorFactory.create('EMA', chart);
ema.updateParameters({ period: 50 });
chart.addIndicators(ema);
```

Full list of 95 built-in types and their parameters:
https://raw.githubusercontent.com/fintatech/fintachart/master/docs/api/indicator-params.md
