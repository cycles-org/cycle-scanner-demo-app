# FintaChart — Quirks & Gotchas

This list is grounded in end-to-end validation against `@fintatech/fintachart@3.1.2`. Items are organized by current relevance — if you're on 3.1.2+, the *Open* and *Always relevant* sections are the ones that still bite.

## Always relevant

### License (read first)

Free for **local development only**. Any deployed/network-accessible app needs a commercial license from Fintatech. Don't ship without one.

### Resource paths must be set BEFORE constructing the chart

```js
FintaChart.ResourcePath.localization = '.../localization/';
FintaChart.ResourcePath.htmlDialogs  = '.../htmldialogs/';
FintaChart.SvgLoader.path            = '.../img/svg-icons/';
```

Forgetting any of the three breaks dialogs and toolbar SVG icons silently — no thrown error.

### Required runtime scripts

All five framework scripts are runtime-required, not optional:

```html
<script src="...frameworks/Intl.min.js"></script>
<script src="...frameworks/moment.min.js"></script>
<script src="...frameworks/detectizr.min.js"></script>
<script src="...frameworks/dom-to-image-more.min.js"></script>
<script src="...frameworks/i18nextXHRBackend.min.js"></script>
<script src="...FintaChart.min.js"></script>
```

3.1.2's README quickstart now lists all five (a docs gap from 3.1.0 / 3.1.1).

### CSS load order matters

```html
<!-- Externals first, then the main stylesheet -->
<link rel="stylesheet" href="...css/external/spectrum.min.css">
<link rel="stylesheet" href="...css/external/toastr.min.css">
<link rel="stylesheet" href="...css/external/jqNumericField.min.css">
<link rel="stylesheet" href="...css/FintaChart.min.css">
```

Wrong order causes color-picker / toast / numeric-input rendering glitches.

### `Periodicity.MINUTE` is the empty string `''`

Not `'m'` (which is **month**).

| Periodicity | Code |
|-------------|------|
| Tick | `'t'` |
| Second | `'s'` |
| **Minute** | `''` (empty) |
| Hour | `'h'` |
| Day | `'d'` |
| Week | `'w'` |
| **Month** | `'m'` (NOT minute!) |
| Year | `'y'` |

Use the enum: `FintaChart.Periodicity.MINUTE`, etc. — same string values, but typed.

### `dispose()` is canonical

- `dispose()` is documented and used by the React example.
- The Angular snippet in some older READMEs uses `destroy()` — likely a deprecated alias.
- Use `dispose()`.

### `refresh()` vs `refreshAsync()`

`refresh()` is synchronous and heavy. In tight loops (per-tick updates, batch appends) use `refreshAsync()` to coalesce repaints into a single rAF.

### `barsCount` defaults to 500

Initial history request fetches 500 bars unless overridden. Increase if your custom indicator needs warm-up bars.

### Theme is also a global script + named global variable (legacy)

After loading `scripts/themes/fintatechDarkTheme.js`, the theme is exposed as a global named `fintatechDarkTheme`. **In 3.1.2+ prefer `FintaChart.Themes.fintatechDark`** — the namespace is populated by the main bundle and doesn't require loading the individual theme script. Keep the legacy script-tag approach only if you support older bundles.

```js
// 3.1.2+:
chart.theme = FintaChart.Themes.fintatechDark;

// Older bundles:
chart.theme = window.fintatechDarkTheme;
```

### Vite / React integration notes

- Place CSS imports in `main.tsx`/`main.jsx` so Vite emits them in the right order.
- Mount the chart in `useEffect` with an empty dep array; store the chart instance in a `useRef`; call `chart.dispose()` in the cleanup function.
- React 18 Strict Mode double-invokes effects in dev — guard with `initRef.current` to avoid constructing two charts in the same container.
- Copy `node_modules/@fintatech/fintachart/{localization,htmldialogs,img,css,scripts,fonts}` into your `public/` folder (or use a Vite plugin to do this automatically) so the runtime can load them via plain HTTP. Do this **synchronously at config-load time**, not in a `buildStart` hook — Vite's static-file middleware initializes its public-dir scan before the rollup build hooks fire, so requests on first page load race the copy and 404. **Don't forget `fonts`** — missing it produces `OTS parsing error: invalid sfntVersion: 1008821359` (which is `<!--`, the start of the SPA-fallback HTML being served instead of the missing font file).

---

## ✅ Resolved in 3.1.5 / 3.1.6

### `Indicator.bindToVerticalScale(verticalScale)` ships

3.1.5 added the public helper we asked for in feedback #12. Verified empirically:

```js
const scale = chart.addVerticalScale();
scale.leftAxisVisible  = true;     // labels on the LEFT side
scale.rightAxisVisible = false;
const ind = new MyOverlayIndicator();
ind.bindToVerticalScale(scale);
chart.primaryPane.addIndicator(ind);   // (also new — see "Pane.addIndicator" below)
```

Result: overlay indicator on the price pane, time-aligned with price, with its own auto-scaled y-axis labels on the left (independent of price's right-side scale). Replaces the `mapCompositeToPriceRange()` value-remap fakery + 300ms debounced visible-range remap loop from our pre-3.1.5 workaround.

`Indicator.dispose()` auto-removes a custom verticalScale when `_isCustomScale` is set, so `chart.removeIndicators([ind])` is sufficient for cleanup. New example at `examples/html/17-overlay-indicator-with-own-axis/`.

### `Pane.addIndicator(ind)` shipped

The API our 2026-05-06 spike found missing now exists. Tested: adding a custom indicator with `isOverlay = false` via `chart.primaryPane.addIndicator(ind)` correctly lands on the primary pane (pane count unchanged) — the explicit pane choice overrides the indicator's own `isOverlay` declaration. Documented in `docs/api/custom-indicators.md` § "Which pane?".

### Settings-dialog crash on custom indicators fixed (#24)

`Cannot read properties of null (reading 'appendChild')` from inside the Style-tab rendering is resolved in 3.1.5. Custom indicators can keep their gear icons; `this.allowSettingsDialog = false` workaround is no longer required.

### Bundled CSS scoped (#7)

All `[type="checkbox"]` rules and `.thmFintatechDarkTheme [...]` rules are now scoped under `.tcdComponentsContainer`, `.tcdDialog`, `.tcdRootContainer`. Host-page checkboxes outside FintaChart's own DOM are no longer affected. The `!important` overrides we'd shipped against earlier versions are no longer needed.

### Fullscreen mode

Two new toolbar buttons: "Full Window" and "Full Screen". Available via the toolbar.

### Chart auto-resize with its container (#23)

3.1.5+ ships its own internal `ResizeObserver` (verified by grep: `new ResizeObserver(` in `scripts/FintaChart.min.js`). Drag-to-resize panel containers, window resizes within a flex layout, etc. all just work — no consumer-side wiring required. Pre-3.1.5 builds need the manual `ResizeObserver → chart.refreshSize()/refreshLayout()/refreshAsync()` recipe.

---

## ⚠️ New gotchas in 3.1.5 / 3.1.6 (verified empirically)

### `chart.addIndicatorInNewPane(ind)` is buggy — use `chart.addIndicators(ind)` instead

The new 3.1.6 helper is documented in `docs/api/custom-indicators.md` but its implementation crashes inside `initPaneTitle` with:

```
Cannot read properties of null (reading 'appendChild')
  at initPaneTitle (FintaChart.min.js:949265)
  at refresh (FintaChart.min.js:929973)
  at executeIndicators (FintaChart.min.js:3604184)
  ...
  at addIndicatorInNewPane (FintaChart.min.js:3592757)
```

**Workaround:** use the standard `chart.addIndicators(ind)` with `ind.isOverlay = false` (set in `onResetDefaults`) — same end result, no crash. The default pane-placement code path works fine; only the new explicit helper is broken.

### Toolbar search modal — 4 gotchas to work around

The 3.1.4+ search modal works, but only with all of these in place:

1. Install `FintaChart.Instrument.filter` / `filterById` overrides **BEFORE** `new FC.Chart(...)` (the modal can bind references inside the constructor)
2. The modal's internal filter matches **symbol substring only**, not company — augment `symbol` with company text in `filter()` return; return clean `symbol` from `filterById()`
3. `chart.exchanges()` strings must match what your `Instrument.filter` returns in `exchange` field, or use `[]` (no tabs)
4. INSTRUMENT_CHANGED listener should read `chart.instrument` directly, not `event.value` (payload shape varies across 3.1.x)

Full pattern + reasoning in `references/datafeed-contract.md` § *Built-in toolbar search modal*.

### `Indicator.needsCustomScale()` declarative protocol (partial)

There's a protected hook `Indicator.needsCustomScale()` (overridable per-class, returns boolean). If `true`, FintaChart's pane lifecycle auto-creates a `VerticalScale` and binds the indicator to it — no explicit `chart.addVerticalScale() + ind.bindToVerticalScale(scale)` dance needed. The 3.1.5 release notes broadened the protocol from Volume-only to all custom indicators.

```js
class MyOverlay extends FintaChart.Indicator {
  onResetDefaults() { this.isOverlay = true; this.addPlot('...', 'V'); }
  needsCustomScale() { return true; }   // ← auto-creates + binds scale on add
}

chart.primaryPane.addIndicator(ind);
```

**Caveat (verified 2026-05-13 against 3.1.6):** the auto-created scale defaults to `leftAxisVisible: false` AND `rightAxisVisible: false`. The indicator renders against its own coordinates correctly, but no axis labels are drawn. You either:

- Read `ind.verticalScale.leftAxisVisible = true` post-hoc, OR
- Stick with the explicit path (`chart.addVerticalScale() + scale.leftAxisVisible = true + ind.bindToVerticalScale(scale) + primaryPane.addIndicator(ind)`) — clearer and produces visible axis labels by construction.

The explicit path is what our `app/src/App.jsx` ships. Flagged with the maintainers as a default-tweak suggestion.

### Built-in pane-merge does not target the price pane

The right-click "Move pane top / bottom / Separate pane top / bottom" menu items move indicators between *custom-indicator panes*. They cannot merge an indicator into the price (primary) pane. The only way to overlay a custom indicator on the price pane is programmatic — `chart.primaryPane.addIndicator(ind)`. Consumer-side toggle UI (a radio button) is the current pattern; a built-in "Move to price overlay" menu item is flagged with the maintainers as a future enhancement.

---

## ✅ Resolved in 3.1.4

### Built-in symbol search via `Instrument.filter` overrides

The 3.1.1-era `searchInstruments: async (q) => IInstrument[]` config callback was the wrong API — it exists on `chart.searchInstruments` as a function stub but does nothing. **The correct integration in 3.1.4 (with a working example at `examples/html/15-instrument-search/`) is to override three static methods:**

```js
// Modal calls this on every keystroke + every exchange tab click.
// page is 1-based; subtract 1 before slicing.
FintaChart.Instrument.filter = async (query, exchanges, page, size) => {
  let results = await yourBackend.search(query, { exchanges });
  if (typeof page === 'number') {
    const start = Math.max(0, page - 1) * size;
    results = results.slice(start, start + size);
  }
  return results;
};

// Modal calls this when a result is clicked (and on state restore).
// Always resolve to a fully populated instrument with `id`.
FintaChart.Instrument.filterById = async (id) => {
  return await yourBackend.lookup(id);
};

// Drives the filter tabs at the top of the modal.
chart.exchanges = () => ['FOREX', 'NASDAQ', 'CRYPTO'];
```

The chart's toolbar search-button opens the modal, the modal renders results, click → instrument switch + bars request all handled by the chart. No custom search component or z-index hackery needed if you adopt this pattern.

### Context-menu pane-move for custom indicators

3.1.4 wired the four context-menu items (`mergeUp`/`mergeDown`/`unmergeUp`/`unmergeDown` → "Move pane top / bottom / Separate pane top / bottom") through to `chart.movePane(pane, offset)` for custom indicators.

**The greyed-out state we initially saw was correct UX, not a bug.** Items enable when there's a destination pane to move into/out of. With only one custom-indicator pane below price, "Move pane bottom" has nowhere to go, and "Separate" only applies to overlays. Once you add a second custom-indicator pane (e.g. composite + per-cycle pane), the move items become active and work as expected — matches how every multi-pane chart handles pane management.

No consumer-side workaround required.

### Bar Replay hint

3.1.4 added a `promptForStartRecord()` method on the `ReplayModeManager` that surfaces the localized prompt `"Click a bar to set the replay start point"` (in `localization/en.json:798`) when a user clicks Play / Forward / To-Real-Time before picking a bar. The "looks broken" UX papercut from 3.1.x is closed.

---

## ✅ Resolved in 3.1.2

These were issues in 3.1.0 / 3.1.1 that the maintainers fixed in 3.1.2. Listed here so you don't accidentally apply old workarounds.

### `new FintaChart.Chart(config)` now works

In 3.1.0 / 3.1.1 the `Chart` class was declared in the d.ts but not exposed on the global namespace; only the `createChart(container, config)` factory worked. **3.1.2 added the constructor**, so the README quickstart pattern now matches the runtime:

```js
const chart = new FintaChart.Chart({
  container: '#chart',           // selector string OR HTMLElement
  datafeed, instrument, theme, ...
});
```

`createChart` still works for backward compat.

### `chart.appendBars(bars)` auto-establishes a visible range

In earlier versions, calling `appendBars` without first setting a record-range left the chart with `recordsCount > 0` but an empty canvas. **3.1.2 auto-sets the range and calls `refreshAsync(true)`** when no range was previously set. If you want a specific window (e.g. last 200 bars + projection), still call `chart.recordRange(start, end)` explicitly afterward.

### `ChartTypeNames.LINE` and `ChartTypeNames.AREA` exposed

Previously these two values were registered with `ChartTypeFactory` but missing from the `ChartTypeNames` constant — passing `'line'` or `'area'` worked, but the typed enum lookup didn't. Both keys now present.

### `FintaChart.Themes` namespace

10 built-in themes accessible by key without loading individual `<script>` tags:

```js
FintaChart.Themes.default
FintaChart.Themes.dark
FintaChart.Themes.fintatechDark
FintaChart.Themes.beet
FintaChart.Themes.gray
FintaChart.Themes.olive
FintaChart.Themes.orange
FintaChart.Themes.purple
FintaChart.Themes.sky
FintaChart.Themes.teal
```

Plus `FintaChart.ThemeUtils.deepMerge(target, source)` for deriving custom themes.

### `addLine` / factory-registration confusion documented

The new `docs/api/custom-indicators.md` (458 lines, added in 3.1.2) clarifies:
- Indicator-level horizontal lines are `addLine(color, value)` — `addLevel` is gone.
- Two registration patterns: direct `chart.addIndicators(new MyIndicator())` (no factory call needed) vs `FintaChart.IndicatorFactory.add(MyIndicator)` (only required for state save/restore by string type name).

### Chart-type and indicator counts unified

Previously the README claimed "16+ chart types" and "100+ indicators" while individual docs disagreed (95 / 17 / 25 / 114 depending on the page). 3.1.2 unified everything at **19 chart types** and **114 indicators**. `events-enums.md`'s `ChartTypeNames` table was rebuilt against the source constant (no more fabricated entries like `BAR`, `MOUNTAIN`, `STEP_LINE`, `DOT`, `DASH`).

---

## ⚠️ Docs fixed in 3.1.2 but runtime gotcha unchanged

These three runtime behaviors haven't changed, but the new 3.1.2 docs spell out the contract clearly enough that you can avoid the trap if you read first.

### `chart.chartType = 'line'` still throws

```
TypeError: Cannot create property 'chart' on string 'line'
```

The setter expects a chart-type *instance*, not a string. **Use `chart.applyChartType('line')` instead** — the docs were updated but the runtime setter was not.

### `chart.instrument = newInstrument` does NOT auto-trigger `send()`

3.1.2's new `docs/api/data-adapters.md` § *Switching instruments at runtime* + `docs/api/instrument.md` § *Identity & equality*, plus the maintainers' empirical findings, spell out the full contract:

> Every `IInstrument` must have a **unique** `id`. Identity is keyed off `id` only — `Instrument.equals(a, b)` is `a.id === b.id`. Trap: **`undefined === undefined` returns `true`**, so if neither side has an `id`, the equality check passes and the setter is a silent no-op (the internal `_instrument` is never updated).
>
> With unique `id`s the setter does update `_instrument`, populates `_newBarsRequest`, and fires `INSTRUMENT_CHANGED` — but does **not** call `datafeed.send(...)`. The consumer must invoke `chart.sendBarsRequest()` to flush the staged request.
>
> The built-in `InstrumentChangePopup` UI calls `sendBarsRequest()` after picking a symbol — that's why the no-flush trap is invisible for built-in-UI users and only bites programmatic consumers.

```js
chart.instrument = nextInstrumentWithId;   // unique id required, otherwise silent no-op
chart.sendBarsRequest();                    // explicit flush — required
```

> The maintainers acknowledged this as an open behavioural question and may, in a future minor, either (a) have the setter auto-flush when `id` differs, or (b) extend `Instrument.equals` to fall back to `symbol`+`exchange` when `id` is missing. Either would close the gotcha. Until then: explicit `sendBarsRequest()` after assignment.

For an **in-memory datafeed** (you've fetched all bars yourself), bypass entirely:

```js
chart.trimDataRows(0);
chart.applyChartType(isCloseOnly(bars) ? 'line' : 'candle');
chart.instrument = nextInstrument;        // updates the toolbar label
chart.appendBars(bars);                   // pushes data directly
chart.recordRange(bars.length - histShown, bars.length - 1);
chart.refreshAsync(true);
```

### `_values` is a base-class internal that silently clobbers subclass writes

The new `docs/api/custom-indicators.md` § *Reserved private fields* documents this clearly:

> The `Indicator` base class uses `_values`, `_plots`, `_parameters`, `_chart`, and a number of other single-underscore fields internally. **Do not assign to them from your subclass.** Direct writes appear to work but are clobbered by the next lifecycle pass — the symptom is "my indicator draws nothing" with no error.

| Don't | Do |
|-------|----|
| `this._values = newDataRows` | Use `this.values.get(name).set(value)` per bar |
| `this._plots.push({ … })` | Use `this.addPlot(color, name)` in `onResetDefaults` |
| `this._parameters.set(...)` | Use `this.updateParameter(name, value)` |

For "bring your own data" patterns where you want to attach an external array to the indicator instance, **use any other prefix** — `_sineSeries`, `_externalCrsi`, `_payload`, etc. Other underscore-prefixed names (e.g. `_crsi`, `_ub`, `_lb`) work fine.

---

## ❌ Open in 3.1.6 (workarounds required)

### `refreshIndicators()` recalculates all indicators — no per-indicator path

When you mutate one indicator's data and need a redraw, every other indicator on the chart recalculates too. With multiple built-in indicators (e.g. Stoch RSI on 12k bars + custom composite + cRSI), scroll / zoom can hammer the render loop.

Workarounds:
- Debounce `refreshIndicators()` calls to fire only when scroll/zoom **settles** (e.g. 300 ms after last event), not during the drag.
- Cache the visible range; skip the refresh if the range hasn't changed meaningfully.

### `addPlot(color, name, FintaChart.PointPlot.Style.DOT)` doesn't actually create a PointPlot

The 5-arg `addPlot(color, name, plotStyle?, width?, style?)` signature accepts `'dot'` as a `plotStyle` value, but the resulting render is a **full-height vertical tick line** (HistogramPlot-like), not a circular dot. Not what `PointPlot.Style.DOT` suggests.

**Workaround:** to draw a single point or boundary marker on a pane, use a `Shape` (e.g. `FintaChart.DotShape`, `FintaChart.VerticalLineShape`) attached to the indicator's pane via `ind.pane.addShapes([shape])`. Track shapes in a ref and clean up on indicator re-add.

### `isBusy(request)` unreliable for in-memory datafeeds

Always returns `false` for synchronous-completion paths. For network-fetching datafeeds it works as intended. If you bypass the datafeed and call `chart.appendBars(bars)` directly, ignore `isBusy` entirely.

### Internal toolbar / dialog z-indexes are very high

Custom overlays (search dropdowns, tooltips, modal layers) need `z-index: 100000+` to stay clickable above FintaChart's own toolbars and dialogs. Without it, your overlay items appear visually but mouse clicks hit the chart canvas behind them.

### `barDataRows().close.updateLast(v)` requires `refreshAsync()` to be visible

Updating typed-array values doesn't trigger a repaint on its own:

```js
const rows = chart.barDataRows();
rows.close.updateLast(price);
chart.refreshAsync();   // schedule paint
```

### Source code is NOT in the GitHub repo

Only docs + examples are committed. The actual minified bundle ships via npm. Authoritative TypeScript types live at `node_modules/@fintatech/fintachart/d.ts/FintaChart.d.ts` after install. Authoritative working examples are the HTML files at the package root.

### Comparison instruments share the datafeed

When the user adds a comparison symbol, the same `send(request)` fires with `request.instrument` set to the comparison symbol while `request.chart.instrument` remains the primary. Don't reset/stop the primary real-time stream just because a comparison is being loaded:

```js
const isPrimary = !request.instrument
  || request.instrument.symbol === request.chart.instrument.symbol;
if (isPrimary) stopRealtime();   // only then
```

### Custom indicator data-length must align with the chart's bar count

When passing a precomputed array via the "bring your own data" pattern, the array length should equal the chart's bar count (or the bar count + projection window). Excess values are ignored; missing values produce gaps. If your array is shorter than the loaded bar count, the indicator silently stops drawing partway through.

### Useful d.ts grep targets

For deeper investigation, grep `node_modules/@fintatech/fintachart/d.ts/FintaChart.d.ts` for:

| You want | Grep pattern |
|----------|-------------|
| All exported classes | `^\s*(declare\s+)?class\s+\w+` |
| `IChartConfig` definition | `interface IChartConfig\b` |
| All event constants | `enum ChartEvent\b` |
| All chart-type names | `enum ChartTypeNames\b` |
| `IBar` shape | `interface IBar\b` |
| Indicator base class | `class Indicator\b` |
| Datafeed base class | `class DatafeedBase\b` |
