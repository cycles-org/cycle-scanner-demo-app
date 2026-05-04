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

export async function getDatasetSeries(symbolId, apiKey, { count = 800 } = {}) {
  // The API returns close-only series for many datasets:
  //   { close, date: "1980-12-12T00:00:00", dateUnix: 345427200 }
  // Some datasets include OHLC fields. We handle both.
  const bars = await call('GET', '/api/data/GetDatasetSeries', {
    params: { tickerid: symbolId, count },
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

export async function loadBars(symbolId, apiKey) {
  const ensure = await ensureCompleteDataset(symbolId, apiKey);
  if (ensure && ensure.isComplete === false && ensure.trackingId) {
    await waitUntilUpdateCompleted(ensure.trackingId, apiKey);
  }
  return getDatasetSeries(symbolId, apiKey);
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

export async function crsi(closes, cycleLength, apiKey) {
  return call('POST', '/api/DSP/CRSI', {
    params: { cycleLength: Math.round(cycleLength) },
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
