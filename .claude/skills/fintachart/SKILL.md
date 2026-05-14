---
name: fintachart
description: >
  Build interactive financial charts with the FintaChart library (`@fintatech/fintachart`).
  Use this skill whenever the user asks to render OHLC/candlestick charts, plot price series,
  add custom indicators or overlays (sine waves, regression bands, custom oscillators), wire
  a custom datafeed, build multi-pane chart layouts, change symbol/timeframe at runtime,
  append real-time bars, or visualize anything backed by a bar/tick data source in a browser.
  Trigger on phrases like "render a chart", "plot OHLC", "candlestick chart", "build a
  financial chart", "custom indicator", "overlay on price", "datafeed", "FintaChart",
  "@fintatech/fintachart", "candle chart", "real-time chart", "multi-pane chart",
  "chart overlay", "plot a sine wave on price", or any browser-based financial-chart task.
  License note: free for local development only — deployed/network-accessible use requires
  a commercial license from Fintatech.
---

# FintaChart — Charting Library

**Package:** `@fintatech/fintachart` (npm) · **Version covered:** **3.1.6** (latest as of 2026-05-13) · **License:** proprietary, free for local dev only · **Repo:** https://github.com/fintatech/fintachart

Browser-only canvas charting library for financial data. Single global namespace `FintaChart.*`.

> **About v3.1.2 (released 2026-05-04).** Several gaps in 3.1.0 / 3.1.1 between the documented API and the runtime were closed:
> - **`new FintaChart.Chart(config)` now works** — the `Chart` class is exposed on the global. The `createChart(container, config)` factory still works for backward compatibility, but the constructor form is canonical and matches the README quickstart.
> - **`FintaChart.Themes` namespace** exposes all 11 built-in themes by key (`default`, `light`, `dark`, `fintatechDark`, `beet`, `gray`, `olive`, `orange`, `purple`, `sky`, `teal`) — use this instead of relying on script-tag globals.
> - **`FintaChart.ThemeUtils.deepMerge(target, source)`** for deriving custom themes.
> - **`chart.appendBars(bars)` auto-establishes a visible range + calls `refreshAsync(true)`** when called on a chart with no visible range set. (You can still call `recordRange` explicitly if you want a non-default window.)
> - **`ChartTypeNames.LINE` (`'line'`) and `ChartTypeNames.AREA` (`'area'`)** added (previously missing).
> - **New docs at `docs/api/custom-indicators.md`** (458 lines) covering reserved private fields (`_values`, `_plots`, `_parameters`, `_chart`), the two registration patterns (direct vs `IndicatorFactory.add`), parameter accessors, and lifecycle hooks.
> - **New docs at `docs/api/data-adapters.md` § "Switching instruments at runtime"** documenting the `id`-based equality contract + `chart.sendBarsRequest()` requirement after `chart.instrument = ...`.
>
> A handful of items remain runtime gotchas as of 3.1.2 — see `references/gotchas.md` § *Open in 3.1.2*. Most relevant: `chart.chartType = 'string'` still throws (use `applyChartType`), bundled CSS still leaks into host-page `[type="checkbox"]`, and the gear-icon settings dialog still crashes on custom indicators.
>
> **About v3.1.3 (released 2026-05-06).** Effectively a no-op for our gotcha list. Only observable change: `pane.indicators` is now a public read-only array (handy for cleanup logic).
>
> **About v3.1.4 (released 2026-05-08).** Three of our outstanding items addressed:
> - **Symbol search** (was our open #10). The actual integration is via overriding three static methods, NOT the `searchInstruments` config callback we tried in 3.1.1 (which was a no-op stub). New example at `examples/html/15-instrument-search/`. Working pattern:
>   ```js
>   FintaChart.Instrument.filter = (q, exchanges, page, size) => {/* return Promise<IInstrument[]>, page is 1-based */};
>   FintaChart.Instrument.filterById = (id) => {/* return Promise<IInstrument> */};
>   chart.exchanges = () => ['FOREX', 'NASDAQ', 'CRYPTO'];
>   ```
>   See `references/datafeed-contract.md` § *Built-in toolbar search modal*.
> - **Context-menu pane-move for custom indicators** (was open #9). Right-click → "Move pane top / bottom / Separate pane top / bottom" now works for indicators that store precomputed series via instance properties. Verified at API level: localization keys `mergeUp`/`mergeDown`/`unmergeUp`/`unmergeDown` and the `chart.movePane(pane, offset)` method are wired through. Manual UI verification recommended before removing any consumer-side workarounds.
> - **Bar Replay hint** (was open #26). When the user clicks Play / Forward / To-Real-Time before picking a bar, FintaChart now shows the localized prompt `"Click a bar to set the replay start point"`. Implemented via a new `promptForStartRecord()` method on the replay manager. Verified at source level (`localization/en.json:798` + `d.ts:5695`).
>
> **Still open in 3.1.4** (8 items): #3 (`chartType` setter throws), #4 (`chart.instrument =` doesn't auto-flush), #6 (`_values` clobbers), #7 (CSS leaks), #8 (`isOverlay` immutable + the `pane.addIndicator` doc-runtime mismatch we caught), #11 (per-indicator refresh), #12 (no `VerticalScale` plot binding), #13 (multi-indicator perf), #23 (no auto-resize), #24 (settings dialog crash), #25 (`PointPlot.Style.DOT` no-op).
>
> **About v3.1.5 (released 2026-05-12) + v3.1.6 (released 2026-05-13).** Major release — seven more open items closed at runtime:
> - **#12** — `Indicator.bindToVerticalScale(scale)` shipped. Overlay indicators get their own auto-scaled y-axis on the price pane. New example at `examples/html/17-overlay-indicator-with-own-axis/`. Replaces all the value-remap fakery in our pre-3.1.5 workaround.
> - **#8** — `Pane.addIndicator(ind)` finally exists (the API our 2026-05-06 spike found missing). Explicit pane choice overrides `isOverlay`. Plus `chart.addIndicatorInNewPane()` helper documented (but see gotchas below — buggy).
> - **#7** — Bundled `[type="checkbox"]` CSS rules scoped to `.tcdComponentsContainer`/`.tcdDialog`/`.tcdRootContainer`. No more host-page leak. `!important` overrides no longer needed.
> - **#24** — Settings-dialog crash (`appendChild(null)` in Style-tab rendering) resolved. `this.allowSettingsDialog = false` workaround no longer required.
> - **#23** — Bundle now contains its own internal `ResizeObserver` (verified by grep: `new ResizeObserver(` in `scripts/FintaChart.min.js`). Drag-to-resize panel containers, window resizes within a flex layout, etc. all just work without consumer-side wiring.
> - **#9** — Re-verified 2026-05-13: the greyed-out state we initially flagged was correct UX, not a bug. The four pane-move menu items enable when there's a destination pane to move into/out of. With multiple custom-indicator panes visible, "Move pane top / bottom / Separate pane top / bottom" all work as expected.
> - **Fullscreen** — new toolbar buttons "Full Window" and "Full Screen".
>
> **Plus the toolbar search modal (3.1.4 #10) is now usable** — with caveats. See `references/datafeed-contract.md` § *Built-in toolbar search modal* for the 4-gotcha pattern (install BEFORE `new FC.Chart()`, augment symbol with company text for the modal's substring filter, etc.).
>
> **Still open in 3.1.6:** #3 (`chartType` setter throws — docs-only fix), #4 (`chart.instrument =` doesn't auto-flush — docs-only fix), #6 (`_values` clobbers — docs-only fix), #11 (per-indicator refresh), #13 (multi-indicator perf), #25 (`PointPlot.Style.DOT` no-op).
>
> **New gotchas in 3.1.5/3.1.6** (see `references/gotchas.md`):
> - (a) `chart.addIndicatorInNewPane(ind)` crashes inside `initPaneTitle` with `appendChild(null)` — use `chart.addIndicators(ind)` with `isOverlay = false` instead.
> - (b) Toolbar-search modal: install `Instrument.filter`/`filterById` BEFORE `new FC.Chart()` (the modal can bind references inside the constructor).
> - (c) Toolbar-search modal: internal filter matches `symbol` substring only, not `company` — augment `symbol` with company text in `filter()` return, return clean from `filterById()`.
> - (d) `INSTRUMENT_CHANGED` event payload shape varies across 3.1.x — read `chart.instrument` directly in the listener, not `event.value`.
> - (e) `chart.exchanges()` strings must match `result.exchange` from your `filter()` return, or use `[]` (no tabs).
> - `Indicator.needsCustomScale() { return true }` declarative protocol auto-creates the custom scale but defaults `leftAxisVisible: false` — explicit `chart.addVerticalScale() + ind.bindToVerticalScale(scale)` is clearer.
> - The built-in pane-merge menu cannot target the price pane — consumer-side toggle UI is the current pattern for "Move to price overlay".

## Where to look

| Task | Reference |
|------|-----------|
| Bootstrap, IChartConfig, methods, events, chart types | `references/chart-api.md` |
| Custom datafeed (REST, WebSocket, in-memory) | `references/datafeed-contract.md` |
| Custom indicators / overlays / projections | `references/custom-indicators.md` |
| Quirks, runtime-vs-docs gaps, common errors | `references/gotchas.md` |

## Install & bootstrap (HTML)

```bash
npm install @fintatech/fintachart
```

```html
<!-- CSS — ORDER MATTERS: externals first, main stylesheet last -->
<link rel="stylesheet" href="node_modules/@fintatech/fintachart/css/external/spectrum.min.css">
<link rel="stylesheet" href="node_modules/@fintatech/fintachart/css/external/toastr.min.css">
<link rel="stylesheet" href="node_modules/@fintatech/fintachart/css/external/jqNumericField.min.css">
<link rel="stylesheet" href="node_modules/@fintatech/fintachart/css/FintaChart.min.css">

<!-- Frameworks (ALL of these are runtime-required, not optional) -->
<script src="node_modules/@fintatech/fintachart/scripts/frameworks/Intl.min.js"></script>
<script src="node_modules/@fintatech/fintachart/scripts/frameworks/moment.min.js"></script>
<script src="node_modules/@fintatech/fintachart/scripts/frameworks/detectizr.min.js"></script>
<script src="node_modules/@fintatech/fintachart/scripts/frameworks/dom-to-image-more.min.js"></script>
<script src="node_modules/@fintatech/fintachart/scripts/frameworks/i18nextXHRBackend.min.js"></script>

<!-- Main bundle. Themes are accessible via FintaChart.Themes.<name> in 3.1.2+ —
     individual theme script-tags are no longer required unless you support older bundles. -->
<script src="node_modules/@fintatech/fintachart/scripts/FintaChart.min.js"></script>
```

```js
// REQUIRED before constructing any chart:
FintaChart.ResourcePath.localization = './node_modules/@fintatech/fintachart/localization/';
FintaChart.ResourcePath.htmlDialogs  = './node_modules/@fintatech/fintachart/htmldialogs/';
FintaChart.SvgLoader.path            = './node_modules/@fintatech/fintachart/img/svg-icons/';

// Canonical pattern in 3.1.2+: `new FintaChart.Chart({ container, ...config })`.
// The `createChart(container, config)` factory still exists for backward compat.
const chart = new FintaChart.Chart({
  container: document.getElementById('chart'),    // HTMLElement OR a CSS selector string
  datafeed: myDatafeed,
  instrument: { symbol: 'BTCUSDT', exchange: 'CRYPTO', tickSize: 0.01 },
  timeFrame: { interval: 1, periodicity: FintaChart.Periodicity.HOUR },
  chartType: 'candle',
  theme: FintaChart.Themes.fintatechDark,         // 3.1.2 namespace — no script-tag global needed
  showToolbar: true, showScrollbar: true, barsCount: 500,
});

// Cleanup on unmount/page-leave:
chart.dispose();
```

## Mental model

```
Chart                              top-level lifecycle owner
 └── PanesContainer
      └── Pane (>=1)               drawing area; primary pane shows price
           └── Plot                visual series (Line, Histogram, Bar, ...)
                └── DataRows       typed-array column (date/open/high/low/close/volume/custom)

Datafeed → DataAdapter → DataContext (DataRows...) → Pane → Plot → Canvas
```

- **One chart, one datafeed.** Built-in classes: `FileDatafeed`, `RestDatafeed`, `WebsocketDatafeed`. Subclass `FintaChart.DatafeedBase` for anything custom.
- **Resource paths must be set BEFORE `createChart`.** Forgetting any of the three breaks dialogs/icons silently — no thrown error.
- **For in-memory data** (you've already fetched all bars), the chart often won't re-issue a `send()` after you change `chart.instrument`. Push bars directly via `chart.appendBars(bars)`. See `references/datafeed-contract.md` § *In-memory bypass pattern*.
- **Custom indicators / overlays:** ES6 `class extends FintaChart.Indicator`, with `onResetDefaults` / `onInitializeIndicator` / `onInputTick` hooks. Detail in `references/custom-indicators.md`.

## IBar — the canonical bar shape

```ts
{ date: Date, open: number, high: number, low: number, close: number, volume: number }
```

For close-only series, set `open = high = low = close` and use `chartType: 'line'` — `'candle'` draws nothing when O=H=L=C on every bar. Use `isCloseOnly(bars)` to detect.

## Periodicity

Always use the enum constants — `FintaChart.Periodicity.{TICK, SECOND, MINUTE, HOUR, DAY, WEEK, MONTH, YEAR}`.

The string values are: `'t'`, `'s'`, `''` (minute is **empty string**), `'h'`, `'d'`, `'w'`, `'m'` (month, NOT minute), `'y'`.

`timeFrame: { interval: number, periodicity: <enum or string> }`. E.g. `{ 5, FintaChart.Periodicity.MINUTE }` = 5 min, `{ 1, FintaChart.Periodicity.HOUR }` = 1h.

`supportedTimeFrames` toolbar strings use space format: `'1 Minutes'`, `'5 Minutes'`, `'1 Hour'`, `'4 Hours'`, `'1 Day'`, `'1 Week'`, `'1 Month'`.

## Standard pipeline

```
1. Set ResourcePath.{localization, htmlDialogs} + SvgLoader.path
2. Build a datafeed (extend FintaChart.DatafeedBase, override send(request))
3. const chart = FintaChart.createChart(containerEl, { ...config })
4. Listen for events:        chart.on(FintaChart.ChartEvent.INSTRUMENT_CHANGED, fn)
5. Add custom indicators:    chart.addIndicators(new MyIndicator())
6. Stream / push updates:    chart.appendBars(newBars)  + chart.refreshAsync()
7. Switch chart type:        chart.applyChartType('line')   ← NOT chart.chartType = 'line'
8. On teardown:              chart.dispose()
```

## Built-in capabilities

- **Many chart types** (`'candle'`, `'hollowCandle'`, `'ohlc'`, `'heikinAshi'`, `'renko'`, `'rangeBar'`, `'lineBreak'`, `'pointAndFigure'`, `'kagi'`, `'line'`, `'mountain'`, `'stepLine'`, ...)
- **Built-in indicators** via `FintaChart.IndicatorFactory.create(name, chart)` or `new FintaChart.<Name>Indicator()` — `SMA`, `EMA`, `RSI`, `MACD`, `Bollinger`, `Ichimoku`, `VWAP`, `PatternsIndicator`, `ZigZagIndicator`, etc. Per-indicator parameter table at https://raw.githubusercontent.com/fintatech/fintachart/master/docs/api/indicator-params.md
- **Drawing shapes**: `chart.startShape(new FintaChart.LineSegmentShape())` (Fibonacci, trend lines, channels, Andrews pitchfork, Gann fan, free-hand, text, etc.)
- **Themes** (loaded as global vars): `defaultTheme`, `darkTheme`, `fintatechDarkTheme`, `beetTheme`, `grayTheme`, `oliveTheme`, `orangeTheme`, `purpleTheme`, `skyTheme`, `tealTheme`
- **Multi-chart layout**: `new FintaChart.ChartsContainer({ container, layout: { rows, columns } })`
- **State save/restore**: `chart.saveState()` / `chart.restoreState(state)` (auto-persists when `autoSave: true`)
- **CSV export** (`chart.exportChartData()`) and image save (`chart.saveImage()`)

## Runtime mutations (after construction)

```js
chart.instrument = { symbol: 'ETHUSDT', exchange: 'CRYPTO', tickSize: 0.01 };  // INSTRUMENT_CHANGED
chart.timeFrame = { interval: 1, periodicity: FintaChart.Periodicity.DAY };     // TIME_FRAME_CHANGED

// Chart type — MUST use applyChartType(name). Assigning chart.chartType = 'line' crashes
// with "Cannot create property 'chart' on string" because the setter expects an instance.
chart.applyChartType('line');                                                  // CHART_TYPE_CHANGED

chart.theme = fintatechDarkTheme;                                              // THEME_CHANGED

chart.appendBars([{ date, open, high, low, close, volume }]);                  // append closed bar
const rows = chart.barDataRows();
rows.close.updateLast(newClose);                                               // update live bar
chart.refreshAsync();
```

After `appendBars()`, you must set the visible range to actually see the data:

```js
const showLast = Math.min(500, bars.length);
chart.recordRange(bars.length - showLast, bars.length - 1);
chart.refreshAsync(true);
```

## Listening to events

```js
chart.on(FintaChart.ChartEvent.INSTRUMENT_CHANGED, (e) => console.log(e.value));
chart.on(FintaChart.ChartEvent.TIME_FRAME_CHANGED, (e) => console.log(e.value));
chart.on(FintaChart.ChartEvent.BARS_APPENDED,      (e) => {});
chart.on(FintaChart.ChartEvent.LAST_BAR_UPDATED,   (e) => {});
```

50+ chart events available — full enumeration in `references/chart-api.md`.

## Critical gotchas (read before debugging)

1. **License:** free only for local development. Any deployed app needs a commercial license from Fintatech.
2. **Resource paths must be set BEFORE constructing the chart** (`ResourcePath.localization`, `ResourcePath.htmlDialogs`, `SvgLoader.path`). Missing paths break dialogs/icons silently — no thrown error.
3. **`detectizr.min.js` and `dom-to-image-more.min.js` are required runtime deps** — not optional. Missing them and the chart fails to construct.
4. **`Periodicity.MINUTE` is the empty string `''`** — not `'m'` (which is **month**).
5. **`chart.chartType = 'line'` still crashes in 3.1.2.** Use `chart.applyChartType('line')`. The setter expects a chart-type instance, not a string. Docs were updated but runtime still throws.
6. **In-memory datafeeds:** the chart doesn't auto re-issue `send()` on `chart.instrument = ...`. The 3.1.2 docs spell out the contract: every `IInstrument` needs a unique `id`; assigning the new instrument fires `INSTRUMENT_CHANGED` but does NOT call `datafeed.send(...)` — you must call `chart.sendBarsRequest()` to flush. Or bypass the datafeed entirely by calling `chart.appendBars(bars)` directly. See `references/datafeed-contract.md`.
7. **`appendBars()` auto-establishes a visible range in 3.1.2+** when none was set. If you want a specific window (e.g. last 200 historical + projection), still call `chart.recordRange(start, end)` + `refreshAsync(true)` explicitly afterward.
8. **Don't use `_values` as a property name on indicator instances** — it's an internal field on the `Indicator` base class and your assignment gets clobbered. Other reserved internals: `_plots`, `_parameters`, `_chart`. New 3.1.2 docs at `docs/api/custom-indicators.md` § *Reserved private fields* call this out.
9. **`addLine(color, value)`** for level/threshold lines on indicators (not `addLevel(...)`).
10. **CSS load order matters** — externals first, `FintaChart.min.css` last. Wrong order breaks color picker / toast / numeric input.
11. **Bundled CSS still leaks into host-page `[type="checkbox"]`** as of 3.1.2 (`opacity: 0; z-index: -1; position: absolute`). If you render your own checkboxes outside the chart, you'll need `!important` overrides or an `appearance: none` custom-style block to defeat them.
12. **3.1.1 dropped jQuery + jquery-ui + bootstrap-select** — old integration guides referencing them are stale.
13. **FintaChart UI uses high z-indexes.** Custom overlays (e.g. a search dropdown) need `z-index: 100000+` to stay clickable above the chart's toolbars.
14. **Indicator settings dialog (gear icon) still crashes for custom indicators** as of 3.1.2 — `Cannot read properties of null (reading 'appendChild')` from inside the bundle's Style-tab rendering. Workaround: set `this.allowSettingsDialog = false` in `onResetDefaults()` to remove the gear icon.
15. **Chart does NOT auto-resize with its container** — you must wire a `ResizeObserver` and call `chart.refreshSize()` + `refreshLayout()` + `refreshAsync()` on resize.

Full quirks list in `references/gotchas.md`.

## Repo references (re-fetch when needed)

| What you need | Where |
|---------------|-------|
| Authoritative TypeScript types | `node_modules/@fintatech/fintachart/d.ts/FintaChart.d.ts` (24k lines) |
| Custom indicator working example | `node_modules/@fintatech/fintachart/custom-indicator.html` |
| Multi-chart example | `node_modules/@fintatech/fintachart/multiple-charts.html` |
| Basic objects example | `node_modules/@fintatech/fintachart/basic-objects.html` |
| Index dark example | `node_modules/@fintatech/fintachart/index-dark.html` |
| Online docs (TypeScript view, can disagree with runtime) | https://github.com/fintatech/fintachart/tree/master/docs |
| Vite+React+TS starter | https://github.com/fintatech/fintachart/tree/master/examples/react-app |

## Reference test app

A complete working integration lives in this project at `app/` — a Vite+React app that uses FintaChart as the renderer and the cycle-tools-api as the data + cycle-math source. It demonstrates:
- Custom datafeed extending `DatafeedBase` (in-memory pre-fetched bars)
- ES6-class custom indicators (sine wave overlay on price + multi-line CRSI in its own pane)
- Symbol search with debouncing + dropdown z-index above FintaChart toolbars
- Vite plugin that copies `node_modules/@fintatech/fintachart/{localization,htmldialogs,img,css,scripts}` into `public/vendor/fintachart/` so the runtime can load assets via plain HTTP
- 300-bar forward projection of the dominant cycle (placeholder NaN-close bars + extended sine series)

Use it as a working blueprint when adapting FintaChart for a new project.
