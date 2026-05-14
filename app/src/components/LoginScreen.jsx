// Login screen — gate the rest of the app behind a valid cycle.tools API key.
// Validates the key by calling SearchSymbols('AAPL') — a free, lightweight check.
//
// Visual design follows the FSC cosmos-hero pattern from the webapp-design
// skill (`ui-kits/cycles-explorer/LoginCosmos.jsx`): full-bleed cosmos JPEG
// behind a multi-stop gradient overlay, glassmorphism card centered on top,
// ring-mark logo + slab-serif headline + italic-serif lede, ochre primary
// button. All styles live in `styles.css` under the `.login-screen` /
// `.login-card` blocks.

import { useState } from 'react';
import { searchSymbols, QuotaError } from '../api.js';
import ThemeToggle from './ThemeToggle.jsx';

export default function LoginScreen({ onLogin, theme, onThemeChange }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e?.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) { setErr('Please enter your API key'); return; }
    setBusy(true); setErr('');
    try {
      await searchSymbols('AAPL', trimmed);
      onLogin(trimmed);
    } catch (e2) {
      const msg = e2 instanceof QuotaError ? 'API quota exceeded' : (e2?.message || 'Could not validate key');
      setErr(msg);
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-theme-corner">
        <ThemeToggle theme={theme} onChange={onThemeChange} />
      </div>
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <img className="logo" src="/fsc/logo-fsc-mark.png" alt="" />
          <div className="brand-text">
            <span className="eyebrow">Cycle Tools Scanner</span>
            <h1>Cycles discovery and prediction</h1>
          </div>
        </div>
        <p className="subtitle">
          Enter your <a href="https://cycle.tools" target="_blank" rel="noreferrer">cycle.tools</a> API key to continue.
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="API key"
          autoFocus
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={busy || !key.trim()}>
          {busy ? 'Validating…' : 'Enter the scanner'}
        </button>
        {err && <div className="error">{err}</div>}
        <div className="hint">
          Your key is stored only in this browser's localStorage. You can sign out from the top toolbar at any time.
        </div>
      </form>
    </div>
  );
}
