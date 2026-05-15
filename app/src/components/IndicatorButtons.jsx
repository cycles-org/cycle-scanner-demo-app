// Indicator toggles injected into FintaChart's own toolbar (via React portal
// from App.jsx into a custom <li> appended to ul.tcdToolbarNavTop).
//
// Two plain icon toggles:
//   - Composite (sine-wave icon) — click to add/remove. Always added as a
//     price-pane overlay with its own left-side auto-scaled axis. Users
//     change placement via FintaChart 3.1.7's built-in right-click context
//     menu ("Unmerge down" / "Move to price pane"), not via a custom UI.
//   - Cyclic RSI (oscillator icon) — plain on/off toggle in its own pane.
//
// The split-button placement popover this component used to ship (caret +
// portal-to-body popover with "own pane" / "overlay" radios) was retired
// once FC 3.1.7 added "Move to price pane" as a native context-menu item.
// The portal-popover pattern is still useful for skill consumers; see
// `cycle-charting/references/ui-patterns.md` for the documented recipe.

import { useScannerStore } from '../state/useScannerStore.js';

// ─── Inline SVG icons (matches FintaChart's toolbar SVG aesthetic) ────────
// `currentColor` lets the buttons inherit their themed text/accent colour
// from .ind-btn / .ind-btn.is-on.
function SineIcon() {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
      <path
        d="M1,7 Q3.5,1.5 6,7 T11,7 T15,7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function OscillatorIcon() {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
      {/* upper + lower band */}
      <line x1="1" y1="3"  x2="15" y2="3"  stroke="currentColor" strokeWidth="0.8" strokeDasharray="1.5 1.5" opacity="0.55" />
      <line x1="1" y1="11" x2="15" y2="11" stroke="currentColor" strokeWidth="0.8" strokeDasharray="1.5 1.5" opacity="0.55" />
      {/* oscillator wave bouncing between bands */}
      <path
        d="M1,9 Q3.5,4 6,9 T11,5 T15,9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function IndicatorButtons() {
  const showComposite     = useScannerStore((s) => s.showComposite);
  const showCRSI          = useScannerStore((s) => s.showCRSI);
  const setShowComposite  = useScannerStore((s) => s.setShowComposite);
  const setShowCRSI       = useScannerStore((s) => s.setShowCRSI);

  return (
    <div className="ind-btn-group">
      <button
        type="button"
        className={`ind-btn ind-btn-icon ${showComposite ? 'is-on' : ''}`}
        onClick={() => setShowComposite(!showComposite)}
        title={showComposite
          ? 'composite cycle on · right-click the line to move to own pane'
          : 'show composite cycle (price-pane overlay)'}
        aria-label="toggle composite cycle"
        aria-pressed={showComposite}
      >
        <SineIcon />
      </button>

      <button
        type="button"
        className={`ind-btn ind-btn-icon ${showCRSI ? 'is-on' : ''}`}
        onClick={() => setShowCRSI(!showCRSI)}
        title={showCRSI ? 'hide Cyclic RSI' : 'show Cyclic RSI'}
        aria-label="toggle Cyclic RSI"
        aria-pressed={showCRSI}
      >
        <OscillatorIcon />
      </button>
    </div>
  );
}
