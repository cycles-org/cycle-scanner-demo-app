// Symbol-ID timeframe rewriter — maps between FintaChart's timeframe picker
// (which thinks in `{ interval, periodicity }`) and the cycle-tools-api's
// symbol-ID encoding (which bakes the periodicity into the ID).
//
// The encoding is **datafeed-specific** — every datafeed has its own scheme:
//
//   FSC1: <symbol>.<exchange>-<period>-<interval>:FSC1
//         AAPL.US-D-1:FSC1   = daily
//         AAPL.US-W-1:FSC1   = weekly
//         AAPL.US-M-60:FSC1  = 60-minute = hourly (NOT "monthly" — the M
//                              letter encodes minutes; interval = N minutes)
//
//   YFI:  <symbol>(.<exchange>)?-<period>:YFI
//         AAPL-D:YFI  = daily
//         AAPL-W:YFI  = weekly
//         AAPL-H:YFI  = hourly (presumed; not yet verified end-to-end)
//
// To support a new datafeed, add a branch to `rewriteSymbolIdTimeframe` and
// `detectTimeframe` below. Each branch is a pure-string transform — the only
// runtime cost is the regex match.

const SUPPORTED_TARGETS = ['daily', 'weekly', 'hourly'];

/**
 * Rewrite a symbol ID to a different timeframe variant.
 *
 * @param {string} symbolId - e.g. "AAPL.US-D-1:FSC1"
 * @param {'daily'|'weekly'|'hourly'} target
 * @returns {string|null} - new symbol ID, or null if rewrite isn't supported
 *                          (unknown datafeed, unrecognized format, or
 *                          unsupported target). Caller should treat null as
 *                          "this dataset doesn't have that timeframe variant".
 */
export function rewriteSymbolIdTimeframe(symbolId, target) {
  if (!symbolId || typeof symbolId !== 'string') return null;
  if (!SUPPORTED_TARGETS.includes(target)) return null;

  // Split off the trailing :DATAFEED tag.
  const colonIdx = symbolId.lastIndexOf(':');
  if (colonIdx < 0) return null;
  const head = symbolId.slice(0, colonIdx);
  const datafeed = symbolId.slice(colonIdx + 1);

  // FSC1: <base>-<period>-<interval> at end of head
  if (datafeed === 'FSC1') {
    const m = head.match(/^(.+)-([A-Z]+)-(\d+)$/);
    if (!m) return null;
    const base = m[1];
    const map = {
      daily:  ['D', '1'],
      weekly: ['W', '1'],
      hourly: ['M', '60'],   // 60-minute bars
    };
    const [p, n] = map[target];
    return `${base}-${p}-${n}:${datafeed}`;
  }

  // YFI: <base>-<period> at end of head (no interval segment)
  if (datafeed === 'YFI') {
    const m = head.match(/^(.+)-([A-Z]+)$/);
    if (!m) return null;
    const base = m[1];
    const map = { daily: 'D', weekly: 'W', hourly: 'H' };
    return `${base}-${map[target]}:${datafeed}`;
  }

  return null;
}

/**
 * Detect which timeframe a symbol ID encodes.
 * Returns null if the format isn't recognized (treat as "unknown — leave alone").
 *
 * @param {string} symbolId
 * @returns {'daily'|'weekly'|'hourly'|null}
 */
export function detectTimeframe(symbolId) {
  if (!symbolId || typeof symbolId !== 'string') return null;
  const colonIdx = symbolId.lastIndexOf(':');
  if (colonIdx < 0) return null;
  const head = symbolId.slice(0, colonIdx);
  const datafeed = symbolId.slice(colonIdx + 1);

  if (datafeed === 'FSC1') {
    const m = head.match(/^.+-([A-Z]+)-(\d+)$/);
    if (!m) return null;
    const [, p, n] = m;
    if (p === 'D' && n === '1')  return 'daily';
    if (p === 'W' && n === '1')  return 'weekly';
    if (p === 'M' && n === '60') return 'hourly';
    return null;
  }

  if (datafeed === 'YFI') {
    const m = head.match(/^.+-([A-Z]+)$/);
    if (!m) return null;
    const p = m[1];
    if (p === 'D') return 'daily';
    if (p === 'W') return 'weekly';
    if (p === 'H') return 'hourly';
    return null;
  }

  return null;
}

/**
 * Map a FintaChart `{ interval, periodicity }` to our target string.
 * Returns null for anything we don't currently support.
 *
 * Periodicity codes (see FintaChart skill / Periodicity.MINUTE gotcha):
 *   '' = MINUTE, 'h' = HOUR, 'd' = DAY, 'w' = WEEK, 'm' = MONTH, 'y' = YEAR
 */
export function fcTimeFrameToTarget(timeFrame) {
  if (!timeFrame) return null;
  const { interval, periodicity } = timeFrame;
  if (interval !== 1) return null;             // we only handle 1-of-X for now
  if (periodicity === 'd') return 'daily';
  if (periodicity === 'w') return 'weekly';
  if (periodicity === 'h') return 'hourly';
  return null;
}

/**
 * Inverse of `fcTimeFrameToTarget`. Needs `FC` (window.FintaChart) for the
 * Periodicity enum.
 */
export function targetToFcTimeFrame(target, FC) {
  if (!FC?.Periodicity) return null;
  switch (target) {
    case 'daily':  return { interval: 1, periodicity: FC.Periodicity.DAY };
    case 'weekly': return { interval: 1, periodicity: FC.Periodicity.WEEK };
    case 'hourly': return { interval: 1, periodicity: FC.Periodicity.HOUR };
    default: return null;
  }
}
