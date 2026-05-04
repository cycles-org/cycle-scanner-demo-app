// Zustand store — single source of truth for the scanner UI.
// Holds raw data (bars, peaks, spectrum), user selections, derived series, and toggles.

import { create } from 'zustand';

export const useScannerStore = create((set, get) => ({
  // ─── Raw data ────────────────────────────────────────────────────────────
  picked: null,                  // SearchSymbols result currently displayed
  bars: [],                      // IBar[]
  closes: [],                    // close prices, derived
  peaks: [],                     // CycleScanner peaks (filtered + sorted)
  spectrum: [],                  // raw spectrum array (period → amplitude)
  cycleStart: 30,                // spectrum x-axis start
  cycleResolution: 1.0,
  trend: [],                     // HP-detrend trend component (for reference)
  status: 'idle',
  error: '',

  // ─── User selections ─────────────────────────────────────────────────────
  selected: new Set(),           // Set<cycleLength> of cycles in the composite
  paneSelected: new Set(),       // Set<cycleLength> of cycles to render in their own pane
  showComposite: true,
  showCRSI: false,
  compositeMode: 'pane',         // 'pane' (own auto-scaled pane) | 'overlay' (mapped onto price)
  projectionBars: 300,

  // ─── Derived ─────────────────────────────────────────────────────────────
  composite: [],                 // mapped to price range, length = bars.length + projection
  crsiResp: null,                // { crsi, ub, lb } — recomputed when selected changes
  inSampleCorr: NaN,
  visibleCorr: NaN,

  // ─── Actions ─────────────────────────────────────────────────────────────
  setStatus: (s, err = '') => set({ status: s, error: err }),
  setPicked: (p) => set({ picked: p }),

  setLoadedData: ({ bars, peaks, spectrum, cycleStart, cycleResolution, trend }) =>
    set({
      bars,
      closes: bars.map((b) => b.close),
      peaks,
      spectrum: spectrum ?? [],
      cycleStart: cycleStart ?? 30,
      cycleResolution: cycleResolution ?? 1.0,
      trend: trend ?? [],
      // Auto-select the rank-1 dominant cycle if available, else the top by stability.
      selected: (() => {
        const next = new Set();
        const top = peaks.find((p) => p.dominantRank === 1) ?? peaks[0];
        if (top) next.add(top.cycleLength);
        return next;
      })(),
      paneSelected: new Set(),    // reset per-cycle pane selection on new symbol
    }),

  toggleSelected: (cycleLength) =>
    set((s) => {
      const next = new Set(s.selected);
      if (next.has(cycleLength)) next.delete(cycleLength);
      else next.add(cycleLength);
      return { selected: next };
    }),

  togglePaneSelected: (cycleLength) =>
    set((s) => {
      const next = new Set(s.paneSelected);
      if (next.has(cycleLength)) next.delete(cycleLength);
      else next.add(cycleLength);
      return { paneSelected: next };
    }),

  clearSelected: () => set({ selected: new Set() }),
  clearPaneSelected: () => set({ paneSelected: new Set() }),

  setComposite: (composite) => set({ composite }),
  setCrsiResp: (crsiResp) => set({ crsiResp }),
  setCorrelations: ({ inSampleCorr, visibleCorr }) =>
    set((s) => ({
      inSampleCorr: inSampleCorr ?? s.inSampleCorr,
      visibleCorr: visibleCorr ?? s.visibleCorr,
    })),

  setShowComposite: (v) => set({ showComposite: v }),
  setShowCRSI: (v) => set({ showCRSI: v }),
  setCompositeMode: (m) => set({ compositeMode: m === 'overlay' ? 'overlay' : 'pane' }),
  setProjectionBars: (n) => set({ projectionBars: Math.max(0, Math.min(500, n | 0)) }),

  reset: () =>
    set({
      bars: [], closes: [], peaks: [], spectrum: [], trend: [],
      selected: new Set(), composite: [], crsiResp: null,
      inSampleCorr: NaN, visibleCorr: NaN,
      status: 'idle', error: '',
    }),
}));

// NOTE: do NOT export a `selectSelectedCycles` selector that returns a fresh
// .filter()'d array each call — Zustand's useSyncExternalStore-based subscription
// will trip "getSnapshot should be cached to avoid an infinite loop". Compute
// the derived list with useMemo() in the consumer instead, against primitive
// `peaks` + `selected` slices.
