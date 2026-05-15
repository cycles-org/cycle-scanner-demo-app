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

### `chart.addIndicatorInNewPane(ind)` — fixed in 3.1.7 (was buggy in 3.1.5/3.1.6)

**Status:** ✅ **Fixed in 3.1.7.** The 3.1.5/3.1.6 implementation crashed inside `initPaneTitle` with `Cannot read properties of null (reading 'appendChild')` — the new pane's title container wasn't materialized before `initPaneTitle()` ran. 3.1.7's fix: `Indicator.placeOnPane` now drives `chart.InitializeVisualDimensions()` and `pane.refreshScaleAsync()` on the new pane (same bring-up as the standard `addPane()`), so the title bar exists before any rendering call.

Verified empirically against 3.1.7 with both built-in `SimpleMovingAverage` and our custom `CompositeCycle` — both add cleanly without crashing.

**Workaround (no longer required on 3.1.7, kept for back-compat):** the standard `chart.addIndicators(ind)` with `ind.isOverlay = false` (set in `onResetDefaults`) places the indicator in a new pane via the indicator's default placement code path. This works in every 3.1.x version and is what our reference implementation uses; on 3.1.7 you can switch to `addIndicatorInNewPane(ind)` if you prefer the explicit API.

### Toolbar search modal — 4 gotchas to work around (2 closed in 3.1.7)

The 3.1.4+ search modal works, but only with all of these in place:

1. ✅ **DOCUMENTED in 3.1.7** — Install `FintaChart.Instrument.filter` / `filterById` overrides **BEFORE** `new FC.Chart(...)`. The 3.1.7 docs added a "Search modal: install hooks before chart construction" section explaining the `InstrumentSearch` constructor-timing race. The pattern itself hasn't changed; just the docs caught up. Continue installing hooks pre-construction.
2. ⚠️ **PARTIALLY FIXED in 3.1.7 — augmentation still recommended for display.** 3.1.7's modal now MATCHES the query against both `instrument.symbol` AND `instrument.company` (was symbol-substring only in 3.1.4 – 3.1.6) — so the original bug of typing "Apple" returning zero results when tickers are `AAPL`/`0R2V`/`603020` is fixed. **BUT** the row template also changed: each row now has only a `tcdInstrumentSearchItem_Left` (symbol) and `tcdInstrumentSearchItem_Right` (exchange + type) — the `company` field moved to the row's `title` attribute as a hover tooltip and **is no longer rendered inline**. Result: users see "AAPL US STOCK" three times for the three Apple-related tickers and can't disambiguate without hovering each row. The augmentation hack is now a **display-only workaround** (no longer needed for matching): keep augmenting `symbol` with the company text in `filter()` so the visible row reads `AAPL · Apple Inc`; `filterById()` returns the clean symbol so the toolbar label stays sane. (Cosmetic: `Instrument.filter`'s first parameter was also renamed `symbol` → `query` in the 3.1.7 docs.)
3. ⚠️ **STILL OPEN** — `chart.exchanges()` strings must match what your `Instrument.filter` returns in `exchange` field, or use `[]` (no tabs)
4. ⚠️ **STILL OPEN** — INSTRUMENT_CHANGED listener should read `chart.instrument` directly, not `event.value` (payload shape varies across 3.1.x)

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

### Built-in pane-merge does not target the price pane — shipped in 3.1.7

**Status:** ✅ **Shipped in 3.1.7** as the new **"Move to price pane"** context-menu item (`moveToPrice` localization key, `<li data-id="moveToPrice">` in `IndicatorContextMenu.html`, `canMoveToPrice` getter on the `Indicator` class). One-click promotion of a custom-pane indicator onto the primary pane as an overlay — creates a dedicated `VerticalScale` with `leftAxisVisible = true` (the axis-visibility fix we also flagged), migrates plots, rebuilds the title bar, and removes the source pane when it becomes empty. The reverse direction is the existing **"Separate pane bottom"** (`unmergeDown`).

**Pre-3.1.7 history:** the right-click "Move pane top / bottom / Separate pane top / bottom" menu items moved indicators between *custom-indicator panes* only — they could not merge into the price (primary) pane. The only way to overlay a custom indicator on the price pane was programmatic, via `chart.primaryPane.addIndicator(ind)`. Consumer-side toggle UI (a radio button or split-button popover) was the workaround.

**Notes for consumers on 3.1.7+:**
- Right-click menu now does what users expect — no consumer-side toggle UI is strictly required anymore. App-toolbar split-buttons remain useful for high-discoverability surfaces but can be dropped if a lighter integration is preferred.
- The new context-menu path auto-creates the custom `VerticalScale` with `leftAxisVisible = true`, so the indicator's axis labels render — no post-hoc `ind.verticalScale.leftAxisVisible = true` patch needed (compare the `needsCustomScale` gotcha further down, which was about declarative-protocol-driven creation, not the menu path).

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

### `refreshAsync(true)` does NOT recompute indicator values — call `refreshIndicators()` after mutating data

Each `Indicator` keeps its plotted output in an internal **values series** (the `this.values.get('PlotName')` `DataRows`-like buffer that `onInputTick(currentBar)` writes into). The values series is cached **per bar position** and FintaChart only calls `onInputTick` for *newly inserted bars*. When you mutate the underlying data array (e.g. NaN-prepend after a lazy-load, or any "bring your own data" rewrite), the cached values for the existing bars stay stale — they were computed against the *old* array and now point at the wrong positions.

`chart.refreshAsync(true)` only redraws using the cached values; it does **not** invalidate them. The line plots cleanly, but on the wrong bars: composite/cycle values land on the older lazy-loaded bars (where they should be NaN) and the projection-range bars come up empty (where they should hold values). The bug is invisible on initial load and only surfaces after the user scrolls.

Diagnostic: `_composite[i]` and `ind.values.get('Composite').value(i)` should agree for every `i`. If they don't, the values series is stale.

```js
// Wrong — silently misaligned after first lazy-load
ind._composite = padNaN(ind._composite, addedCount);
chart.refreshAsync(true);

// Right — forces values-series recompute against the freshly padded array
ind._composite = padNaN(ind._composite, addedCount);
chart.refreshIndicators();      // recomputes onInputTick for every bar
chart.refreshAsync(true);       // schedule paint
```

Trade-off: `refreshIndicators()` recalcs every indicator on the chart (per the gotcha above), so debounce on rapid scroll. There is currently no per-indicator `invalidate()` API.

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

### Toolbar dropdowns (timeframe, chart-type) only open via CSS `:hover`, never via click

FintaChart 3.1.6 ships only **one** open-state rule for any of its toolbar `.drop > ul` dropdowns:

```css
.drop:hover > ul { transform: scaleY(1) }
```

The default state is `transform: scaleY(0)`. When the user *clicks* a picker, FC's JS adds `.active` and `.activated` classes to the parent `<li>` — but there is **no CSS rule that responds to those classes**, so the click alone never opens the dropdown. The dropdown only ever appears while the cursor remains over the picker. The moment the cursor moves off, `:hover` no longer matches and the dropdown collapses back to `scaleY(0)`.

Real symptom (consumer-level): the dropdown looks like it opens on the first hover-then-click, the user picks a value, and on subsequent attempts they see nothing — because their cursor is now elsewhere and `:hover` isn't matching, even though they clicked the picker. Worse, on touch devices `:hover` is fired only briefly (or not at all), making every dropdown essentially unusable.

Additional twist: FC's JS sets the dropdown's inline `width: 0; height: 0` in the closed state. Forcing `transform: scaleY(1)` alone via CSS isn't enough — the inline width/height also have to be overridden.

**Patch** (one CSS rule, no JS):

```css
/* Match FC's own selector specificity so we win the cascade without
   needing !important on the transform; width/height must use !important
   because FC sets them inline. */
.tcdRootContainer .tcdToolbar-top .tcdToolbarNav .drop.active > ul,
.tcdRootContainer .tcdToolbar-top-left .tcdToolbarNav .drop.active > ul,
.tcdRootContainer .tcdToolbar-top-right .tcdToolbarNav .drop.active > ul {
  transform: scaleY(1);
  width: auto !important;
  height: auto !important;
}
```

After this, every toolbar dropdown (timeframe picker, chart-type picker, etc.) responds to `.active` (which FC's JS already toggles correctly on click). Verified end-to-end through 4 click cycles open → close → open → close.

**Worth raising upstream:** ship an `.drop.active > ul` rule alongside the existing `:hover` rule, OR consolidate to a class-driven open state and drop the `:hover` dependency entirely. Touch-device users currently have no way to interact with any FC toolbar dropdown.

### Timeframe picker doesn't translate to periodicity-encoded symbol IDs

If your datafeed serves separate datasets per timeframe (FSC1, Yahoo Finance, and most "tickerID-baked" feeds work this way — `AAPL.US-D-1:FSC1` ≠ `AAPL.US-W-1:FSC1`), FintaChart's built-in `1d / 1w / 1h` toolbar picker won't switch which dataset you load. The picker only rewrites `chart.timeFrame` and re-issues `send()` with the *same* symbol ID — your datafeed serves the original dataset back, with wrong axis labels and stale cycle math.

Fix: listen for `FC.ChartEvent.TIME_FRAME_CHANGED`, rewrite the symbol ID per your datafeed's encoding scheme, and trigger your normal symbol-change pipeline. Also cap `IChartConfig.supportedTimeFrames` to the variants your datafeed actually serves — otherwise the picker shows options that will always fail.

**Full recipe with FSC1 + YFI examples + echo-guard pattern: `references/datafeed-contract.md` § *Timeframe pickers vs. periodicity-encoded symbol IDs*.**

### No public API to add custom buttons to the chart toolbar

The `Toolbar` class (`d.ts` line 6000) exposes a `container` getter and `getBottomToolbarRightSide()` helper, but every method that adds, removes, or arranges buttons is `private`. The toolbar markup is a fixed template fetched asynchronously from `htmldialogs/Toolbar.html`. There is no `chart.toolbar.addButton(config)` or "custom slot" API in 3.1.6.

If you need app-specific controls (indicator toggles, layout pickers, custom modes) inside the chart frame next to the built-in buttons, the supported path is DOM injection into `chart.toolbar.container > ul.tcdToolbar.tcdToolbarNavTop`. Three subtle problems to solve: async template load, FintaChart's own re-renders wiping your slot, and popover clipping by `tcdToolbar-scroll-wrapper { overflow: hidden }`.

**Full working recipe with React portal + `MutationObserver` + popover handling: `references/custom-toolbar-buttons.md`.**

Two gotchas worth pulling out here for anyone debugging:
- **Popovers anchored to injected buttons must portal to `document.body`** with `position: fixed` — z-index alone can't escape FintaChart's overflow-clipped scroll wrapper.
- **DOM class names** (`tcdToolbar`, `tcdToolbarNavTop`, `tcdToolbar-btn-indicators`, `tcdToolbar-scroll-wrapper`) are not documented as stable contracts. A bundle minor version could rename them and break injection silently.

### Custom indicator data-length must align with the chart's bar count

When passing a precomputed array via the "bring your own data" pattern, the array length should equal the chart's bar count (or the bar count + projection window). Excess values are ignored; missing values produce gaps. If your array is shorter than the loaded bar count, the indicator silently stops drawing partway through.

**Lazy-load alignment** — when the chart fires `requestMoreBars()` and your datafeed prepends N older bars via `onCompleteRequest(request, olderBars)`:

1. Pad your precomputed data array with N leading NaN so positional reads in `onInputTick(this.currentBar)` keep returning the right value for the right bar date. Preserve the original sequence type — a `Float64Array` stays a `Float64Array` (Float64Array values default to 0, not NaN, so explicitly fill the leading region with `NaN`).
2. After padding, call `chart.refreshIndicators()` to recompute the cached values series (see "`refreshAsync(true)` does NOT recompute indicator values" above). Without this step the line lands on the wrong bars even though your array is now the right length.

For indicators whose math doesn't extend into the projection window (e.g. CRSI / RSI / anything depending on real prices), pre-pad the trailing `MAX_PROJECTION_BARS` slots with NaN at creation time too — otherwise the indicator overflows into the projection range with stale-looking values or stops abruptly mid-chart on lazy-load.

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
