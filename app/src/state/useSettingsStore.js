// Persistent user settings — survive page reloads via localStorage.
//
// Distinct from useScannerStore (which holds per-session state like the
// currently picked symbol, loaded bars, peaks). These knobs are the user's
// preferences and should persist across sessions.
//
// Storage key: `cycletools.settings` (single JSON blob). Each load merges
// with DEFAULTS so adding a new field in code doesn't require a migration.

import { create } from 'zustand';

const STORAGE_KEY = 'cycletools.settings';

// Defaults match the cycle-tools-api skill recommendations:
//   - cycleLookback: 850 — the documented default for CycleScanner's `barCount`
//     parameter (skills/cycle-tools-api/references/endpoints.md:234). Enough
//     cycle repetitions for stable spectral analysis without being excessive.
//   - projectionBars: 300 — moderate forward projection; max 500.
//   - lazyLoadBatchSize: 500 — bars per scroll-left request. Balances API
//     round-trips vs. payload size.
export const DEFAULT_SETTINGS = {
  cycleLookback: 850,
  projectionBars: 300,
  lazyLoadBatchSize: 500,
};

// Bounds — keep cycle scanner above its 100-bar minimum + some margin.
export const SETTINGS_BOUNDS = {
  cycleLookback:     { min: 200,  max: 5000, step: 50 },
  projectionBars:    { min: 0,    max: 500,  step: 10 },
  lazyLoadBatchSize: { min: 100,  max: 2000, step: 50 },
};

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val | 0));
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      cycleLookback:     clamp(parsed.cycleLookback     ?? DEFAULT_SETTINGS.cycleLookback,
                               SETTINGS_BOUNDS.cycleLookback.min, SETTINGS_BOUNDS.cycleLookback.max),
      projectionBars:    clamp(parsed.projectionBars    ?? DEFAULT_SETTINGS.projectionBars,
                               SETTINGS_BOUNDS.projectionBars.min, SETTINGS_BOUNDS.projectionBars.max),
      lazyLoadBatchSize: clamp(parsed.lazyLoadBatchSize ?? DEFAULT_SETTINGS.lazyLoadBatchSize,
                               SETTINGS_BOUNDS.lazyLoadBatchSize.min, SETTINGS_BOUNDS.lazyLoadBatchSize.max),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveToStorage(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      cycleLookback:     state.cycleLookback,
      projectionBars:    state.projectionBars,
      lazyLoadBatchSize: state.lazyLoadBatchSize,
    }));
  } catch {
    // Quota exceeded or storage disabled — silently fall back to in-memory only.
  }
}

export const useSettingsStore = create((set, get) => ({
  ...loadFromStorage(),

  // Modal visibility kept here so the gear button + dialog don't need their
  // own intermediate state.
  settingsOpen: false,
  openSettings:  () => set({ settingsOpen: true  }),
  closeSettings: () => set({ settingsOpen: false }),

  setCycleLookback: (n) => {
    const b = SETTINGS_BOUNDS.cycleLookback;
    const next = clamp(n, b.min, b.max);
    set({ cycleLookback: next });
    saveToStorage({ ...get(), cycleLookback: next });
  },
  setProjectionBars: (n) => {
    const b = SETTINGS_BOUNDS.projectionBars;
    const next = clamp(n, b.min, b.max);
    set({ projectionBars: next });
    saveToStorage({ ...get(), projectionBars: next });
  },
  setLazyLoadBatchSize: (n) => {
    const b = SETTINGS_BOUNDS.lazyLoadBatchSize;
    const next = clamp(n, b.min, b.max);
    set({ lazyLoadBatchSize: next });
    saveToStorage({ ...get(), lazyLoadBatchSize: next });
  },

  // Bulk update from the settings dialog's "Save" button. Single localStorage
  // write rather than three.
  applySettings: (patch) => {
    const cur = get();
    const next = {
      cycleLookback:     clamp(patch.cycleLookback     ?? cur.cycleLookback,
                               SETTINGS_BOUNDS.cycleLookback.min,     SETTINGS_BOUNDS.cycleLookback.max),
      projectionBars:    clamp(patch.projectionBars    ?? cur.projectionBars,
                               SETTINGS_BOUNDS.projectionBars.min,    SETTINGS_BOUNDS.projectionBars.max),
      lazyLoadBatchSize: clamp(patch.lazyLoadBatchSize ?? cur.lazyLoadBatchSize,
                               SETTINGS_BOUNDS.lazyLoadBatchSize.min, SETTINGS_BOUNDS.lazyLoadBatchSize.max),
    };
    set(next);
    saveToStorage(next);
  },

  resetToDefaults: () => {
    set(DEFAULT_SETTINGS);
    saveToStorage(DEFAULT_SETTINGS);
  },
}));
