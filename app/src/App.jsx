import { useEffect, useMemo, useRef, useState } from 'react';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
import LoginScreen from './components/LoginScreen.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import SymbolSearch from './SymbolSearch.jsx';
import { loadBars, cycleScanner, crsi, detrendTrend, isCloseOnly, QuotaError } from './api.js';
import { CycleToolsDatafeed } from './CycleToolsDatafeed.js';
import { getIndicatorClasses } from './indicators.js';
import {
  buildCompositeSeries,
  mapCompositeToPriceRange,
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

  // Keep theme in sync with FintaChart
  useEffect(() => {
    if (chartRef.current && window.FintaChart) {
      const next = theme === 'light' ? window.defaultTheme : window.fintatechDarkTheme;
      if (next) chartRef.current.theme = next;
    }
  }, [theme]);

  // ─── Chart bootstrap ────────────────────────────────────────────────────
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const FC = window.FintaChart;
    const initialTheme = theme === 'light' ? window.defaultTheme : window.fintatechDarkTheme;
    const container = document.getElementById('chart-container');

    const datafeed = new CycleToolsDatafeed();
    datafeedRef.current = datafeed;

    const chart = FC.createChart(container, {
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
        // Update the chart's instrument label so the toolbar shows the picked symbol.
        chartRef.current.instrument = {
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

  // ─── Place a small dot on an indicator's pane at the last historical bar ─
  // FintaChart's PointPlot.Style.DOT renders as a vertical tick line through
  // addPlot(), not an actual dot. Use a DotShape positioned at (date, value).
  const placeNowDot = (ind, color, value) => {
    if (!ind?.pane || !Number.isFinite(value) || bars.length === 0) return null;
    const FC = window.FintaChart;
    try {
      const shape = new FC.DotShape({
        radius: 3,
        theme: { fillColor: color, strokeColor: color },
        locked: true, hoverable: false, selectable: false,
      });
      const pt = new FC.DataPoint({
        date: bars[bars.length - 1].date,
        value,
      });
      if (Array.isArray(shape.points) && shape.points.length > 0) shape.points[0] = pt;
      else shape.points = [pt];
      ind.pane.addShapes([shape]);
      return shape;
    } catch (e) {
      console.warn('[placeNowDot]', e);
      return null;
    }
  };

  // ─── Composite + CRSI recompute on selection / toggle changes ───────────
  useEffect(() => {
    if (!chartRef.current || bars.length === 0 || closes.length === 0) return;
    let cancelled = false;
    const totalBars = bars.length + MAX_PROJECTION_BARS;

    const { CompositeCyclePane, CompositeCycleOverlay, CrsiIndicator, SingleCycleIndicator, COMPOSITE_TYPES } = getIndicatorClasses();

    const existing = chartRef.current.indicators ?? [];

    // Remove composite + CRSI indicators (always recreated below).
    const compositeStale = existing.filter((i) => {
      const t = i?.constructor?.type;
      return COMPOSITE_TYPES.has(t) || t === 'CycleCRSI';
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
      const series = compositeMode === 'overlay'
        ? mapCompositeToPriceRange(raw, closes.slice(-500), { fillFraction: 0.6 })
        : Array.from(raw);
      setComposite(series);

      const Klass = compositeMode === 'overlay' ? CompositeCycleOverlay : CompositeCyclePane;
      const ind = new Klass();
      ind._composite = series;
      chartRef.current.addIndicators(ind);
      compositeIndRef.current = ind;
      placeNowDot(ind, '#ec4899', series[bars.length - 1]);

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
      placeNowDot(ind, PANE_PALETTE[i % PANE_PALETTE.length], series[bars.length - 1]);
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
        placeNowDot(ind, '#e6edf3', (resp?.crsi ?? [])[bars.length - 1]);
      } catch (e) { console.error('[CRSI]', e); }
    })();

    chartRef.current.refreshAsync(true);
    return () => { cancelled = true; };
  }, [selected, paneSelected, showComposite, showCRSI, compositeMode, bars, closes, apiKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Overlay-mode auto-fit: remap composite when visible range changes ───
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (compositeMode !== 'overlay') return;
    const FC = window.FintaChart;

    // CRITICAL PERF NOTE: each remap calls chart.refreshIndicators(), which
    // recalculates EVERY indicator on the chart (composite + CRSI + any built-in
    // the user added like Stoch RSI). With Stoch RSI on 12k bars that's slow.
    // We debounce by 300ms — a continuous scroll fires the heavy refresh only
    // once at the end, not 60×/sec during the drag.
    const doRemap = () => {
      const ind = compositeIndRef.current;
      const raw = rawCompositeRef.current;
      if (!ind || !raw || closes.length === 0) return;
      const first = Math.max(0, Math.floor(chart.firstVisibleRecord ?? 0));
      const last  = Math.min(closes.length - 1, Math.ceil(chart.lastVisibleRecord ?? closes.length - 1));
      const visible = closes.slice(first, last + 1).filter(Number.isFinite);
      if (visible.length < 5) return;
      const next = mapCompositeToPriceRange(raw, visible, { fillFraction: 0.6 });
      ind._composite = next;
      chart.refreshIndicators();
      chart.refreshAsync();
    };

    let timer = 0;
    const remapDebounced = () => {
      clearTimeout(timer);
      timer = setTimeout(doRemap, 300);
    };

    chart.on(FC.ChartEvent.LAST_VISIBLE_RECORD_CHANGED,  remapDebounced);
    chart.on(FC.ChartEvent.FIRST_VISIBLE_RECORD_CHANGED, remapDebounced);
    doRemap();   // initial alignment fires immediately, no debounce
    return () => {
      clearTimeout(timer);
      try {
        chart.off?.(FC.ChartEvent.LAST_VISIBLE_RECORD_CHANGED,  remapDebounced);
        chart.off?.(FC.ChartEvent.FIRST_VISIBLE_RECORD_CHANGED, remapDebounced);
      } catch (_) {}
    };
  }, [compositeMode, closes, selected, showComposite]);

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
