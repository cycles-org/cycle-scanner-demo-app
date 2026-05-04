import { useEffect, useRef, useState } from 'react';
import { searchSymbols } from './api.js';

export default function SymbolSearch({ apiKey, onPick, disabled }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!apiKey || query.trim().length < 2) {
      setResults([]);
      setSearchErr('');
      return;
    }
    let active = true;
    const handle = setTimeout(async () => {
      try {
        const r = await searchSymbols(query.trim(), apiKey);
        if (!active) return;
        setSearchErr('');
        setResults(r);
        setOpen(true);
      } catch (e) {
        if (!active) return;
        setResults([]);
        setSearchErr(e?.message || 'search failed');
        setOpen(true);
        console.error('[SymbolSearch]', e);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [query, apiKey]);

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="symbol-search" ref={wrapRef}>
      <input
        type="text"
        placeholder={disabled ? 'enter API key first' : 'search symbol (e.g. AAPL, BTCUSDT)'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        disabled={disabled}
        style={{ width: '100%' }}
      />
      {open && (results.length > 0 || searchErr || (query.trim().length >= 2 && results.length === 0)) && (
        <div className="dropdown">
          {searchErr && <div className="dropdown-item" style={{ color: '#f85149' }}>{searchErr}</div>}
          {!searchErr && results.length === 0 && query.trim().length >= 2 && (
            <div className="dropdown-item" style={{ opacity: 0.6 }}>no matches for "{query}"</div>
          )}
          {results.map((r) => (
            <div
              key={r.symbolId ?? r.SymbolId ?? `${r.symbol}-${r.exchange}`}
              className="dropdown-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                setQuery(r.symbol ?? r.Symbol);
                onPick(r);
              }}
            >
              <span className="symbol">{r.symbol ?? r.Symbol}</span>
              <span className="desc">
                {(r.exchange ?? r.Exchange) || ''}
                {(r.shortName ?? r.description) ? ` — ${r.shortName ?? r.description}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
