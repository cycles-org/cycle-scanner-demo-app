# FintaChart Datafeed Contract

## Bar / tick interfaces

```ts
interface IBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ITick {
  date: Date;
  price: number;
  volume: number;
  bid: number;
  ask: number;
}
```

## Three built-in datafeeds + custom

| Class | When to use | Override these |
|-------|-------------|----------------|
| `FintaChart.FileDatafeed` | Static CSV/JSON from disk | Pass `ExternalDataFormatterCsv` / `ExternalDataFormatterJson` |
| `FintaChart.RestDatafeed` | History-only or polling REST | `formatGetHistory`, `formatGetLastTick`, `formatBars`, `formatRealtime`, `formatGetInstruments`, `formatInstruments` |
| `FintaChart.WebsocketDatafeed` | Streaming WS | + `formatSubscribe`, `formatUnsubscribe` |
| **Custom** (extend `DatafeedBase`) | Anything else (in-memory, hybrid, third-party SDK, server-pushed data, etc.) | Override `send(request)` directly — full control |

## Custom datafeed — minimum viable shape

```js
class MyDatafeed extends FintaChart.DatafeedBase {
  send(request) {
    // 1. Register the request with the base class (also shows the loading spinner).
    super.send(request);

    // 2. Read what's being asked.
    //    request.chart       — the FintaChart chart that issued the request
    //    request.instrument  — IInstrument (or null → primary)
    //    request.chart.timeFrame — { interval, periodicity }
    //    request.count       — how many bars (defaults to chart's barsCount)
    const inst = request.instrument || request.chart.instrument;
    const tf   = request.chart.timeFrame;

    // 3. Fetch bars however you like.
    fetchBars(inst.symbol, tf.periodicity, tf.interval, request.count || 500)
      .then(bars => {
        // 4. (Optional) Drop stale responses if the user switched mid-fetch.
        //    NOTE: in practice the isBusy flag is unreliable for in-memory cases.
        //    For network fetches it's worth checking.
        if (!this.isBusy(request)) return;

        // 5. Push bars back to the chart.
        this.onCompleteRequest(request, bars);  // bars: IBar[]
      });
  }

  dispose() {
    // Stop any open WS / polling loops here.
    super.dispose();
  }
}

const datafeed = new MyDatafeed();
```

Key methods of `DatafeedBase`:
- `super.send(request)` — registers + shows loading spinner. Always call first.
- `this.isBusy(request)` → `boolean` — false if the chart already moved on. Useful for network fetches; **unreliable for in-memory pre-fetched data**.
- `this.onCompleteRequest(request, bars)` — pushes parsed bars to the chart.
- `this.dispose()` — chart calls this on `chart.dispose()`. Clean up sockets/timers here.

## In-memory bypass pattern (the practical approach for pre-fetched data)

When you've already fetched all the bars (e.g. from a REST batch endpoint, or you're displaying historical-only data), the datafeed lifecycle becomes a hindrance: the chart only calls `send()` at construction time and may not re-issue it on `chart.instrument = ...`. Workaround: bypass the datafeed and push bars directly.

```js
// Initial chart setup uses a minimal datafeed (returns empty bars at construction).
class PassiveDatafeed extends FintaChart.DatafeedBase {
  send(request) {
    super.send(request);
    Promise.resolve().then(() => {
      try { this.onCompleteRequest(request, []); } catch (_) {}
    });
  }
}

const chart = FintaChart.createChart(container, {
  datafeed: new PassiveDatafeed(),
  instrument: { symbol: 'INIT', exchange: 'X', tickSize: 0.01 },
  timeFrame: { interval: 1, periodicity: FintaChart.Periodicity.DAY },
  theme: fintatechDarkTheme,
});

// Later, when you have bars to render:
async function render(symbol) {
  const bars = await fetchBarsFromMyAPI(symbol);

  // 1. Clear any existing bars.
  if (chart.barDataRows().close.length > 0) chart.trimDataRows(0);

  // 2. Set chart type BEFORE bars arrive (use applyChartType, NOT chart.chartType=).
  chart.applyChartType(isCloseOnly(bars) ? 'line' : 'candle');

  // 3. Update the instrument label.
  chart.instrument = { symbol, exchange: 'X', tickSize: 0.01 };

  // 4. Push bars directly into the chart's data context.
  chart.appendBars(bars);

  // 5. CRITICAL: appendBars does NOT auto-set the visible range. Without this,
  //    the chart shows an empty canvas even though recordsCount > 0.
  const showLast = Math.min(500, bars.length);
  chart.recordRange(bars.length - showLast, bars.length - 1);
  chart.refreshAsync(true);
}
```

This pattern is verified to work for both close-only series (use `'line'`) and OHLC series (use `'candle'`).

## Real-time updates after history is loaded

**A. Push bars from outside the datafeed (simplest):**
```js
chart.appendBars([{ date, open, high, low, close, volume }]);  // append a closed bar
const rows = chart.barDataRows();                              // update the live (forming) bar
rows.close.updateLast(newPrice);
rows.high.updateLast(Math.max(rows.high.value(rows.high.length - 1), newPrice));
rows.low.updateLast(Math.min(rows.low.value(rows.low.length - 1), newPrice));
rows.volume.updateLast(newVolume);
chart.refreshAsync();
```

**B. Push from inside the datafeed:**
- Datafeed holds its own subscription / WS.
- On each incoming tick, decide: same-bar update vs new-bar.
- Same-bar → `chart.barDataRows().close.updateLast(...)` etc + `chart.refreshAsync()`.
- New-bar → `chart.appendBars([newBar])`.

## Resolution string format (when you need to encode `{ interval, periodicity }` into a single string for an external API)

| Periodicity | Resolution string |
|-------------|-------------------|
| `'tick'` | `'tick'` |
| `'s'` | `'{interval}S'` (e.g. `'30S'`) |
| `''` (minute) | `'{interval}'` (e.g. `'5'`) |
| `'h'` | `'{interval}H'` |
| `'d'` | `'{interval}D'` |
| `'w'` | `'{interval}W'` |
| `'m'` | `'{interval}M'` |
| `'y'` | `'{interval}Y'` |

Lower/upper-case distinction is load-bearing.

## Lifecycle: when does the chart call `send()`?

The chart issues a fresh request to the datafeed when:
1. **Construction** — initial history fetch. The datafeed is empty at this point if you're pre-fetching externally.
2. **`chart.timeFrame = ...`** — refetch for the new resolution.
3. **`chart.requestMoreBars()`** — user scrolled past loaded range.
4. **Comparison instruments added** — `request.instrument` will be the comparison symbol; `request.chart.instrument` is still the primary.

> **Notable gap:** assigning `chart.instrument = newInstrument` does NOT auto-call `send()`. The 3.1.2 docs (`docs/api/data-adapters.md` § *Switching instruments at runtime* + `docs/api/instrument.md` § *Identity & equality*) and the maintainers' empirical confirmation make the contract explicit:
>
> 1. Every `IInstrument` must have a **unique** `id`. The setter's change detection runs `Instrument.equals(a, b)` which compares `a.id === b.id` only — and **`undefined === undefined` returns `true`**, so if both sides lack an `id` the equality check passes and the setter is a silent no-op. The internal `_instrument` field is unchanged.
> 2. With unique `id`s, the setter populates `_newBarsRequest` and fires `INSTRUMENT_CHANGED`, but does NOT call `datafeed.send(...)`. The internal `_instrument` updates correctly, but the staged bars request is not flushed.
> 3. Call `chart.sendBarsRequest()` afterward to flush. (The built-in `InstrumentChangePopup` UI calls this for you after a pick — that's why programmatic consumers hit the no-flush trap while users of the built-in symbol picker don't.)
>
> ```js
> chart.instrument = nextInstrumentWithId;
> chart.sendBarsRequest();   // explicit flush — required
> ```
>
> For an in-memory datafeed (you've fetched all bars yourself), bypass this entirely by calling `chart.appendBars(bars)` directly after `chart.instrument = next` — the in-memory bypass pattern above.

## Built-in formatter methods (subclass these instead of `send()` if you use Rest/Websocket base)

Request side (override to construct your URL/payload):
- `formatGetInstruments()` — instrument metadata list request
- `formatGetLastTick(instrument)` — latest-tick request
- `formatGetHistory(instrument, resolution, from, to)` — history request
- `formatSubscribe(instrument, resolution)` / `formatUnsubscribe(instrument, resolution)` (WS only)

Response side (override to parse):
- `formatInstruments(response)` → `IInstrument[]`
- `formatBars(response)` → `IBar[]`
- `formatRealtime(response)` → `IBar` (single latest bar; replace or append based on date)

## `IInstrument` shape

Full shape per `docs/api/instrument.md`:

```ts
{
  id: string;             // REQUIRED — canonical identity for equality + setter
  symbol: string;         // display symbol, e.g. 'EUR/GBP', 'BTCUSDT'
  company?: string;       // company / issuer name
  exchange?: string;      // 'NASDAQ', 'CRYPTO', 'FOREX', etc.
  datafeed?: string;      // datafeed source identifier
  type?: string;          // 'stock', 'crypto', 'forex', 'index', ...
  tickSize?: number;      // minimum price increment, e.g. 0.01 or 0.00001
  pricePrecision?: number;// decimal places for display
  mappingId?: string;     // alternate id for cross-provider mapping
  mappings?: unknown;     // provider-specific mapping data
  provider?: string;      // data provider name
  contractSize?: number;  // for derivatives
  baseCurrency?: string;  // 'EUR'
  currency?: string;      // quote currency, e.g. 'GBP'
  kind?: string;          // additional classification
  description?: string;
}
```

> **3.1.2:** the `id` field is load-bearing. The chart's instrument-equality check is keyed off `id` only — assigning a new instrument that differs by symbol/exchange but lacks an `id`, or has the same `id`, is a silent no-op. Stamp a unique `id` on every `IInstrument` (e.g. `\`${symbol}.${exchange}\``).

### Static helpers (all on `FintaChart.Instrument.*`)

| Helper | Purpose |
|--------|---------|
| `Instrument.filterById(id)` → `Promise<IInstrument>` | **Recommended canonical lookup.** Returns an instrument with `id` already populated, ready to assign to `chart.instrument`. Also called by the built-in toolbar search modal when a result is clicked. |
| `Instrument.filter(symbol, exchanges?, page?, size?)` → `Promise<IInstrument[]>` | Paginated symbol search. **Also called by the built-in toolbar search modal on every keystroke + every exchange-tab click — page is 1-based.** See *Built-in toolbar search modal* below. |
| `Instrument.all()` → `Promise<IInstrument[]>` | Fetch every instrument from the configured datafeed. |
| `Instrument.equals(a, b)` → `boolean` | `id`-only comparison (`a.id === b.id`). Beware the `undefined === undefined` trap. |
| `Instrument.normalizeTickSize(tickSize)` → `number` | Round-off-safe tick-size normalization (`0.000010000001` → `0.00001`). |

## Built-in toolbar search modal (3.1.4+) — gotcha-heavy

The chart's toolbar exposes a search-button that opens a modal with text input + exchange-filter tabs. To wire it to your own catalog, **override three methods** — NOT the legacy `searchInstruments` config callback (which is a stubbed-out function that does nothing). The pattern matches `examples/html/15-instrument-search/`.

**FOUR GOTCHAS in 3.1.4–3.1.6** that aren't documented anywhere — all verified empirically against `@fintatech/fintachart@3.1.6`:

### Gotcha 1 — INSTALL OVERRIDES BEFORE `new FC.Chart(...)`

The chart's `InstrumentSearch` instance can capture/bind `FintaChart.Instrument.filter` *inside the constructor*. If you set the override AFTER construction, the modal may use the stubbed default (returning empty results) — verified zero invocations of our override in 3.1.4 when we set it post-construction.

```js
// CORRECT — overrides BEFORE constructor
FintaChart.Instrument.filter     = async (q, exch, page, size) => { ... };
FintaChart.Instrument.filterById = async (id) => { ... };
const chart = new FintaChart.Chart({ container, ... });   // ← then construct
chart.exchanges = () => ['US', 'LSE', 'CRYPTO'];          // per-instance, AFTER is fine
```

### Gotcha 2 — The modal's internal filter matches `symbol` substring only, NOT `company`

The modal applies a client-side filter on top of what you return: `normalizeSymbolForSearch(query)` is searched as a substring within `normalizeSymbolForSearch(result.symbol)`. The `company` / `description` fields are NOT checked. So when a user types a company name like "Apple" and your REST returns rich matches (`AAPL`, `0R2V`, `603020`, all with `company: 'Apple Inc...'`), the modal filters them ALL out because their symbols don't contain "APPLE".

**Workaround:** augment the symbol field in your `filter()` return so the modal's substring match passes; return the clean symbol in `filterById()` so the toolbar label stays sane.

```js
let lastResults = [];

FintaChart.Instrument.filter = async (query, exchanges, page, size) => {
  const clean = await yourBackend.search(query);   // [{id, symbol, company, ...}]
  // (paginate, exchange-filter on `clean` here if needed)
  lastResults = clean;   // cache CLEAN for filterById
  // Augment for modal display so substring-match passes:
  return clean.map((c) => ({
    ...c,
    symbol: c.company ? `${c.symbol} · ${c.company}` : c.symbol,
  }));
};

FintaChart.Instrument.filterById = async (id) => {
  const hit = lastResults.find((i) => String(i.id) === String(id));
  if (hit) return hit;   // CLEAN — un-augmented
  // ...fallback for direct id lookups (state restore)
};
```

Result: dropdown shows `AAPL · Apple Inc · US — Apple Inc` (matches user's typed query), but the chart's toolbar label shows just `AAPL` after the pick.

### Gotcha 3 — `chart.exchanges()` strings must match your `Instrument.filter` return's `exchange` field

When the user clicks a tab, the chart passes that tab's value as the `exchanges` arg to your filter. If you return `['NASDAQ', 'NYSE']` from `chart.exchanges()` but your backend's instruments have `exchange: 'US'`, the tab clicks produce empty results. Either match what your backend uses, OR return `[]` (no tabs).

**Note:** returning `[]` from `chart.exchanges()` was a crash in 3.1.4 (`Failed to execute 'querySelector' on 'Element': ' > .active' is not a valid selector`) — fixed in 3.1.5+. Empty is now safe.

### Gotcha 4 — INSTRUMENT_CHANGED event payload is unstable

The event's `value` field shape varies across 3.1.x builds. Always read `chart.instrument` directly inside the listener; don't rely on the event payload structure:

```js
chart.on(FintaChart.ChartEvent.INSTRUMENT_CHANGED, () => {
  const inst = chart.instrument;            // ← read direct, not from event.value
  if (!inst?.id) return;
  // ...your routing logic
});
```

### Field-name compatibility

Different backends return different casing. If your REST returns PascalCase (`SymbolId`, `Symbol`, `ShortName`) or different field names (`shortName` for company), normalise before returning to the modal:

```js
const normalise = (r) => ({
  ...r,
  id:       String(r.symbolId ?? r.SymbolId ?? r.id ?? r.Id),
  symbolId: r.symbolId ?? r.SymbolId ?? r.id ?? r.Id,
  symbol:   r.symbol   ?? r.Symbol   ?? '',
  exchange: r.exchange ?? r.Exchange ?? '',
  company:  r.company  ?? r.Company  ?? r.shortName ?? r.ShortName ?? '',
  type:     r.type     ?? r.Type     ?? '',
  tickSize: r.tickSize ?? r.TickSize ?? 0.01,
});
```

Reference example: `examples/html/15-instrument-search/` (3.1.4) — but note it uses a static array of 9 instruments with pre-matched symbols, so all three of the gotchas above are invisible in that demo.

> **Verified in this project** at `app/src/App.jsx` — the cycle-tools-api integration uses all four gotchas' workarounds.

Reference example: `examples/html/15-instrument-search/index.html` (shipped 3.1.4). The modal handles UI rendering, debouncing, click-to-select, and instrument-switch flush internally — once the three overrides are in place, no consumer-side search component is needed.

> **Migration note:** if your app currently renders its own search UI (input + dropdown above the chart), you can keep it OR consolidate to the built-in modal. The built-in modal is on the chart toolbar; the custom approach gives you full layout control. Both work in parallel.

Recommended runtime-switch pattern (per `docs/api/instrument.md` § *Identity & equality*):

```js
const next = await FintaChart.Instrument.filterById('eur-cad');  // canonical instance
chart.instrument = next;
chart.sendBarsRequest();   // explicit flush — also cancels any in-flight request first
```
