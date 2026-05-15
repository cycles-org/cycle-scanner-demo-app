import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
import LoginScreen from './components/LoginScreen.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import SymbolSearch from './SymbolSearch.jsx';
import { loadBars, cycleScanner, crsi, detrendTrend, isCloseOnly, QuotaError, searchSymbols } from './api.js';
import { CycleToolsDatafeed } from './CycleToolsDatafeed.js';
import { getIndicatorClasses } from './indicators.js';
import {
  buildCompositeSeries,
  generateFutureBars,
  pearson,
  weightedInSampleCorrelation,
  filterAndSortPeaks,
  autoCrsiLength,
} from './utils/cycleMath.js';
import { useScannerStore } from './state/useScannerStore.js';
import { useSettingsStore, SETTINGS_BOUNDS } from './state/useSettingsStore.js';
import { phaseColorForPeak } from './utils/phaseColor.js';
import CyclesTable from './components/CyclesTable.jsx';
import SpectrumChart from './components/SpectrumChart.jsx';
import IndicatorButtons from './components/IndicatorButtons.jsx';
import SettingsButton from './components/SettingsButton.jsx';
import SettingsDialog from './components/SettingsDialog.jsx';
import {
  rewriteSymbolIdTimeframe,
  detectTimeframe,
  fcTimeFrameToTarget,
  targetToFcTimeFrame,
} from './utils/symbolIdRewrite.js';

const STORAGE_KEY = 'cycletools.apiKey';
const THEME_KEY = 'cycletools.theme';
// Hard upper bound for forward-projection bars we pre-allocate on the chart.
// The user's actual visible projection comes from useSettingsStore and is
// clamped to <= this by SETTINGS_BOUNDS.projectionBars.max.
const MAX_PROJECTION_BARS = SETTINGS_BOUNDS.projectionBars.max;

function corrColor(v) {
  if (!Number.isFinite(v)) return 'transparent';
  return Math.abs(v) > 0.5 ? '#3fb950' : '#d29922';
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'dark');

  // Theme persistence — runs whether or not we're logged in.
  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.body.dataset.theme = theme;
  }, [theme]);

  if (!apiKey) {
    return (
      <LoginScreen
        onLogin={(k) => { localStorage.setItem(STORAGE_KEY, k); setApiKey(k); }}
        theme={theme}
        onThemeChange={setTheme}
      />
    );
  }

  return (
    <ScannerApp
      apiKey={apiKey}
      theme={theme}
      onThemeChange={setTheme}
      onLogout={() => { localStorage.removeItem(STORAGE_KEY); setApiKey(''); }}
    />
  );
}

function ScannerApp({ apiKey, theme, onThemeChange, onLogout }) {
  const picked         = useScannerStore((s) => s.picked);
  const setPicked      = useScannerStore((s) => s.setPicked);
  const setLoadedData  = useScannerStore((s) => s.setLoadedData);
  const setStatus      = useScannerStore((s) => s.setStatus);
  const status         = useScannerStore((s) => s.status);
  const error          = useScannerStore((s) => s.error);
  const bars           = useScannerStore((s) => s.bars);
  const closes         = useScannerStore((s) => s.closes);
  const peaks          = useScannerStore((s) => s.peaks);
  const selected       = useScannerStore((s) => s.selected);
  const paneSelected   = useScannerStore((s) => s.paneSelected);
  const showComposite  = useScannerStore((s) => s.showComposite);
  const showCRSI       = useScannerStore((s) => s.showCRSI);
  const inSampleCorr   = useScannerStore((s) => s.inSampleCorr);
  const visibleCorr    = useScannerStore((s) => s.visibleCorr);
  const setComposite   = useScannerStore((s) => s.setComposite);
  const setCrsiResp    = useScannerStore((s) => s.setCrsiResp);
  const setCorrelations = useScannerStore((s) => s.setCorrelations);

  // Persistent user settings (lookback for cycle scanner, projection bars,
  // lazy-load batch size). Lookback drives both the initial fetch size and
  // the cycle-scan input window, so re-issuing the pipeline on lookback
  // change is the right contract — see settings-dialog Save handler.
  const cycleLookback     = useSettingsStore((s) => s.cycleLookback);
  const projectionBars    = useSettingsStore((s) => s.projectionBars);
  const lazyLoadBatchSize = useSettingsStore((s) => s.lazyLoadBatchSize);

  const selectedCycles = useMemo(
    () => peaks.filter((p) => selected.has(p.cycleLength)),
    [peaks, selected],
  );

  const chartRef = useRef(null);
  const datafeedRef = useRef(null);
  const initRef = useRef(false);
  // Slot element inside FintaChart's own toolbar that hosts our injected
  // IndicatorButtons via React portal. FintaChart 3.1.6 exposes no public
  // API for adding custom toolbar buttons (the `Toolbar` class has private
  // _controls + private button-init methods only), so we DOM-inject a fresh
  // <li> into `chart.toolbar.container > ul.tcdToolbar.tcdToolbarNavTop`.
  // See gotchas (next-round feedback) — flag for upstream `addToolbarButton` API.
  const [toolbarSlot, setToolbarSlot] = useState(null);
  const compositeIndRef = useRef(null);
  const rawCompositeRef = useRef(null);
  // Refs for lazy-load extension. When the datafeed prepends N older bars
  // we recompute each indicator's data:
  //   - Composite + single cycles: pure-sine math, evaluated at negative
  //     indices via buildCompositeSeries(_, total, frontPad). No rescan.
  //   - CRSI: re-fetched from the server with the extended closes array.
  //     A version counter guards against overlapping refetches (the
  //     gear-icon period change can interleave with a scroll-left lazy load).
  const singleCycleRefs = useRef(new Map());   // Map<cycleLength, Indicator>
  const crsiIndRef      = useRef(null);
  const crsiFetchVersion = useRef(0);          // monotonic; latest win
  const futureBarsRef   = useRef([]);          // last appended future bars (preserved across lazy loads)

  // Keep theme in sync with FintaChart.
  // Themes are sourced from `FintaChart.Themes.<name>` (3.1.2+). The script-tag
  // globals `window.defaultTheme` / `window.fintatechDarkTheme` are kept as
  // fallback for older bundles.
  useEffect(() => {
    const FC = window.FintaChart;
    if (!chartRef.current || !FC) return;
    const next = theme === 'light'
      ? (FC.Themes?.default ?? window.defaultTheme)
      : (FC.Themes?.fintatechDark ?? window.fintatechDarkTheme);
    if (next) chartRef.current.theme = next;
  }, [theme]);

  // ─── Chart bootstrap ────────────────────────────────────────────────────
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const FC = window.FintaChart;
    const initialTheme = theme === 'light'
      ? (FC.Themes?.default ?? window.defaultTheme)
      : (FC.Themes?.fintatechDark ?? window.fintatechDarkTheme);
    const container = document.getElementById('chart-container');

    const datafeed = new CycleToolsDatafeed();
    datafeedRef.current = datafeed;

    // ── Native toolbar search modal: register BEFORE `new FC.Chart` ──────
    // Per the maintainers' PR #1 against this repo: 3.1.4+ has a
    // timing-dependent race where `FC.Instrument.filter` installed AFTER
    // chart construction is sometimes never invoked by the toolbar's
    // InstrumentSearch (the modal can snapshot/bind the reference inside
    // the constructor). Registering up-front closes the race window for
    // free — by the time anything inside `new FC.Chart` can capture the
    // reference, our override is already in place. This matches the
    // pattern in `examples/html/15-instrument-search/`, which sets
    // `Instrument.filter` at module top-level before constructing the
    // chart at the bottom of the script.
    //
    // `chart.exchanges` is per-instance (only meaningful after the chart
    // exists) and `INSTRUMENT_CHANGED` likewise; both stay below.

    let lastResults = [];

    // cycle-tools-api SearchSymbols returns PascalCase OR camelCase fields
    // depending on the dataset (api.js patches the same way in
    // getDatasetSeries). Normalise so FintaChart's id-based identity check
    // and our pipeline's symbolId lookup both work.
    //
    // The toolbar modal renders rows as `{symbol} {exchange} — {company}`
    // and matches the user's query against `company` too. Our REST returns
    // the full name in `shortName` (e.g. "Apple Inc"), so we map that into
    // `company` for the modal — otherwise the dropdown only shows the
    // symbol and "Apple" / "Microsoft" / "Bitcoin" never display.
    const normalise = (r) => {
      const sid = r.symbolId ?? r.SymbolId ?? r.id ?? r.Id;
      return {
        ...r,
        id:       String(sid),
        symbolId: sid,
        symbol:   r.symbol   ?? r.Symbol   ?? '',
        exchange: r.exchange ?? r.Exchange ?? '',
        company:  r.company  ?? r.Company  ?? r.shortName ?? r.ShortName
                  ?? r.description ?? r.Description ?? '',
        type:     r.type     ?? r.Type     ?? r.instrumentType ?? r.InstrumentType ?? '',
        tickSize: r.tickSize ?? r.TickSize ?? 0.01,
      };
    };

    // 3.1.7 made two changes to the toolbar search modal:
    //
    //  1) The internal filter NOW matches the query against both
    //     `instrument.symbol` AND `instrument.company` (was symbol-substring
    //     only in 3.1.4–3.1.6). Good — `Apple` finds AAPL natively.
    //  2) The row template changed: `_Left` (symbol only) + `_Right`
    //     (exchange + type). **The `company` field moved to the row's
    //     `title` attribute as a hover tooltip — it's NOT rendered
    //     inline anymore.**
    //
    // The augmentation below was originally a (1)-workaround. With (2)
    // it's now a (2)-workaround instead: we augment the `symbol` field
    // with the company text so the visible row reads `AAPL · Apple Inc`
    // and the user can disambiguate `AAPL` (US) vs `AAPL` (Buenos Aires)
    // vs `AAPL` (Toronto) without hovering each one. `filterById` returns
    // the CLEAN row from `lastResults` so the chart's toolbar label
    // shows just the ticker after selection.
    //
    // `lastResults` cache lets `filterById` hand back the clean row
    // without re-hitting the API.
    FC.Instrument.filter = async (query, filters, page, size) => {
      try {
        const raw = await searchSymbols(query ?? '', apiKey);
        let clean = (raw ?? []).map(normalise);
        if (Array.isArray(filters) && filters.length > 0) {
          clean = clean.filter((i) => filters.includes(i.exchange));
        }
        if (typeof page === 'number' && typeof size === 'number') {
          const start = Math.max(0, page - 1) * size;
          clean = clean.slice(start, start + size);
        }
        lastResults = clean;
        // Augment the symbol field for inline display in 3.1.7's
        // _Left-only-symbol row layout. Without this, the company is
        // only visible on hover.
        return clean.map((c) => ({
          ...c,
          symbol: c.company ? `${c.symbol} · ${c.company}` : c.symbol,
        }));
      } catch (e) {
        console.error('[FC.Instrument.filter]', e);
        return [];
      }
    };

    FC.Instrument.filterById = async (id) => {
      const hit = lastResults.find((i) => String(i.id) === String(id));
      if (hit) return hit;
      try {
        const raw = await searchSymbols(String(id), apiKey);
        const list = (raw ?? []).map(normalise);
        const match = list.find((i) => String(i.id) === String(id));
        return match ?? { id, symbol: '—', exchange: '', tickSize: 0.01 };
      } catch (e) {
        console.error('[FC.Instrument.filterById]', e);
        return { id, symbol: '—', exchange: '', tickSize: 0.01 };
      }
    };

    // 3.1.2+: `new FintaChart.Chart({ container, ...config })` is the documented
    // primary entry point (matches the README quickstart). The `createChart` factory
    // is kept for backward-compat but the constructor form is canonical.
    const chart = new FC.Chart({
      container,
      width: '100%', height: '100%',
      theme: initialTheme,
      datafeed,
      instrument: { symbol: '—', exchange: '', tickSize: 0.01 },
      timeFrame: { interval: 1, periodicity: FC.Periodicity.DAY },
      chartType: 'line',
      showToolbar: true,
      showScrollbar: true,
      // Initial request count — the configured lookback. The cycle scanner
      // runs on exactly these bars; lazy-loaded older bars (via
      // requestMoreBars) extend the chart visually but don't re-trigger a
      // scan. See useSettingsStore / SettingsDialog.
      barsCount: cycleLookback,
      // Only Daily / Weekly / Hourly: these are the variants our datafeed
      // (cycle-tools-api FSC1 + YFI) actually serves via symbol-ID rewrite
      // (see utils/symbolIdRewrite.js). Other timeframes from FintaChart's
      // default picker would point at non-existent datasets — best to hide
      // them rather than show a broken option.
      supportedTimeFrames: ['1 Hour', '1 Day', '1 Week'],
      crossHair: FC.CrossHairType.CROSS,
      useSmoothedLines: false,
    });
    chartRef.current = chart;

    // Empty exchange tabs — search filters by query only. The bundled
    // search modal handles `[]` cleanly in 3.1.5+ (earlier versions
    // crashed with a `' > .active'` selector error).
    chart.exchanges = () => [];

    // INSTRUMENT_CHANGED fires both on toolbar modal picks and on
    // programmatic `chart.instrument = …` writes in the pipeline.
    // We read `chart.instrument` directly because the event payload
    // shape isn't documented and differs across 3.1.x builds.
    // Feedback-loop guard via id equality.
    const onInstrumentChanged = () => {
      const inst = chart.instrument;
      if (!inst || inst.symbol === '—' || !inst.id) return;
      const cur = useScannerStore.getState().picked;
      const curId = cur && (cur.symbolId ?? cur.SymbolId);
      if (curId != null && String(curId) === String(inst.id)) return;
      useScannerStore.getState().setPicked({
        ...inst,
        symbolId: inst.symbolId ?? inst.id,
        symbol:   inst.symbol,
        exchange: inst.exchange ?? '',
      });
    };
    chart.on(FC.ChartEvent.INSTRUMENT_CHANGED, onInstrumentChanged);

    // ── Timeframe picker → symbol-ID rewrite ─────────────────────────────
    // FintaChart's built-in timeframe picker rewrites `chart.timeFrame` and
    // re-issues the datafeed send() — but our cycle-tools-api datafeed
    // serves whichever symbol-ID is set, not whichever timeframe is asked
    // for. So a "1W" click without an ID rewrite would either replay the
    // daily data with wrong axis labels or break silently.
    //
    // Bridge: when the user picks a different timeframe in the toolbar,
    // rewrite the active symbol-ID to the matching periodicity variant
    // (e.g. AAPL.US-D-1:FSC1 → AAPL.US-W-1:FSC1), then trigger our
    // pipeline by updating `picked` in the store. The pipeline does a
    // fresh fetch + cycle scan against the new dataset.
    //
    // Echo guard: when we ourselves write `chart.timeFrame` (after a
    // symbol switch, to keep the toolbar in sync with the loaded data),
    // this handler fires with the new timeframe — but `currentTimeframe`
    // (from the picked symbol-ID) already matches `target`, so we no-op.
    const onTimeFrameChanged = () => {
      const FCns = window.FintaChart;
      const target = fcTimeFrameToTarget(chart.timeFrame);
      if (!target) return;
      const cur = useScannerStore.getState().picked;
      if (!cur) return;
      const curId = cur.symbolId ?? cur.SymbolId ?? cur.id;
      const currentTimeframe = detectTimeframe(curId);
      if (currentTimeframe === target) return;   // echo from our own write
      const newId = rewriteSymbolIdTimeframe(curId, target);
      if (!newId) {
        // Datafeed doesn't have this timeframe — revert the picker and
        // surface a clear message.
        const restore = targetToFcTimeFrame(currentTimeframe, FCns);
        if (restore) chart.timeFrame = restore;
        const datafeed = (typeof curId === 'string' && curId.includes(':'))
          ? curId.slice(curId.lastIndexOf(':') + 1)
          : 'unknown';
        useScannerStore.getState().setStatus(
          'error',
          `${target} not supported for ${cur.symbol ?? '—'} (${datafeed})`,
        );
        return;
      }
      // Trigger pipeline re-run via the standard `picked`-changed path.
      useScannerStore.getState().setPicked({
        ...cur,
        id: newId,
        symbolId: newId,
      });
    };
    chart.on(FC.ChartEvent.TIME_FRAME_CHANGED, onTimeFrameChanged);

    // Tell FintaChart to relayout when its container changes size.
    // 3.1.5/3.1.6 added an internal ResizeObserver to the bundle (single
    // `new ResizeObserver(...)` in scripts/FintaChart.min.js), so this is
    // now defensive — both observers fire and call refreshSize, no harm.
    // Pre-3.1.5 builds rely entirely on consumer-side wiring like this.
    // rAF-throttled so a continuous drag fires at most once per frame.
    let resizeRaf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        if (!chartRef.current) return;
        try {
          chartRef.current.refreshSize?.();
          chartRef.current.refreshLayout?.();
          chartRef.current.refreshAsync?.();
        } catch (_) { /* noop */ }
      });
    });
    ro.observe(container);

    // ── Inject a slot into FintaChart's own toolbar for our IndicatorButtons.
    // The toolbar is a fixed template (htmldialogs/Toolbar.html) — no public
    // API to add custom buttons in 3.1.6. We append a fresh <li> to the top
    // toolbar <ul>; React then portals IndicatorButtons into it.
    //
    // Timing complication: FintaChart fetches the toolbar template HTML and
    // populates the <ul> asynchronously, so a synchronous probe right after
    // `new FC.Chart()` will find the toolbar container but NOT the <ul> yet.
    // We retry on rAF + bounded interval, and observe the chart container's
    // parent so we also catch the template-loaded moment.
    //
    // FintaChart re-renders the toolbar on theme switch / timeframe change /
    // i18n reload — those replace child nodes and would wipe our slot. The
    // observer below catches those too and re-creates the slot.
    let slotEl = null;
    let toolbarObserver = null;
    let retryTimer = null;
    let disposed = false;
    const SLOT_CLASS = 'ind-toolbar-slot';

    const ensureSlot = () => {
      if (disposed) return;
      const toolbarRoot = chart.toolbar?.container;
      const ul = toolbarRoot?.querySelector('ul.tcdToolbar.tcdToolbarNavTop');
      if (!ul) return;
      if (slotEl && ul.contains(slotEl)) return;
      // Either no slot yet, or our previous slot was removed.
      slotEl = document.createElement('li');
      slotEl.className = SLOT_CLASS;
      // Insert AFTER the "add indicators" button so our custom-indicator
      // toggles sit adjacent to FintaChart's built-in indicators picker.
      const anchor = ul.querySelector('.tcdToolbar-btn-indicators');
      if (anchor && anchor.parentNode === ul) {
        ul.insertBefore(slotEl, anchor.nextSibling);
      } else {
        ul.appendChild(slotEl);
      }
      setToolbarSlot(slotEl);
      // First successful inject — stop polling. Observer still watches for
      // future toolbar re-renders.
      if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
    };

    // Try synchronously (cheap if it lands), then poll briefly while the
    // toolbar template is loading. 200ms × 25 = 5s upper bound.
    ensureSlot();
    if (!slotEl) {
      let retries = 0;
      retryTimer = setInterval(() => {
        if (disposed || retries++ >= 25) {
          clearInterval(retryTimer); retryTimer = null;
          return;
        }
        ensureSlot();
      }, 200);
    }

    // Observe the chart container's parent (FintaChart mounts the toolbar
    // somewhere in this subtree). Watching the chart.toolbar.container would
    // miss the case where the container element itself gets replaced.
    const observeRoot = container.parentElement || container;
    toolbarObserver = new MutationObserver(() => ensureSlot());
    toolbarObserver.observe(observeRoot, { childList: true, subtree: true });

    return () => {
      disposed = true;
      try { toolbarObserver?.disconnect(); } catch (_) {}
      if (retryTimer) { try { clearInterval(retryTimer); } catch (_) {} }
      try { slotEl?.parentNode?.removeChild(slotEl); } catch (_) {}
      // Note: don't setToolbarSlot(null) here — React unmounts the component
      // simultaneously, and setting state during cleanup of an unmounting
      // tree triggers warnings. The portal naturally goes away when the
      // component unmounts.
      cancelAnimationFrame(resizeRaf);
      try { ro.disconnect(); } catch (_) {}
      try { chart.off?.(FC.ChartEvent.INSTRUMENT_CHANGED, onInstrumentChanged); } catch (_) {}
      try { chart.off?.(FC.ChartEvent.TIME_FRAME_CHANGED, onTimeFrameChanged); } catch (_) {}
      try { chart.dispose(); } catch (_) {}
      chartRef.current = null;
      datafeedRef.current = null;
      initRef.current = false;
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Lazy-load callback — called by CycleToolsDatafeed after older bars are
  // prepended to the chart in response to a `kind: 'moreBars'` request. The
  // chart's internal bar array has grown by N at the front; every indicator
  // data array reads positionally by `currentBar`, so we must pad each by
  // N NaN at the front to keep alignment with the most-recent bars (where
  // the cycle analysis values live).
  //
  // Storing a ref to this lets us pass a stable reference into
  // datafeed.setContext() without re-binding on every render.
  const handleLazyLoaded = useRef(async (addedCount) => {
    if (!chartRef.current || !addedCount || addedCount <= 0) return;
    const total = chartRef.current.barDataRows().close.length;
    const state = useScannerStore.getState();
    const storeBars = state.bars;
    if (storeBars.length === 0) return;
    const intendedLen = storeBars.length + MAX_PROJECTION_BARS;
    const frontPad = Math.max(0, total - intendedLen);
    if (frontPad === 0) return;   // nothing to extend over

    // 1) Composite + single cycles — recompute via the offset trick. Pure
    //    sine math, no rescan, no network. The same selected cycles drive
    //    the reconstruction; only the time window grows.
    const peaks = state.peaks;
    const selected = state.selected;
    const selectedCyclesNow = peaks.filter((p) => selected.has(p.cycleLength));
    if (compositeIndRef.current && selectedCyclesNow.length > 0) {
      compositeIndRef.current._composite = buildCompositeSeries(
        selectedCyclesNow, total, frontPad,
      );
    }
    for (const [len, ind] of singleCycleRefs.current.entries()) {
      const peak = peaks.find((p) => p.cycleLength === len);
      if (!peak) continue;
      ind._cycleSeries = buildCompositeSeries([peak], total, frontPad);
    }

    // 2) CRSI — re-fetch with the now-extended historical close array. CRSI
    //    is causal so values at the original analysis-window positions are
    //    unchanged; only the older bars get newly computed values. The
    //    `crsiFetchVersion` counter discards stale responses if a period
    //    change or another lazy-load races with this one.
    const crsiInd = crsiIndRef.current;
    let crsiPromise = null;
    if (crsiInd && apiKey) {
      const rows = chartRef.current.barDataRows();
      const histLen = total - MAX_PROJECTION_BARS;
      const extendedCloses = new Array(histLen);
      for (let i = 0; i < histLen; i++) extendedCloses[i] = rows.close.value(i);
      const period = crsiInd.period;
      const version = ++crsiFetchVersion.current;
      crsiPromise = (async () => {
        try {
          const r = await crsi(extendedCloses, period, apiKey);
          if (version !== crsiFetchVersion.current) return false;
          if (!chartRef.current?.indicators?.includes?.(crsiInd)) return false;
          const pad = (raw) => {
            const out = new Array((raw?.length ?? 0) + MAX_PROJECTION_BARS).fill(NaN);
            if (raw) for (let i = 0; i < raw.length; i++) out[i] = raw[i];
            return out;
          };
          crsiInd._crsi = pad(r?.crsi);
          crsiInd._ub   = pad(r?.ub);
          crsiInd._lb   = pad(r?.lb);
          // setCrsiResp is fine to call from a captured ref — it just writes
          // to the scanner store.
          useScannerStore.getState().setCrsiResp(r);
          return true;
        } catch (e) {
          console.error('[CRSI lazy-extend]', e);
          return false;
        }
      })();
    }

    // 3) Refresh the chart NOW for the synchronous composite/single-cycle
    //    update (so the user sees the cycles extend immediately). When the
    //    CRSI refetch lands, refresh again to pick up the new CRSI values.
    const refresh = () => {
      try {
        chartRef.current?.refreshIndicators?.();
        chartRef.current?.refreshAsync?.(true);
      } catch (_) {}
    };
    refresh();
    if (crsiPromise) { crsiPromise.then((ok) => { if (ok) refresh(); }); }
  });

  // ─── Pipeline: load bars → scan → trend ──────────────────────────────────
  useEffect(() => {
    if (!picked || !apiKey || !chartRef.current) return;
    let cancelled = false;
    setStatus('loading bars…');

    (async () => {
      try {
        const fresh = await loadBars(
          picked.symbolId ?? picked.SymbolId,
          apiKey,
          { count: cycleLookback },
        );
        if (cancelled) return;
        if (!fresh || fresh.length < 100) {
          throw new Error(`Only ${fresh?.length ?? 0} bars returned (minimum 100).`);
        }

        // Wire the datafeed for future lazy-load (scroll-left) requests.
        // The datafeed handles `kind: 'moreBars'` itself; we just hand it
        // the API context + the NaN-padding callback.
        datafeedRef.current.setBars(fresh);
        datafeedRef.current.setContext({
          symbolId: picked.symbolId ?? picked.SymbolId,
          apiKey,
          batchSize: lazyLoadBatchSize,
          onLazyLoaded: (n) => handleLazyLoaded.current(n),
        });

        if (chartRef.current.barDataRows().close.length > 0) chartRef.current.trimDataRows(0);
        chartRef.current.applyChartType(isCloseOnly(fresh) ? 'line' : 'candle');
        // Update the chart's instrument label so the toolbar shows the picked
        // symbol. We pass the canonical `id` so 3.1.2+'s id-based equality
        // check fires correctly — no `id` would make `Instrument.equals` reduce
        // to `undefined === undefined` (silent no-op). The INSTRUMENT_CHANGED
        // listener compares ids and skips when same, preventing feedback loops
        // when the toolbar search modal triggers this same path.
        chartRef.current.instrument = {
          id: picked.symbolId ?? picked.SymbolId,
          symbol: picked.symbol ?? picked.Symbol,
          exchange: picked.exchange ?? picked.Exchange ?? '',
          tickSize: 0.01,
        };
        // Keep FintaChart's timeframe-picker UI in sync with the periodicity
        // encoded in the picked symbol-ID. Without this, a user who switched
        // the toolbar to "1W" and then picks a fresh symbol from search
        // (which is always the daily variant) would see the toolbar stuck on
        // "1W" while the chart actually shows daily data. The onTimeFrameChanged
        // listener's echo guard (currentTimeframe === target → no-op) prevents
        // this programmatic write from looping back through symbol-ID rewrite.
        {
          const FCns = window.FintaChart;
          const detected = detectTimeframe(picked.symbolId ?? picked.SymbolId);
          const tf = targetToFcTimeFrame(detected, FCns);
          if (tf) {
            try { chartRef.current.timeFrame = tf; } catch (_) { /* noop */ }
          }
        }
        // Reset indicator-ref tracking — old refs point to indicators that
        // belong to the previous symbol and were disposed when we cleared
        // the chart above.
        singleCycleRefs.current.clear();
        crsiIndRef.current = null;
        compositeIndRef.current = null;
        rawCompositeRef.current = null;

        chartRef.current.appendBars(fresh);
        const futureMax = generateFutureBars(fresh[fresh.length - 1].date, MAX_PROJECTION_BARS);
        futureBarsRef.current = futureMax;
        chartRef.current.appendBars(futureMax);

        setStatus('scanning cycles…');
        const closesArr = fresh.map((b) => b.close);
        const [scan, trendArr] = await Promise.all([
          cycleScanner(closesArr, apiKey, { includeSpectrum: true }),
          detrendTrend(closesArr, apiKey),
        ]);
        if (cancelled) return;

        const filtered = filterAndSortPeaks(scan?.peaks ?? [], closesArr.length);
        setLoadedData({
          bars: fresh,
          peaks: filtered,
          spectrum: scan?.spectrum ?? [],
          cycleStart: scan?.cycleStart ?? 30,
          cycleResolution: scan?.cycleResolution ?? 1.0,
          trend: trendArr ?? [],
        });

        setStatus(`ready · ${fresh.length} bars · ${filtered.length} cycles detected`);
      } catch (e) {
        if (cancelled) return;
        setStatus('error', e instanceof QuotaError ? 'API quota exceeded' : e.message);
        console.error('[pipeline]', e);
      }
    })();
    return () => { cancelled = true; };
    // cycleLookback in deps: a Save in the settings dialog re-triggers the
    // pipeline (refetch + rescan), which is the user-visible contract.
    // lazyLoadBatchSize is propagated via setContext but doesn't need a
    // pipeline re-run on its own.
  }, [picked, apiKey, cycleLookback]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Push lazy-load batch-size changes to the datafeed without re-triggering
  // the data pipeline.
  useEffect(() => {
    if (datafeedRef.current) {
      datafeedRef.current.setContext({ batchSize: lazyLoadBatchSize });
    }
  }, [lazyLoadBatchSize]);

  // ─── Visible range follows projection slider (rAF-batched) ──────────────
  // After lazy-load, the chart's actual bar count exceeds `bars.length`
  // (scanner store holds only the cycle-analysis window). We compute the
  // visible-range indices from the chart's internal `barDataRows` so the
  // right edge stays anchored to "now + projection" regardless of how many
  // older bars have been lazy-loaded.
  useEffect(() => {
    if (!chartRef.current || bars.length === 0) return;
    const raf = requestAnimationFrame(() => {
      if (!chartRef.current) return;
      const total = chartRef.current.barDataRows().close.length;
      if (total === 0) return;
      // We pre-allocated MAX_PROJECTION_BARS future bars at chart-init.
      // "Now" = last historical bar index = total - 1 - MAX_PROJECTION_BARS.
      const nowIdx  = total - 1 - MAX_PROJECTION_BARS;
      const lastIdx = nowIdx + projectionBars;
      const histShown = Math.min(200, nowIdx + 1);
      const firstIdx  = Math.max(0, nowIdx - histShown + 1);
      chartRef.current.recordRange(firstIdx, lastIdx);
      chartRef.current.refreshAsync(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [bars, projectionBars]);

  // ─── Vertical "now" marker on each indicator pane ───────────────────────
  // Originally a DotShape pinned to (date, value), but the overlay-mode
  // visible-range remap repositions the composite line without moving the
  // shape, leaving the dot orphaned. A vertical line keyed only by date
  // stays correct in every mode and zoom level.
  const placeNowMarker = (ind, color) => {
    if (!ind?.pane || bars.length === 0) return null;
    const FC = window.FintaChart;
    try {
      const shape = new FC.VerticalLineShape();
      shape.locked = true;
      shape.hoverable = false;
      shape.selectable = false;
      const pt = new FC.DataPoint({ date: bars[bars.length - 1].date, value: 0 });
      if (Array.isArray(shape.points) && shape.points.length > 0) shape.points[0] = pt;
      else shape.points = [pt];
      // Style via theme accessor after construction so we don't pass a
      // possibly-malformed theme to the constructor.
      try {
        if (shape.theme) {
          const stroke = shape.theme.stroke || shape.theme;
          if (stroke) {
            stroke.strokeColor = color;
            stroke.width = 1;
            stroke.lineStyle = 'dash';
          }
        }
      } catch (_) { /* ignore theme errors */ }
      ind.pane.addShapes([shape]);
      return shape;
    } catch (e) {
      console.error('[placeNowMarker FAILED]', e);
      return null;
    }
  };

  // ─── Composite + CRSI recompute on selection / toggle changes ───────────
  useEffect(() => {
    if (!chartRef.current || bars.length === 0 || closes.length === 0) return;
    let cancelled = false;
    const totalBars = bars.length + MAX_PROJECTION_BARS;

    const { CompositeCycle, CrsiIndicator, SingleCycleIndicator } = getIndicatorClasses();

    // ── Indicator-data alignment ────────────────────────────────────────────
    // FintaChart indicators read positionally via `currentBar`. The indicator
    // data array must have length == chart.barDataRows().close.length and
    // its values must align to chart bars at the same indices.
    //
    // For composite + single cycles (pure sine math), we just call
    // `buildCompositeSeries(cycles, chartBarCount, frontPad)` — the offset
    // tells the formula that output index 0 corresponds to time `-frontPad`
    // in the scan's original frame. So the sine waves extend BACKWARD over
    // any lazy-loaded older bars without rescanning.
    //
    // For CRSI (server-computed), we re-fetch with the full available history
    // (the chart's `barDataRows` excluding the future-projection range). The
    // result aligns to chart bars [0..histLen-1]; we pad trailing NaN for
    // the projection range. CRSI is causal so values at the original-window
    // positions are unchanged.
    const chartBarCount = chartRef.current.barDataRows().close.length;
    const intendedLen   = bars.length + MAX_PROJECTION_BARS;
    const frontPad      = Math.max(0, chartBarCount - intendedLen);

    // Read the extended historical-only close series from the chart (used for
    // CRSI refetch — covers both the original analysis window AND any
    // lazy-loaded older bars, but excludes the future projection bars whose
    // close is NaN).
    const getExtendedHistoricalCloses = () => {
      const rows = chartRef.current.barDataRows();
      const total = rows.close.length;
      const histLen = total - MAX_PROJECTION_BARS;
      if (histLen <= 0) return [];
      const out = new Array(histLen);
      for (let i = 0; i < histLen; i++) out[i] = rows.close.value(i);
      return out;
    };

    // Pad a CRSI/UB/LB response with trailing NaN so it covers the
    // projection range (CRSI isn't forward-projectable — depends on real
    // prices). Output length = raw.length + MAX_PROJECTION_BARS.
    const padCrsiTrailing = (raw) => {
      const out = new Array((raw?.length ?? 0) + MAX_PROJECTION_BARS).fill(NaN);
      if (raw) for (let i = 0; i < raw.length; i++) out[i] = raw[i];
      return out;
    };

    const existing = chartRef.current.indicators ?? [];

    // Remove composite + CRSI indicators (always recreated below).
    // FintaChart 3.1.5+: Indicator.dispose() auto-removes a custom verticalScale
    // when _isCustomScale is set, so we don't have to clean up overlay-mode
    // scales by hand — removeIndicators() handles it via the dispose lifecycle.
    const compositeStale = existing.filter((i) => {
      const t = i?.constructor?.type;
      return t === 'CompositeCycle' || t === 'CycleCRSI';
    });
    if (compositeStale.length > 0) chartRef.current.removeIndicators(compositeStale);
    // Clear refs for the indicators we just removed so the lazy-load NaN
    // padder doesn't mutate stale instances.
    crsiIndRef.current = null;

    // Diff individual cycle panes — remove any whose cycle is no longer
    // pane-selected, leave the rest alone (avoids needless rebuild on every
    // composite-toggle), add any newly-selected.
    const existingSingleByLength = new Map();
    for (const ind of existing) {
      if (ind?.constructor?.type === 'SingleCycle' && ind._cycleLength != null) {
        existingSingleByLength.set(ind._cycleLength, ind);
      }
    }
    const toRemove = [];
    for (const [len, ind] of existingSingleByLength) {
      if (!paneSelected.has(len)) toRemove.push(ind);
    }
    if (toRemove.length > 0) chartRef.current.removeIndicators(toRemove);
    // Drop refs for removed single-cycle indicators so the lazy-load
    // padder doesn't touch them after dispose.
    for (const ind of toRemove) {
      if (ind?._cycleLength != null) singleCycleRefs.current.delete(ind._cycleLength);
    }

    if (showComposite && selectedCycles.length > 0) {
      // Two computations:
      //   - `rawAnalysisOnly` covers [analysis + projection], anchored at the
      //     scan's index 0. Used for correlation math and the scanner store.
      //     Stable across lazy-loads because it doesn't depend on frontPad.
      //   - `plotComposite` covers the FULL chart bar count with offset =
      //     frontPad so the sine waves extend backward over any
      //     already-lazy-loaded older bars (without rescanning).
      const rawAnalysisOnly = buildCompositeSeries(selectedCycles, totalBars, 0);
      const plotComposite = frontPad > 0
        ? buildCompositeSeries(selectedCycles, chartBarCount, frontPad)
        : rawAnalysisOnly;
      rawCompositeRef.current = rawAnalysisOnly;
      setComposite(rawAnalysisOnly);

      const ind = new CompositeCycle();
      ind._composite = plotComposite;

      // Composite always starts as a price-pane overlay with its own
      // auto-scaled left-side axis. Composite values (roughly -100..+100)
      // get their own left-side labels; price keeps the right-side axis.
      //
      // Users who want the composite in its own pane right-click on the
      // composite line → "Unmerge down" (FintaChart's built-in context-menu
      // item). The reverse — "Move to price pane" — was added in 3.1.7 and
      // auto-creates a VerticalScale with `leftAxisVisible = true` (same
      // shape as the manual setup below), so switching back and forth via
      // the right-click menu is lossless.
      //
      // Prior to 3.1.7 the demo app shipped a split-button placement
      // popover (own pane vs overlay) — superseded by the native context
      // menu. The popover pattern itself is still documented in the
      // cycle-charting skill (`ui-patterns.md`) for skill consumers who
      // need pre-add placement choice with persistence.
      //
      // NOTE: we tried the declarative `needsCustomScale()` protocol
      // (CompositeCycle returns true), which DID get FintaChart's pane
      // lifecycle to auto-create + bind a custom scale — but the
      // auto-created scale defaults to `leftAxisVisible: false` and
      // `rightAxisVisible: false`, so the user sees the composite on
      // price coordinates but no axis labels. Explicit creation +
      // visibility setup is clearer.
      const scale = chartRef.current.addVerticalScale();
      scale.leftAxisVisible  = true;     // composite axis on the left
      scale.rightAxisVisible = false;    // price keeps the right
      ind.bindToVerticalScale(scale);
      chartRef.current.primaryPane.addIndicator(ind);

      compositeIndRef.current = ind;
      placeNowMarker(ind, '#8b949e');

      const inSample = weightedInSampleCorrelation(rawAnalysisOnly, closes, closes.length);
      const visible = pearson(rawAnalysisOnly, closes, 0, closes.length - 1);
      setCorrelations({ inSampleCorr: inSample, visibleCorr: visible });
    } else {
      compositeIndRef.current = null;
      rawCompositeRef.current = null;
      setComposite([]);
      setCorrelations({ inSampleCorr: NaN, visibleCorr: NaN });
    }

    // Add per-cycle indicators for newly pane-selected cycles.
    // Each gets its own pane; the cycle length is baked into the name + plot.
    const PANE_PALETTE = ['#a78bfa', '#22d3ee', '#fbbf24', '#f472b6', '#34d399', '#fb923c', '#60a5fa', '#facc15'];
    const targetLengths = Array.from(paneSelected);
    targetLengths.forEach((len, i) => {
      if (existingSingleByLength.has(len)) return;   // already on the chart
      const peak = peaks.find((p) => p.cycleLength === len);
      if (!peak) return;
      const series = buildCompositeSeries([peak], totalBars);
      // Static "next" pre-set must happen BEFORE construction (FintaChart
      // re-runs onResetDefaults during addIndicators, clobbering post-set props).
      SingleCycleIndicator._nextLength = Math.round(len);
      SingleCycleIndicator._nextColor = PANE_PALETTE[i % PANE_PALETTE.length];
      const ind = new SingleCycleIndicator();
      ind._cycleLength = len;
      // If older bars were lazy-loaded before this indicator was created,
      // recompute over the full chart bar count with offset=frontPad so the
      // sine wave extends backward over those older bars.
      ind._cycleSeries = frontPad > 0
        ? buildCompositeSeries([peak], chartBarCount, frontPad)
        : series;
      chartRef.current.addIndicators(ind);
      placeNowMarker(ind, '#8b949e');
      // Track this single-cycle indicator so the lazy-load callback can
      // NaN-pad `_cycleSeries` when older bars arrive.
      singleCycleRefs.current.set(len, ind);
    });

    (async () => {
      if (!showCRSI || selectedCycles.length === 0) {
        setCrsiResp(null);
        return;
      }
      const len = autoCrsiLength(selectedCycles);
      if (!len || len < 5) { setCrsiResp(null); return; }
      try {
        // If older bars have been lazy-loaded already (frontPad > 0), fetch
        // CRSI over the EXTENDED close history so the line covers all
        // visible bars from the start. CRSI is causal — values at the
        // original-window positions are unchanged whether we include the
        // older bars or not.
        const fetchCloses = frontPad > 0 ? getExtendedHistoricalCloses() : closes;
        const version = ++crsiFetchVersion.current;
        const resp = await crsi(fetchCloses, len, apiKey);
        if (cancelled || version !== crsiFetchVersion.current) return;
        setCrsiResp(resp);
        // Pre-set the displayed period BEFORE construction so the settings
        // dialog shows the actual auto-derived period (rather than the
        // hard-coded 14 from onResetDefaults). FintaChart re-runs
        // onResetDefaults during addIndicators(), so post-construction
        // assignments to `period` are clobbered.
        CrsiIndicator._nextPeriod = Math.round(len);
        const ind = new CrsiIndicator();
        // resp.{crsi,ub,lb} have length == fetchCloses.length. Pad trailing
        // MAX_PROJECTION_BARS NaN so the array reaches the chart's full bar
        // count (CRSI isn't forward-projectable).
        ind._crsi = padCrsiTrailing(resp?.crsi);
        ind._ub   = padCrsiTrailing(resp?.ub);
        ind._lb   = padCrsiTrailing(resp?.lb);

        // ── Server-computed parameter sync ────────────────────────────────
        // When the user edits the CRSI period via FintaChart's settings
        // dialog, the indicator can't recompute itself (data comes from a
        // server endpoint). The indicator's onParameterUpdated override
        // forwards period-change events to this callback, which re-fetches
        // from /api/DSP/CRSI, replaces the data arrays, and force-recomputes
        // the indicator's cached values series.
        //
        // 300ms debounce — FintaChart's dialog commits on every keystroke
        // in number inputs; we don't want to hammer the API.
        // Also uses the SHARED `crsiFetchVersion` counter so a period change
        // in flight when a lazy-load fires (or vice-versa) discards the
        // earlier response.
        let periodRefetchTimer = null;
        ind._onPeriodChange = (newPeriod) => {
          if (!Number.isFinite(newPeriod) || newPeriod < 5) return;
          if (periodRefetchTimer) clearTimeout(periodRefetchTimer);
          periodRefetchTimer = setTimeout(async () => {
            if (!chartRef.current?.indicators?.includes?.(ind)) return;
            const refetchCloses = getExtendedHistoricalCloses();
            const version = ++crsiFetchVersion.current;
            try {
              const r2 = await crsi(refetchCloses, newPeriod, apiKey);
              if (version !== crsiFetchVersion.current) return;   // stale
              if (!chartRef.current?.indicators?.includes?.(ind)) return;
              ind._crsi = padCrsiTrailing(r2?.crsi);
              ind._ub   = padCrsiTrailing(r2?.ub);
              ind._lb   = padCrsiTrailing(r2?.lb);
              setCrsiResp(r2);
              // refreshAsync(true) only redraws using cached values;
              // refreshIndicators() forces onInputTick to re-run against
              // the freshly replaced arrays. See gotchas.md.
              chartRef.current.refreshIndicators?.();
              chartRef.current.refreshAsync?.(true);
            } catch (e) {
              console.error('[CRSI period refetch]', e);
            }
          }, 300);
        };

        chartRef.current.addIndicators(ind);
        placeNowMarker(ind, '#8b949e');
        // Track for lazy-load NaN padding.
        crsiIndRef.current = ind;
      } catch (e) { console.error('[CRSI]', e); }
    })();

    chartRef.current.refreshAsync(true);
    return () => { cancelled = true; };
  }, [selected, paneSelected, showComposite, showCRSI, bars, closes, apiKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  // (Removed in 3.1.6 refactor: an overlay-mode visible-range remap useEffect
  // that called mapCompositeToPriceRange() on every scroll/zoom with a 300ms
  // debounce. Replaced by `ind.bindToVerticalScale(chart.addVerticalScale())`
  // which auto-scales the composite to its own axis natively — no remap loop,
  // no debounce, no refreshIndicators() spam.)

  const sampleLabel = useMemo(() => {
    if (bars.length === 0) return '';
    const start = bars[0]?.date?.toISOString?.()?.slice(0, 10);
    const end = bars[bars.length - 1]?.date?.toISOString?.()?.slice(0, 10);
    return `${start} – ${end}  (${bars.length}/${projectionBars})`;
  }, [bars, projectionBars]);

  return (
    <div className="app">
      <div className="toolbar">
        <div className="brand-mark">
          <img className="logo" src="/fsc/logo-fsc-mark.png" alt="" />
          <span className="brand-name">Cycle Scanner</span>
        </div>

        <SymbolSearch apiKey={apiKey} onPick={setPicked} />

        {picked && (
          <div className="header-chips">
            {Number.isFinite(inSampleCorr) && (
              <span className="chip" style={{ backgroundColor: corrColor(inSampleCorr) }} title="in-sample correlation">
                {inSampleCorr.toFixed(2)}
              </span>
            )}
            {Number.isFinite(visibleCorr) && (
              <span className="chip" style={{ backgroundColor: corrColor(visibleCorr) }} title="visible-range correlation">
                {visibleCorr.toFixed(2)}
              </span>
            )}
            {selectedCycles.length > 0 && (
              <>
                <span className="chip-sep">·</span>
                {selectedCycles.map((c) => (
                  <span
                    key={c.cycleLength}
                    className="cycle-chip"
                    style={{ backgroundColor: phaseColorForPeak(c, false) }}
                    title={`amp ${c.amplitude?.toFixed(1)}  stab ${(c.stabilityScore * 100)?.toFixed(0)}%`}
                  >
                    C{Math.round(c.cycleLength)}
                  </span>
                ))}
                <span className="muted">(p: 0)</span>
              </>
            )}
            {(() => {
              const sid = picked?.symbolId ?? picked?.SymbolId ?? picked?.id;
              return sid ? (
                <span className="symbol-id" title="datafeed symbol ID">{sid}</span>
              ) : null;
            })()}
            {sampleLabel && <span className="sample-label">{sampleLabel}</span>}
          </div>
        )}

        <span className={`status ${error ? 'error' : ''}`}>{error || status}</span>
        <SettingsButton />
        <ThemeToggle theme={theme} onChange={onThemeChange} />
        <button className="logout-btn" onClick={onLogout} title="sign out · clears stored API key">
          ⏻
        </button>
      </div>

      <SettingsDialog />

      {/* IndicatorButtons render INTO FintaChart's own toolbar via portal
          (see chart-bootstrap effect — `toolbarSlot` is the <li> we appended
          to `chart.toolbar.container`). Mounted as soon as the slot exists,
          regardless of whether a symbol has been picked — that way the user
          can see the available indicators from the start and can pre-toggle
          them before loading a symbol. Toggling with no bars yet just
          updates store state; the composite-recompute effect is gated on
          `bars.length > 0` and will apply the toggles once data arrives. */}
      {toolbarSlot && createPortal(<IndicatorButtons />, toolbarSlot)}

      <div className="layout">
        <PanelGroup orientation="horizontal" id="scanner-h-layout" style={{ height: '100%' }}>
          <Panel defaultSize={70} minSize={30}>
            <PanelGroup orientation="vertical" id="scanner-v-layout" style={{ height: '100%' }}>
              <Panel defaultSize={70} minSize={30}>
                <div className="chart-pane">
                  <div id="chart-container" />
                  {!picked && (
                    <div className="chart-empty-hint">
                      Type in the symbol search above to pick an instrument
                    </div>
                  )}
                </div>
              </Panel>
              <PanelResizeHandle className="resize-handle horizontal" />
              <Panel defaultSize={30} minSize={15}>
                <div className="spectrum-pane">
                  <SpectrumChart />
                </div>
              </Panel>
            </PanelGroup>
          </Panel>
          <PanelResizeHandle className="resize-handle vertical" />
          <Panel defaultSize={30} minSize={20}>
            <div className="right-pane">
              <CyclesTable />
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
