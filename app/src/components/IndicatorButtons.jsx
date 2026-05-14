// Indicator toggles injected into FintaChart's own toolbar (via React portal
// from App.jsx into a custom <li> appended to ul.tcdToolbarNavTop).
//
// Two controls:
//   - Composite (split button) — sine-wave icon click toggles on/off;
//     ▾ caret opens a placement popover (own pane vs price overlay).
//   - Cyclic RSI (plain toggle) — oscillator icon, click to add/remove.
//
// The placement popover is itself rendered through a second portal to
// document.body with `position: fixed`. Without that, FintaChart's
// `tcdToolbar-scroll-wrapper` (which has `overflow: hidden` to support
// horizontal toolbar scrolling) clips the popover entirely — z-index alone
// can't escape the clip region. Coordinates come from the caret button's
// getBoundingClientRect and refresh on scroll/resize while open.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
function CaretIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <path d="M1,2.5 L4,6 L7,2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function IndicatorButtons() {
  const showComposite     = useScannerStore((s) => s.showComposite);
  const showCRSI          = useScannerStore((s) => s.showCRSI);
  const compositeMode     = useScannerStore((s) => s.compositeMode);
  const setShowComposite  = useScannerStore((s) => s.setShowComposite);
  const setShowCRSI       = useScannerStore((s) => s.setShowCRSI);
  const setCompositeMode  = useScannerStore((s) => s.setCompositeMode);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const splitRef = useRef(null);
  const caretRef = useRef(null);
  const popoverRef = useRef(null);

  // Position the popover under the caret button. `position: fixed` + viewport
  // coordinates from getBoundingClientRect — independent of any ancestor
  // overflow/transform/clip.
  const positionMenu = useCallback(() => {
    const r = caretRef.current?.getBoundingClientRect();
    if (!r) return;
    // Anchor under the caret, left-aligned. Nudge left by the button's width
    // so the popover sits under the *whole* split button, not just the caret.
    const splitR = splitRef.current?.getBoundingClientRect();
    const left = splitR ? splitR.left : r.left;
    setMenuPos({ top: r.bottom + 4, left });
  }, []);

  // Position before paint to avoid a flash at (0,0).
  useLayoutEffect(() => {
    if (menuOpen) positionMenu();
  }, [menuOpen, positionMenu]);

  // Keep position correct while open if the user scrolls / resizes.
  useEffect(() => {
    if (!menuOpen) return;
    const onChange = () => positionMenu();
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
    };
  }, [menuOpen, positionMenu]);

  // Close on outside click / Escape. mousedown so the popover dismisses
  // before any underlying control receives the click. Outside = not in the
  // split button AND not in the popover itself.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => {
      const inSplit   = splitRef.current?.contains(e.target);
      const inPopover = popoverRef.current?.contains(e.target);
      if (!inSplit && !inPopover) setMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <div className="ind-btn-group">
      <div className="ind-btn-split" ref={splitRef}>
        <button
          type="button"
          className={`ind-btn ind-btn-icon ind-btn-main ${showComposite ? 'is-on' : ''}`}
          onClick={() => setShowComposite(!showComposite)}
          title={showComposite
            ? `composite cycle on · ${compositeMode === 'pane' ? 'own pane' : 'price overlay'} · click to hide`
            : 'show composite cycle'}
          aria-label="toggle composite cycle"
          aria-pressed={showComposite}
        >
          <SineIcon />
        </button>
        <button
          ref={caretRef}
          type="button"
          className={`ind-btn ind-btn-caret ${showComposite ? 'is-on' : ''}`}
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="composite placement options"
          title="composite placement"
        >
          <CaretIcon />
        </button>
      </div>

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

      {menuOpen && createPortal(
        <div
          ref={popoverRef}
          className="ind-btn-popover"
          role="menu"
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
        >
          <div className="ind-btn-popover-title">Composite placement</div>
          <label className="ind-btn-radio">
            <input
              type="radio"
              name="compMode-toolbar"
              value="pane"
              checked={compositeMode === 'pane'}
              onChange={() => { setCompositeMode('pane'); setMenuOpen(false); }}
            />
            <span>Own pane</span>
          </label>
          <label className="ind-btn-radio">
            <input
              type="radio"
              name="compMode-toolbar"
              value="overlay"
              checked={compositeMode === 'overlay'}
              onChange={() => { setCompositeMode('overlay'); setMenuOpen(false); }}
            />
            <span>Price overlay</span>
          </label>
          <div className="ind-btn-popover-hint">
            overlay places the composite on the price pane with its own
            auto-scaled y-axis (left); own-pane stacks it below.
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
