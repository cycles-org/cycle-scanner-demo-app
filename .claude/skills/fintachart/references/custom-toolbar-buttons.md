# FintaChart — Custom Toolbar Buttons

How to add your own buttons (indicator toggles, layout pickers, theme controls — anything app-specific) into FintaChart's built-in top toolbar, next to the native buttons. Grounded in 3.1.6 and verified end-to-end on a Vite + React 18 host.

## Why this is non-trivial

FintaChart 3.1.6 exposes **no public API** for adding toolbar buttons. The `Toolbar` class (d.ts:6000) has a `container` getter and a `getBottomToolbarRightSide()` helper, but every method that adds, removes, or arranges buttons is `private` (`_controls`, `_createPeriodicityForm`, `subscribeEvents`, …). The toolbar markup is a fixed HTML template (`htmldialogs/Toolbar.html`) fetched **asynchronously** after `new FC.Chart()` returns.

The supported path is DOM injection into `chart.toolbar.container > ul.tcdToolbar.tcdToolbarNavTop`, with three subtle problems to solve:

1. **Async template load.** A synchronous probe right after `new FC.Chart()` finds the container but not the `<ul>` yet. Need bounded retry.
2. **FintaChart re-renders the toolbar** on theme switch, timeframe change, and i18n reload — every one of those replaces child nodes and wipes any custom slot. Need a `MutationObserver` to re-inject.
3. **Popovers anchored to your injected buttons get clipped** by `tcdToolbar-scroll-wrapper { overflow: hidden }` (FintaChart uses this for horizontal toolbar scroll). z-index alone can't escape a clip region — popovers must be portaled to `document.body` with `position: fixed`.

Filed as feedback item (i) for the next maintainer round: a public `chart.toolbar.addButton(config)` or even just `chart.toolbar.appendCustomSlot(): HTMLElement` would obsolete this entire pattern.

## Step 1 — Inject a slot `<li>` into FintaChart's toolbar

```js
// Inside your chart-bootstrap effect, AFTER `new FC.Chart()`:

let slotEl = null;
let toolbarObserver = null;
let retryTimer = null;
let disposed = false;
const SLOT_CLASS = 'my-toolbar-slot';     // pick anything stable

const ensureSlot = () => {
  if (disposed) return;
  const toolbarRoot = chart.toolbar?.container;
  const ul = toolbarRoot?.querySelector('ul.tcdToolbar.tcdToolbarNavTop');
  if (!ul) return;                           // template not loaded yet
  if (slotEl && ul.contains(slotEl)) return; // already injected

  slotEl = document.createElement('li');
  slotEl.className = SLOT_CLASS;
  // Position right after the built-in "add indicators" button so your
  // custom-indicator toggles group naturally with the native one. Adjust
  // the anchor selector to suit your placement intent.
  const anchor = ul.querySelector('.tcdToolbar-btn-indicators');
  if (anchor && anchor.parentNode === ul) {
    ul.insertBefore(slotEl, anchor.nextSibling);
  } else {
    ul.appendChild(slotEl);
  }
  // Hand the slot to React (or whatever mounting layer you use).
  onSlotReady(slotEl);

  if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
};

// Try synchronously, then poll briefly (toolbar template is async).
ensureSlot();
if (!slotEl) {
  let retries = 0;
  retryTimer = setInterval(() => {
    if (disposed || retries++ >= 25) { clearInterval(retryTimer); retryTimer = null; return; }
    ensureSlot();
  }, 200);   // 25 × 200ms = 5s upper bound
}

// Watch a stable ancestor so theme-driven full-toolbar re-renders
// (which can replace the chart.toolbar.container element wholesale)
// are still caught.
const observeRoot = container.parentElement || container;
toolbarObserver = new MutationObserver(() => ensureSlot());
toolbarObserver.observe(observeRoot, { childList: true, subtree: true });

// Cleanup on chart dispose:
return () => {
  disposed = true;
  toolbarObserver?.disconnect();
  if (retryTimer) clearInterval(retryTimer);
  slotEl?.parentNode?.removeChild(slotEl);
  // ... your existing chart.dispose() etc. ...
};
```

**Why observe `container.parentElement` and not `chart.toolbar.container` directly:** the latter element can be replaced wholesale on theme reload, invalidating your observer. The chart container's parent is stable across FintaChart's internal re-renders.

**Why `childList: true, subtree: true`:** the re-render mutates deep inside the subtree (children of `ul.tcdToolbarNavTop`), not just at the immediate parent.

## Step 2 — Mount your component with `createPortal`

If your host is React, use `createPortal` to render into the injected `<li>`. The slot is a regular DOM element so any framework's portal/mount-into-element primitive works (Vue `Teleport`, Svelte `<svelte:portal>`, etc.).

```jsx
import { useState } from 'react';
import { createPortal } from 'react-dom';

function App() {
  const [toolbarSlot, setToolbarSlot] = useState(null);

  useEffect(() => {
    // ... bootstrap chart, run the ensureSlot dance from Step 1 ...
    // Inside ensureSlot, call setToolbarSlot(slotEl).
  }, []);

  return (
    <>
      <div id="chart-container" />
      {toolbarSlot && createPortal(<MyToolbarButtons />, toolbarSlot)}
    </>
  );
}
```

**Don't gate the portal on "is data loaded yet" state** unless you have a strong reason. Render the buttons as soon as the slot exists — that way the user can see what's available before picking a symbol and can pre-toggle their preferences. Defer the actual chart effect to a separate path that's already gated on data presence.

**Don't `setToolbarSlot(null)` in the cleanup return.** The component is unmounting alongside; setState on an unmounting tree triggers React warnings. The portal naturally disappears when the component unmounts.

## Step 3 — Portal popovers to `document.body` with `position: fixed`

If any button opens a dropdown / popover, anchoring it relatively under the button breaks: FintaChart's `tcdToolbar-scroll-wrapper` has `overflow: hidden`, which clips everything regardless of z-index.

Fix: render the popover into `document.body` with `position: fixed` and compute coordinates from `getBoundingClientRect()`.

```jsx
function SplitButton() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const caretRef = useRef(null);

  const positionMenu = useCallback(() => {
    const r = caretRef.current?.getBoundingClientRect();
    if (!r) return;
    setMenuPos({ top: r.bottom + 4, left: r.left });
  }, []);

  // Position BEFORE paint to avoid a flash at (0,0).
  useLayoutEffect(() => { if (menuOpen) positionMenu(); }, [menuOpen, positionMenu]);

  // Keep position correct while open during scroll / resize.
  useEffect(() => {
    if (!menuOpen) return;
    const onChange = () => positionMenu();
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);   // capture phase to catch inner scrolls
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
    };
  }, [menuOpen, positionMenu]);

  return (
    <>
      <button ref={caretRef} onClick={() => setMenuOpen(o => !o)}>▾</button>

      {menuOpen && createPortal(
        <div
          className="my-popover"
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 100001 }}
        >
          {/* popover content */}
        </div>,
        document.body
      )}
    </>
  );
}
```

The **z-index must be ≥ 100001**. FintaChart's own toolbars/dialogs sit in the high-5-digit z-index range; the rule of thumb from the skill's gotchas list is "100000+ to stay clickable above FintaChart's chrome".

## Step 4 — Style icon-only buttons to match the native toolbar

FintaChart's native toolbar buttons are ~26 px square with SVG icons. Match that footprint:

```css
.my-toolbar-slot {                /* the injected <li> itself */
  list-style: none;
  display: flex;
  align-items: center;
  padding: 0 6px;
  margin: 0;
}

.my-toolbar-btn {
  width: 26px; height: 26px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-app);
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  transition: background 100ms, color 100ms, border-color 100ms;
}
.my-toolbar-btn:hover     { background: var(--bg-hover); color: var(--text); }
.my-toolbar-btn.is-active { background: var(--accent); border-color: var(--accent); color: #fff; }
.my-toolbar-btn svg       { display: block; }   /* inline SVG, currentColor */
```

For inline SVG icons, use `stroke="currentColor"` so the icon picks up the themed text/accent colour automatically:

```jsx
<svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
  <path d="M1,7 Q3.5,1.5 6,7 T11,7 T15,7" fill="none" stroke="currentColor" strokeWidth="1.8" />
</svg>
```

For split buttons (main action + caret popover), share a seam by removing border-radius on the inner edges:

```css
.my-split .my-toolbar-btn-main   { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.my-split .my-toolbar-btn-caret  { border-top-left-radius:  0; border-bottom-left-radius:  0; border-left: none; padding: 0 4px; height: 26px; }
```

## Brittleness notes (worth tracking if you ship this)

These DOM-class names are not documented as stable contracts. A FintaChart minor bump could rename them and your injection breaks silently:

- `ul.tcdToolbar.tcdToolbarNavTop` — the top toolbar's `<ul>` container
- `.tcdToolbar-btn-indicators` — the "add indicators" button (useful as a positional anchor)
- `.tcdToolbar-scroll-wrapper` — the overflow-clipping ancestor (relevant to the popover fix)
- `chart.toolbar.container` — the toolbar's root `HTMLElement` (public getter, but the element it returns can be re-created)

Defence: keep the selectors centralized at the top of your bootstrap module, gate `ensureSlot` on the `<ul>` actually existing before injecting, and rely on the `MutationObserver` to recover from unexpected re-renders. If FintaChart renames the classes, the slot just won't appear — you'll see the absence immediately rather than a corrupted UI.

## Cross-references

- `gotchas.md` § *No public API to add custom buttons to the chart toolbar* — the gotcha summary
- `gotchas.md` § *Internal toolbar / dialog z-indexes are very high* — why the popover needs z-index ≥ 100001
- The maintainer feedback document carries this as item **(i)** in the "Held for the next feedback round" section, with the suggested public-API shape (`chart.toolbar.addButton(config)` or `chart.toolbar.appendCustomSlot()`).
