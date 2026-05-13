import { useEffect, useMemo, useRef, useState } from 'react';
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
import { phaseColorForPeak } from './utils/phaseColor.js';
import CyclesTable from './components/CyclesTable.jsx';
import SpectrumChart from './components/SpectrumChart.jsx';
import IndicatorPanel from './components/IndicatorPanel.jsx';

const STORAGE_KEY = 'cycletools.apiKey';
const THEME_KEY = 'cycletools.theme';
const MAX_PROJECTION_BARS = 500;

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
  const compositeMode  = useScannerStore((s) => s.compositeMode);
  const projectionBars = useScannerStore((s) => s.projectionBars);
  const inSampleCorr   = useScannerStore((s) => s.inSampleCorr);
  const visibleCorr    = useScannerStore((s) => s.visibleCorr);
  const setComposite   = useScannerStore((s) => s.setComposite);
  const setCrsiResp    = useScannerStore((s) => s.setCrsiResp);
  const setCorrelations = useScannerStore((s) => s.setCorrelations);

  const selectedCycles = useMemo(
    () => peaks.filter((p) => selected.has(p.cycleLength)),
    [peaks, selected],
  );

  const chartRef = useRef(null);
  const datafeedRef = useRef(null);
  const initRef = useRef(false);
  const compositeIndRef = useRef(null);
  const rawCompositeRef = useRef(null);

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

    // The toolbar modal's internal client-filter (InstrumentSearch's
    // generateSearchResults + normalizeSymbolForSearch + searchTextPositions)
    // only matches the user's query against `result.symbol` substring — NOT
    // against `result.company`. So when a consumer's backend (like the
    // cycle-tools-api) returns Apple-related results whose symbols are
    // AAPL / 0R2V / 603020 / etc., typing "Apple" finds nothing — even
    // though the company field clearly contains "Apple Inc".
    //
    // Workaround: in `filter`, AUGMENT the symbol with the company text
    // so the modal's substring match passes. In `filterById` (called when
    // the user picks a result), return the CLEAN symbol so the chart's
    // toolbar label shows just the ticker after selection.
    //
    // We cache the clean version in `lastResults` so filterById can hand
    // it back without re-hitting the API.
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
        // Augment the symbol field for the modal's substring filter.
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
      if (hit) return hit;          // CLEAN — un-augmented symbol
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
      barsCount: 800,
      supportedTimeFrames: ['1 Day', '1 Week', '1 Month'],
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

    // Tell FintaChart to relayout when its container changes size — fixes the
    // "chart doesn't fill the pane after the user drags a resize handle" bug.
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

    return () => {
      cancelAnimationFrame(resizeRaf);
      try { ro.disconnect(); } catch (_) {}
      try { chart.off?.(FC.ChartEvent.INSTRUMENT_CHANGED, onInstrumentChanged); } catch (_) {}
      try { chart.dispose(); } catch (_) {}
      chartRef.current = null;
      datafeedRef.current = null;
      initRef.current = false;
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Pipeline: load bars → scan → trend ──────────────────────────────────
  useEffect(() => {
    if (!picked || !apiKey || !chartRef.current) return;
    let cancelled = false;
    setStatus('loading bars…');

    (async () => {
      try {
        const fresh = await loadBars(picked.symbolId ?? picked.SymbolId, apiKey);
        if (cancelled) return;
        if (!fresh || fresh.length < 100) {
          throw new Error(`Only ${fresh?.length ?? 0} bars returned (minimum 100).`);
        }

        datafeedRef.current.setBars(fresh);
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
        chartRef.current.appendBars(fresh);
        const futureMax = generateFutureBars(fresh[fresh.length - 1].date, MAX_PROJECTION_BARS);
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
  }, [picked, apiKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Visible range follows projection slider (rAF-batched) ──────────────
  useEffect(() => {
    if (!chartRef.current || bars.length === 0) return;
    const raf = requestAnimationFrame(() => {
      if (!chartRef.current) return;
      const histShown = Math.min(200, bars.length);
      const lastIdx = bars.length + projectionBars - 1;
      chartRef.current.recordRange(bars.length - histShown, lastIdx);
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

    if (showComposite && selectedCycles.length > 0) {
      const raw = buildCompositeSeries(selectedCycles, totalBars);
      rawCompositeRef.current = raw;
      setComposite(raw);

      const ind = new CompositeCycle();
      ind._composite = raw;       // raw composite — no more mapCompositeToPriceRange fakery

      if (compositeMode === 'overlay') {
        // FintaChart 3.1.5+: properly overlay on the price pane with the
        // composite's OWN auto-scaled y-axis. The composite values
        // (roughly -100..+100) get their own left-side axis labels; price
        // keeps the right-side axis. No more value-range remap, no more
        // visible-range remap loop, no more debounced refreshIndicators().
        const scale = chartRef.current.addVerticalScale();
        scale.leftAxisVisible  = true;     // composite axis on the left
        scale.rightAxisVisible = false;    // price keeps the right
        ind.bindToVerticalScale(scale);
        chartRef.current.primaryPane.addIndicator(ind);
      } else {
        // Own pane below price. NOTE: the 3.1.6-documented helper
        // `chart.addIndicatorInNewPane(ind)` is buggy at runtime — it
        // crashes inside `initPaneTitle` with
        // `Cannot read properties of null (reading 'appendChild')`
        // (verified empirically against `@fintatech/fintachart@3.1.6`).
        // Fall back to the standard `chart.addIndicators(ind)` which
        // uses `ind.isOverlay = false` (set in CompositeCycle's
        // onResetDefaults) to place the indicator in a new pane — same
        // result, no crash.
        chartRef.current.addIndicators(ind);
      }

      compositeIndRef.current = ind;
      placeNowMarker(ind, '#8b949e');

      const inSample = weightedInSampleCorrelation(raw, closes, closes.length);
      const visible = pearson(raw, closes, 0, closes.length - 1);
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
      ind._cycleSeries = Array.from(series);
      chartRef.current.addIndicators(ind);
      placeNowMarker(ind, '#8b949e');
    });

    (async () => {
      if (!showCRSI || selectedCycles.length === 0) {
        setCrsiResp(null);
        return;
      }
      const len = autoCrsiLength(selectedCycles);
      if (!len || len < 5) { setCrsiResp(null); return; }
      try {
        const resp = await crsi(closes, len, apiKey);
        if (cancelled) return;
        setCrsiResp(resp);
        const ind = new CrsiIndicator();
        ind._crsi = resp?.crsi ?? [];
        ind._ub   = resp?.ub   ?? [];
        ind._lb   = resp?.lb   ?? [];
        chartRef.current.addIndicators(ind);
        placeNowMarker(ind, '#8b949e');
      } catch (e) { console.error('[CRSI]', e); }
    })();

    chartRef.current.refreshAsync(true);
    return () => { cancelled = true; };
  }, [selected, paneSelected, showComposite, showCRSI, compositeMode, bars, closes, apiKey]);   // eslint-disable-line react-hooks/exhaustive-deps

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
          <span className="dot" />
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
            {sampleLabel && <span className="sample-label">{sampleLabel}</span>}
          </div>
        )}

        <span className={`status ${error ? 'error' : ''}`}>{error || status}</span>
        <ThemeToggle theme={theme} onChange={onThemeChange} />
        <button className="logout-btn" onClick={onLogout} title="sign out · clears stored API key">
          ⏻
        </button>
      </div>

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
              <IndicatorPanel />
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
