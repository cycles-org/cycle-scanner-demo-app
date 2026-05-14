// Wrapper around api.cycle.tools — mirrors the cycle-analyzer demo's REST layer.
// All endpoints documented in the cycle-tools-api skill (~/.claude/skills/cycle-tools-api).

const BASE = 'https://api.cycle.tools';

class QuotaError extends Error {
  constructor(msg) { super(msg); this.name = 'QuotaError'; }
}

async function call(method, path, { params = {}, body = null, apiKey } = {}) {
  if (!apiKey) throw new Error('Missing API key');
  const usp = new URLSearchParams({ api_key: apiKey, ...params });
  const url = `${BASE}${path}?${usp}`;
  const init = {
    method,
    headers: { Accept: 'application/json' },
  };
  if (body != null) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();

  if (res.status === 401 || res.status === 403) {
    throw new Error('Invalid API key');
  }

  // Quota errors arrive as HTTP 200 with a text marker — sniff it before JSON.parse.
  if (/quota exceeded/i.test(text)) throw new QuotaError(text.trim());

  // GetDatasetSeries returns mixed text + JSON — parse the [...] array if needed.
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\[[\s\S]*\]/);
    if (m) return JSON.parse(m[0]);
    throw new Error(`Bad response from ${path}: ${text.slice(0, 120)}`);
  }
}

export async function searchSymbols(query, apiKey) {
  if (!query || query.length < 2) return [];
  // Endpoint params per cycle-tools-api/references/endpoints.md: `search` (NOT
  // `searchString`) and `limit` (NOT `maxResults`). Wrong names return [].
  const res = await call('GET', '/api/data/SearchSymbols', {
    params: { search: query, limit: 25 },
    apiKey,
  });
  return Array.isArray(res) ? res : (res.results || res.data || []);
}

export async function ensureCompleteDataset(symbolId, apiKey) {
  const unixTo = Math.floor(Date.now() / 1000);
  return call('GET', '/api/data/EnsureCompleteDataset', {
    params: { tickerId: symbolId, unixFrom: 0, unixTo, lastclose: true },
    apiKey,
  });
}

export async function waitUntilUpdateCompleted(trackingId, apiKey) {
  return call('GET', '/api/data/WaitUntilUpdateCompleted', {
    params: { requestId: trackingId, timeoutSeconds: 30 },
    apiKey,
  });
}

// Format a Date as `yyyy-MM-dd HH:mm:ssZ` for the GetDatasetSeries `from`/`to`
// params. The endpoint accepts this format per the cycle-tools-api skill
// (endpoints.md §9). Using ISO 8601 with a `T` separator also works in practice
// but the docs' format is what we ship.
function fmtApiDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} `
       + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

export async function getDatasetSeries(
  symbolId,
  apiKey,
  { count = 800, from = null, to = null } = {},
) {
  // The API returns close-only series for many datasets:
  //   { close, date: "1980-12-12T00:00:00", dateUnix: 345427200 }
  // Some datasets include OHLC fields. We handle both.
  //
  // Params per cycle-tools-api/references/endpoints.md §9:
  //   - `maxbars` (NOT `count`) is the documented bar-limit param. Server
  //     "trims to most recent N bars" — so when paired with `to`, you get
  //     the N bars whose date <= `to`.
  //   - `from` / `to` accept `yyyy-MM-dd HH:mm:ssZ`. Used for lazy-load paging.
  //   - Both names sent for forward-compat (`count` ignored on current server,
  //     `maxbars` is the contract).
  const params = { tickerid: symbolId, maxbars: count, count };
  if (from instanceof Date) params.from = fmtApiDate(from);
  if (to   instanceof Date) params.to   = fmtApiDate(to);

  const bars = await call('GET', '/api/data/GetDatasetSeries', {
    params,
    apiKey,
  });
  return bars.map((b) => {
    const close = +(b.close ?? b.Close);
    // Prefer dateUnix (seconds) over the ISO string for performance + correctness.
    const ts = b.dateUnix ?? b.unixTime ?? b.UnixTime;
    const date = ts != null ? new Date(ts * 1000) : new Date(b.date ?? b.Date);
    return {
      date,
      open:   +(b.open  ?? b.Open  ?? close),
      high:   +(b.high  ?? b.High  ?? close),
      low:    +(b.low   ?? b.Low   ?? close),
      close,
      volume: +(b.volume ?? b.Volume ?? 0),
    };
  });
}

// True when the bars are close-only (no real OHLC). Caller can use this to pick
// chartType 'line' instead of 'candle'.
export function isCloseOnly(bars) {
  if (!bars || bars.length === 0) return true;
  return bars.every((b) => b.open === b.close && b.high === b.close && b.low === b.close);
}

export async function loadBars(symbolId, apiKey, { count = 800 } = {}) {
  // Initial-load entry point. Ensures the server-side dataset is current
  // (UpdateDataset trigger), waits for completion if needed, then fetches
  // the most-recent `count` bars.
  //
  // The cycle scanner's recommended lookback is 850 bars (cycle-tools-api
  // skill, endpoints.md §6) — pass `count` from settings to honor that.
  const ensure = await ensureCompleteDataset(symbolId, apiKey);
  if (ensure && ensure.isComplete === false && ensure.trackingId) {
    await waitUntilUpdateCompleted(ensure.trackingId, apiKey);
  }
  return getDatasetSeries(symbolId, apiKey, { count });
}

// Lazy-load entry point. Called when the chart fires a `kind: 'moreBars'`
// request — the user scrolled past the currently-loaded historical range.
// Fetches `count` bars whose date is strictly older than `endDate`.
//
// NOTE: `endDate` is the date of the oldest bar already on the chart. We
// subtract 1 second so the server doesn't return that same bar again.
export async function loadOlderBars(symbolId, apiKey, endDate, count = 500) {
  const cap = endDate instanceof Date
    ? new Date(endDate.getTime() - 1000)
    : null;
  if (!cap) return [];
  return getDatasetSeries(symbolId, apiKey, { count, to: cap });
}

export async function cycleScanner(closes, apiKey, opts = {}) {
  // dType=0 reproduces the WhenToTrade UI; dType=4 (One-Sided HP) is best for end-point accuracy.
  // includeSpectrum: true returns the full amplitude curve for the spectrum pane.
  return call('POST', '/api/cycles/CycleScanner', {
    params: {
      minCycleLength: opts.minCycleLength ?? 15,
      maxCycleLength: opts.maxCycleLength ?? 400,
      dType: opts.dType ?? 4,
      bartelsThreshold: opts.bartelsThreshold ?? 49,
      dominantPeakFinder: true,
      useStability: true,
      includeSpectrum: opts.includeSpectrum ?? true,
    },
    body: closes,
    apiKey,
  });
}

// Cyclic Smooth RSI — POST /api/DSP/CRSI per cycle-tools-api/endpoints.md §14.
// The query param name is `length` (NOT `cycleLength` — we had it wrong from
// 3.1.x onward; the server silently ignored the unknown name and fell back
// to the default `length=30`, so every call returned identical data).
//
// Recommended `length` value is **half the dominant cycle length, clamped to
// [5, 50]** — CRSI is a momentum oscillator that should detect turns *within*
// the cycle, not track the full period.
//
// Bands gotcha: ub/lb come back all-NaN if `length > dataLength / 3` (they
// need roughly 3 full repetitions to compute). The `crsi` array itself stays
// valid even when bands are NaN.
export async function crsi(closes, length, apiKey) {
  return call('POST', '/api/DSP/CRSI', {
    params: { length: Math.round(length) },
    body: closes,
    apiKey,
  });
}

// Returns the trend component of the price series via the same detrending
// algorithm the cycle scanner uses (dtype=4 = One-Sided HP / Kalman). With
// `ret=true` the endpoint returns the trend itself; price = trend + cycle.
export async function detrendTrend(closes, apiKey, { dtype = 4, lbda = 0 } = {}) {
  return call('POST', '/api/DSP/Detrend', {
    params: { dtype, lbda, ret: true },
    body: closes,
    apiKey,
  });
}

export { QuotaError };
