// Settings dialog — gear-icon entry point in the toolbar opens this modal.
// Lets the user configure persistent knobs that survive reloads (stored in
// localStorage via useSettingsStore):
//
//   - Cycle scanner lookback (number of bars fed to /api/cycles/CycleScanner)
//   - Forward projection bars (how far past the latest bar to draw the
//     composite cycle line)
//   - Lazy-load batch size (bars fetched per scroll-left request)
//
// Saving the lookback triggers a re-fetch + re-scan in App.jsx (the data
// pipeline watches `cycleLookback`). The other two settings update live
// without re-fetching.
//
// UX:
//   - Modal centered, backdrop click + Escape close without saving
//   - Cancel = discard local edits; Save = applySettings (one localStorage
//     write); Reset = restore documented defaults
//   - Per-field hint shows valid range from SETTINGS_BOUNDS

import { useEffect, useRef, useState } from 'react';
import { useSettingsStore, SETTINGS_BOUNDS, DEFAULT_SETTINGS } from '../state/useSettingsStore.js';

export default function SettingsDialog() {
  const open               = useSettingsStore((s) => s.settingsOpen);
  const closeSettings      = useSettingsStore((s) => s.closeSettings);
  const cycleLookback      = useSettingsStore((s) => s.cycleLookback);
  const projectionBars     = useSettingsStore((s) => s.projectionBars);
  const lazyLoadBatchSize  = useSettingsStore((s) => s.lazyLoadBatchSize);
  const applySettings      = useSettingsStore((s) => s.applySettings);
  const resetToDefaults    = useSettingsStore((s) => s.resetToDefaults);

  // Local draft state — only commits to the store on Save.
  const [draft, setDraft] = useState({
    cycleLookback, projectionBars, lazyLoadBatchSize,
  });

  // Sync draft from store when modal (re)opens so reopening always shows
  // current persisted values, not stale draft from a cancelled session.
  useEffect(() => {
    if (open) setDraft({ cycleLookback, projectionBars, lazyLoadBatchSize });
  }, [open, cycleLookback, projectionBars, lazyLoadBatchSize]);

  // Escape closes; focus trapped to the first field on open.
  const firstFieldRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') closeSettings(); };
    window.addEventListener('keydown', onKey);
    firstFieldRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeSettings]);

  if (!open) return null;

  const onSave = () => {
    applySettings(draft);
    closeSettings();
  };

  const onReset = () => {
    setDraft({ ...DEFAULT_SETTINGS });
  };

  const field = (key, label, hint) => {
    const b = SETTINGS_BOUNDS[key];
    return (
      <div className="settings-field" key={key}>
        <label htmlFor={`settings-${key}`}>{label}</label>
        <input
          ref={key === 'cycleLookback' ? firstFieldRef : null}
          id={`settings-${key}`}
          type="number"
          min={b.min}
          max={b.max}
          step={b.step}
          value={draft[key]}
          onChange={(e) => {
            const n = Number(e.target.value);
            setDraft((d) => ({ ...d, [key]: Number.isFinite(n) ? n : d[key] }));
          }}
        />
        <span className="settings-hint">
          {hint} <span className="settings-range">({b.min}–{b.max})</span>
        </span>
      </div>
    );
  };

  return (
    <div
      className="settings-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeSettings(); }}
    >
      <div className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="settings-header">
          <h2 id="settings-title">Settings</h2>
          <button
            className="settings-close"
            onClick={closeSettings}
            title="close (esc)"
            aria-label="close settings"
          >
            ×
          </button>
        </div>

        <div className="settings-body">
          {field(
            'cycleLookback',
            'Cycle scanner lookback (bars)',
            'Bars fed to CycleScanner. 850 is the API default.',
          )}
          {field(
            'projectionBars',
            'Forward projection (bars)',
            'How far past the latest bar to draw the composite cycle.',
          )}
          {field(
            'lazyLoadBatchSize',
            'Lazy-load batch size (bars)',
            'Bars fetched each time you scroll past loaded history.',
          )}
        </div>

        <div className="settings-footer">
          <button className="settings-reset" onClick={onReset} type="button">
            Reset defaults
          </button>
          <div className="settings-actions">
            <button className="settings-cancel" onClick={closeSettings} type="button">
              Cancel
            </button>
            <button className="settings-save" onClick={onSave} type="button">
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
