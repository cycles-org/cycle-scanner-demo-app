# FintaChart Chart API — Runtime Reference

> Verified against `@fintatech/fintachart@3.1.2`. Authoritative TypeScript signatures: `node_modules/@fintatech/fintachart/d.ts/FintaChart.d.ts` (interface `IChartConfig` and class `Chart`). When in doubt, the working examples shipped at the package root (`custom-indicator.html`, `index.html`, `examples/html/15-custom-datafeed/`, `examples/html/14-instrument-switching/`) are the most reliable usage references.

## Construction

```js
// Canonical pattern in 3.1.2+:
const chart = new FintaChart.Chart({
  container: document.getElementById('chart'),    // HTMLElement OR a CSS selector string
  datafeed: myDatafeed,
  instrument: { symbol: 'BTCUSDT', exchange: 'CRYPTO', tickSize: 0.01 },
  theme: FintaChart.Themes.fintatechDark,
  // ...other IChartConfig fields
});
```

- The `container` field accepts either a DOM element or a CSS selector string.
- All other config fields are optional, but in practice you want `datafeed`, `instrument`, and `theme` set explicitly.
- The legacy `FintaChart.createChart(containerEl, config)` factory still works in 3.1.2 — same chart, different signature (container is the first arg, config the second).

> **Note for 3.1.0 / 3.1.1 users:** earlier versions did NOT expose `Chart` on the global namespace; only the `createChart` factory worked. 3.1.2 added the constructor form to match the README quickstart.

## IChartConfig — common fields

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `datafeed` | `IDatafeedBase` | — | Bar data provider (subclass of `FintaChart.DatafeedBase`) |
| `instrument` | `IInstrument` | — | `{ symbol, exchange, tickSize }` |
| `theme` | `any` | — | Pass a theme object. In 3.1.2+, prefer `FintaChart.Themes.<name>` (e.g. `FintaChart.Themes.fintatechDark`). Older bundles required loading individual `<script>` files (`scripts/themes/fintatechDarkTheme.js`) which set globals like `window.fintatechDarkTheme`. |
| `chartType` | `string` | — | `'candle'`, `'line'`, `'ohlc'`, `'heikinAshi'`, etc. |
| `timeFrame` | `ITimeFrame` | `{ 1, 'd' }` | `{ interval, periodicity }` |
| `timeInterval` | `number` | — | Single-number override of `timeFrame` |
| `width` | `number \| string` | `'100%'` | px or CSS |
| `height` | `number \| string` | `'100%'` | px or CSS |
| `showToolbar` | `boolean` | `true` | Top toolbar |
| `showScrollbar` | `boolean` | `true` | Bottom scrollbar |
| `enableToolPanes` | `boolean` | `true` | Side pane for shape settings |
| `enableHotKeys` | `boolean` | `true` | Keyboard shortcuts |
| `fullWindowMode` | `boolean` | `false` | Start in full-window |
| `barsCount` | `number` | `500` | Initial bar count requested from the datafeed |
| `supportedTimeFrames` | `string[]` | — | Toolbar options, e.g. `['1 Minutes', '1 Hour', '1 Day']` |
| `autoSave` | `boolean` | `false` | Auto-persist via `stateHandler` |
| `addThemeClass` | `boolean` | `true` | Adds CSS class on `<body>` |
| `crossHair` | `string` | — | Initial crosshair mode |
| `searchInstruments` | `(query, exchange?) => Promise<IInstrument[]>` | — | External symbol search hook |
| `tradingSession` | `string` | `'ETH'` | `'ETH'` (extended) or `'RTH'` (regular) |
| `tradeHandler` | `ITradeHandlerCallback` | — | Order submission callback |
| `marketEventsDatafeed` | `MarketEventsDatafeed` | — | Calendar / earnings overlay |

The full `IChartConfig` (with provider/template hooks) lives at d.ts line ~23162.

## Chart methods — by group

### Lifecycle
- `dispose(removeContainer?)` — destroy and free resources. Call this in your React effect cleanup.
- `lock()` — disable interaction permanently.

### Data
- `barDataRows()` → `IBarDataRows` (six rows: `date, open, high, low, close, volume`).
- `appendBars(bars)` — push bars to the chart. Fires `BARS_APPENDED`. **Use this for in-memory pre-fetched data** instead of relying on the datafeed lifecycle.
- `trimDataRows(maxLength)` — shrink to N most recent bars (or `0` to clear).
- `addDataRows(dataRows, replaceIfExists?)` → `DataRows`
- `removeDataRows(...dataRows)` / `clearDataRows(dataRows)`
- `findDataRows(rowMarker)` / `getDataRows(name)` → `DataRows`
- `requestMoreBars()` — emit `MORE_HISTORY_REQUESTED` (older bars).
- `processTick(tick)` — fires `TICK`.
- `sendBarsRequest()` — re-issue a history request to the datafeed (rarely needed; in practice use `appendBars` directly for in-memory data).

### Instrument & timeframe (mostly accessors)
- `chart.instrument = newInstrument` (set/get) → fires `INSTRUMENT_CHANGED`. **Note:** for in-memory datafeeds, this often does NOT trigger a fresh `send()` call.
- `chart.timeFrame = { interval, periodicity }` → fires `TIME_FRAME_CHANGED`.
- `chart.timeInterval = n` (shorthand).
- `searchInstruments(query, exchange?)` → `Promise<IInstrument[]>`.
- `addTimeFrame(data)` / `deleteTimeFrame(data, str)` / `updateSupportedTimeFrames(list)`.

### Chart type

There are **three distinct accessors** on `IChart` for chart type, for historical reasons. This is a real source of confusion — pick the right one:

| Accessor | Type | Accepts | Safe to use? |
|----------|------|---------|--------------|
| `chart.chartType` (get/set) | `IChartType` instance | A chart-type *instance* only | **Reading is fine. DO NOT assign a string** — throws `Cannot create property 'chart' on string`. |
| `chart.chartTypeName` (get/set) | `string` | The string name (`'candle'`, `'line'`, etc.) | Reading is safe. |
| `chart.applyChartType(name, autoScale?)` | method | String name + optional `autoScale: boolean` | **Recommended way to switch by name.** Fires `CHART_TYPE_CHANGED`, optionally auto-scales the vertical axis on apply, doesn't throw. (Per `docs/api/chart-types.md` example: `chart.applyChartType(FintaChart.ChartTypeNames.HEIKIN_ASHI, true)`. The maintainer's earlier response described the second arg as `dateRange` — the doc is the authoritative source.) |

Built-in type names: `'candle'`, `'hollowCandle'`, `'ohlc'`, `'coloredOhlc'`, `'hlc'`, `'coloredHlc'`, `'hl'`, `'coloredHl'`, `'heikinAshi'`, `'renko'`, `'rangeBar'`, `'lineBreak'`, `'pointAndFigure'`, `'kagi'`, `'candleVolume'`, `'equiVolume'`, `'equiVolumeShadow'`, `'line'`, `'mountain'`, `'stepLine'`, `'dot'`, `'dash'`, `'bar'`, `'coloredBar'`.

### Visible range / scroll
- `dateRange(start?, end?)` — get or set
- `recordRange(first?, last?)` — get or set bar-index range. **You'll typically call this after `appendBars` to make the data visible.**
- `visibleDataRange()` → `{ firstVisibleDataRecord, lastVisibleDataRecord }`
- accessors: `firstVisibleIndex`, `lastVisibleIndex`, `firstVisibleRecord`, `lastVisibleRecord`
- `scrollPixels(p)` / `scrollRecords(n)` / `scrollToRealtimeArrow()`
- `startZoom(mode)` / `cancelZoom()` / `zoomPixels(p)` / `zoomRecords(n)`

### Refresh / paint
- `refresh(updateInstruments?)` — sync, heavy.
- `refreshAsync(makeAutoScale?)` — preferred for tight loops. Pass `true` to also auto-scale.
- `refreshLayout()` / `refreshSize()`
- `refreshAutoScaleAsync()` / `refreshAutoScaleAllAsync()`
- `autoScalePanes(kind?)`
- `paint()`

### Panes
- `chart.panes` / `chart.panesContainer` / `chart.primaryPane`
- `addPane(index?, heightRatio?, reducePrimaryPane?)` → `Pane`
- `findPaneAt(y)` → `Pane`

### Indicators
- `addIndicators(indicators)` → `Indicator | Indicator[]` (undo/redo tracked)
- `executeIndicators(indicators)` → `Indicator | Indicator[]` (no undo)
- `removeIndicators(indicators?, removePaneIfEmpty?)`
- `mergeIndicators(a, b)` → `Indicator`
- `restoreIndicatorsState(state)` / `saveIndicatorsState()` → `IIndicatorState[]`
- `refreshIndicators()` — recalculate all
- `chart.indicators` (get) / `chart.favoriteIndicators` (get/set)

### Shapes / drawings
- `startShape(shape, allowEditing?)` → fires `USER_SHAPE_STARTED`
- `finishShape()` / `cancelShape()`
- `copyShape(shape?)` / `pasteShape()` → `Shape`
- `getSelectedShape()` / `removeShapes()`
- `restoreShapesState(state)` / `saveShapesState()` (max 100)
- accessors: `selectedObject`, `showShapes`, `magnetMode`, `lockShapes`, `shapeTemplates`

### Theme
- `chart.theme` (get/set) / `chart.userTheme` (get/set)
- `getTheme()` / `getModifiedTheme(config)`
- `setupLayoutTheme()`

### State
- `saveState()` → `IChartState`
- `restoreState(state, preserveObjects?, toDefault?)` → fires `STATE_LOADED`
- `applyTemplate(templateState)` / `getChartTemplate()`

### Export
- `exportChartData()` — CSV download dialog
- `saveImage()` — image save dialog
- `saveImageToClipboard()`

### Trading (orders/alerts/positions)
- `addOrder(o)` / `removeOrder(o)` / `updateOrderTPSL(id)`
- `addAlert(a)` / `removeAlert(id)`
- `addPosition(o)` / `removePosition(p)`
- accessors: `lastBid`, `lastAsk`, `currency`, `orderFeatures`

### Misc
- `chart.dataContext` (get) / `chart.recordsCount` (get)
- `chart.crossHair` (get) / `chart.crossHairType` (get/set)
- `chart.locale` (get/set) / `localizeText(key, replace?)` → `Promise<string>`
- `chart.timezone` (get/set)

## Events

Listen via `chart.on(FintaChart.ChartEvent.<NAME>, handler)`. Handler receives an event object with `sender`, `target`, `type`, plus `value` / `oldValue` for value-changed events.

| Constant | Fires when |
|----------|-----------|
| `INSTRUMENT_CHANGED` | `chart.instrument = ...` |
| `TIME_FRAME_CHANGED` | `chart.timeFrame = ...` |
| `CHART_TYPE_CHANGED` | `chart.applyChartType(...)` |
| `THEME_CHANGED` | `chart.theme = ...` |
| `BARS_SETTED` | Bar data set (initial load) |
| `BARS_APPENDED` | `appendBars(...)` called |
| `BARS_INSERTED` | Mid-series insert |
| `LAST_BAR_UPDATED` | Live bar updated |
| `TICK` | `processTick()` called |
| `MORE_HISTORY_REQUESTED` | User scrolled past loaded range |
| `INDICATOR_ADDED` / `INDICATOR_REMOVED` | Indicator lifecycle |
| `USER_SHAPE_STARTED` / `_FINISHED` / `_CANCELLED` | Manual draw flow |
| `PANE_ADDED` / `PANE_REMOVED` | Pane lifecycle |
| `HOVER_RECORD_CHANGED` | Crosshair moved over a different bar |
| `FIRST_VISIBLE_RECORD_CHANGED` / `LAST_VISIBLE_RECORD_CHANGED` | Scroll/zoom moved |
| `STATE_LOADED` | `restoreState(...)` finished |
| `LOCALE_CHANGED` / `TIMEZONE_CHANGED` | Settings changed |
| `TOOLBAR_LOADED` / `SCROLLBAR_LOADED` | UI ready |

Full ~70-event list at https://raw.githubusercontent.com/fintatech/fintachart/master/docs/api/events-enums.md

## Periodicity

`FintaChart.Periodicity` is an enum object — values are STRINGS:

```js
FintaChart.Periodicity.TICK    // 't'
FintaChart.Periodicity.SECOND  // 's'
FintaChart.Periodicity.MINUTE  // ''   ← empty string!
FintaChart.Periodicity.HOUR    // 'h'
FintaChart.Periodicity.DAY     // 'd'
FintaChart.Periodicity.WEEK    // 'w'
FintaChart.Periodicity.MONTH   // 'm'  ← month, not minute!
FintaChart.Periodicity.YEAR    // 'y'
```

`supportedTimeFrames` toolbar string format: `'1 Minutes'`, `'5 Minutes'`, `'1 Hour'`, `'4 Hours'`, `'1 Day'`, `'1 Week'`, `'1 Month'`.

## DataRowsMarker

`FintaChart.DataRowsMarker` keys for the `inputDataRowName` property on indicators:

```js
FintaChart.DataRowsMarker.OPEN      // '.open'
FintaChart.DataRowsMarker.HIGH      // '.high'
FintaChart.DataRowsMarker.LOW       // '.low'
FintaChart.DataRowsMarker.CLOSE     // '.close'
FintaChart.DataRowsMarker.VOLUME    // '.volume'
FintaChart.DataRowsMarker.MEDIAN    // '.median'   (H+L)/2
FintaChart.DataRowsMarker.TYPICAL   // '.typical'  (H+L+C)/3
FintaChart.DataRowsMarker.WEIGHTED  // '.weighted' (H+L+2C)/4
// Plus chart-type-specific markers: HEIKIN_ASHI, RENKO, RANGE_BAR, LINE_BREAK, POINT_AND_FIGURE, KAGI
```

## Themes

Loaded as global script files; each exposes a global var:

| Script | Global var |
|--------|-----------|
| `defaultTheme.js` | `defaultTheme` |
| `darkTheme.js` | `darkTheme` |
| `fintatechDarkTheme.js` | `fintatechDarkTheme` |
| `beetTheme.js` | `beetTheme` |
| `grayTheme.js` | `grayTheme` |
| `oliveTheme.js` | `oliveTheme` |
| `orangeTheme.js` | `orangeTheme` |
| `purpleTheme.js` | `purpleTheme` |
| `skyTheme.js` | `skyTheme` |
| `tealTheme.js` | `tealTheme` |

Pass the global to chart config (`theme: fintatechDarkTheme`) or assign at runtime (`chart.theme = darkTheme`).

In a bundler (Vite/webpack) load these as side-effect scripts and read from `window` — the package wasn't designed for tree-shaken ES module consumption.

## Built-in indicators (use directly or via factory)

```js
// Direct construction:
const sma = new FintaChart.SMAIndicator();
sma.updateParameters({ period: 20 });
chart.addIndicators(sma);

// Or via the factory:
const ema = FintaChart.IndicatorFactory.create('EMA', chart);
ema.updateParameters({ period: 50 });
chart.addIndicators(ema);
```

Common types: `SMA`, `EMA`, `DEMA`, `TEMA`, `WMA`, `HMA`, `KAMA`, `VIDYA`, `VOLMA`, `VMA`, `TMA`, `Trend`, `LinearRegression`, `RSI`, `StochRSI`, `Stochastics`, `MACD`, `CCI`, `ROC`, `WilliamsR`, `TRIX`, `TSI`, `UltimateOscillator`, `Bollinger`, `KeltnerChannel`, `DonchianChannel`, `MAEnvelopes`, `ATR`, `StdDev`, `VOLUME`, `OBV`, `VWAP`, `MFI`, `Aroon`, `ADX`, `DMI`, `Ichimoku`, `ParabolicSAR`, `PivotPoints`, `FractalsIndicator`, `PatternsIndicator`, `ZigZagIndicator`, `MoonPhases`, `DailyProfiles`, `VisibleRangeProfiles`, ... (95 total)

Per-indicator parameter table (114 entries) at https://raw.githubusercontent.com/fintatech/fintachart/master/docs/api/indicator-params.md
