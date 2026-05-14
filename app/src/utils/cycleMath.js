// Cycle-math primitives matching the .NET CycleScanner2 reference implementation.
//
//   composite[i] = Σ amp_j · sin(2π · ((i - offset) − minBarNum_j) / length_j − π/2)
//                  over all selected cycles j
//
// The composite is a pure sum of sine waves around zero — NO baseline added.
// We render it on a "separate axis" by linearly mapping its value range into
// the price range when handing it to the FintaChart indicator. See mapCompositeToPriceRange.
//
// `offset` (optional, default 0) — the original cycle scan was anchored at
// bar 0 of the analysis window. After lazy-loading older bars to the left of
// that window, those older bars sit at NEGATIVE indices in the scan's frame.
// Passing `offset = frontPadCount` lets the output cover [-frontPad, totalBars-frontPad-1]
// in the scan's frame while filling positions [0, totalBars-1] of the output
// array (which aligns with the chart's actual bar coordinates after lazy-load).
// Sine math is well-defined at negative indices — same parameters (length,
// amplitude, minBarNum) extrapolated backward — so the cycle line just keeps
// going, no rescan needed.
export function buildCompositeSeries(selectedCycles, totalBars, offset = 0) {
  const out = new Float64Array(totalBars);
  for (const c of selectedCycles) {
    const length = c.cycleLength;
    const amplitude = c.amplitude;
    const minBarNum = c.minBarNum ?? 0;
    if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(amplitude)) continue;
    for (let i = 0; i < totalBars; i += 1) {
      const t = i - offset;                    // index in the scan's original frame
      const angle = (2 * Math.PI * (t - minBarNum)) / length - Math.PI / 2;
      out[i] += amplitude * Math.sin(angle);
    }
  }
  return out;
}

// Map the composite series into the price's value range so it visually fills the
// chart on a "shared" axis (poor man's separate axis — visually identical to
// LWC's left-scale trick used in the .NET app).
//
// We use the *historical* price range as the target, then rescale. That keeps the
// composite stable across zooms.
export function mapCompositeToPriceRange(composite, prices, opts = {}) {
  const fillFraction = opts.fillFraction ?? 0.85;   // composite fills 85% of price range
  let pmin = Infinity, pmax = -Infinity;
  for (const p of prices) {
    if (Number.isFinite(p)) {
      if (p < pmin) pmin = p;
      if (p > pmax) pmax = p;
    }
  }
  let cmin = Infinity, cmax = -Infinity;
  for (const v of composite) {
    if (Number.isFinite(v)) {
      if (v < cmin) cmin = v;
      if (v > cmax) cmax = v;
    }
  }
  if (!Number.isFinite(pmin) || !Number.isFinite(cmin) || cmax === cmin) {
    return new Array(composite.length).fill(NaN);
  }
  const priceMid = (pmin + pmax) / 2;
  const priceHalfRange = ((pmax - pmin) / 2) * fillFraction;
  const compMid = (cmin + cmax) / 2;
  const compHalfRange = (cmax - cmin) / 2;
  const scale = priceHalfRange / compHalfRange;

  const out = new Array(composite.length);
  for (let i = 0; i < composite.length; i += 1) {
    const v = composite[i];
    out[i] = Number.isFinite(v) ? priceMid + (v - compMid) * scale : NaN;
  }
  return out;
}

// Generate `count` future business days (skip Sat/Sun) starting the day after `lastDate`.
// Returns placeholder bars suitable for chart.appendBars() — close=NaN.
export function generateFutureBars(lastDate, count) {
  const out = [];
  const d = new Date(lastDate);
  for (let i = 0; i < count; i += 1) {
    do {
      d.setUTCDate(d.getUTCDate() + 1);
    } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    out.push({
      date: new Date(d),
      open: NaN, high: NaN, low: NaN, close: NaN, volume: 0,
    });
  }
  return out;
}

// Pearson correlation across two arrays. Skips NaN pairs. Returns NaN if no data.
export function pearson(xs, ys, fromIdx = 0, toIdx = -1) {
  const end = toIdx < 0 ? Math.min(xs.length, ys.length) : Math.min(toIdx + 1, xs.length, ys.length);
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = fromIdx; i < end; i += 1) {
    const x = xs[i], y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    n += 1;
    sx += x; sy += y;
    sxx += x * x; syy += y * y;
    sxy += x * y;
  }
  if (n < 3) return NaN;
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return den === 0 ? NaN : num / den;
}

// Weighted in-sample correlation matching the .NET pattern: split into thirds,
// weight 1× / 2× / 3× (most-recent third weighted highest).
export function weightedInSampleCorrelation(xs, ys, length) {
  const n = Math.min(length, xs.length, ys.length);
  if (n < 9) return NaN;
  const t1 = Math.floor(n / 3);
  const t2 = Math.floor((2 * n) / 3);
  const p1 = pearson(xs, ys, 0, t1 - 1);
  const p2 = pearson(xs, ys, t1, t2 - 1);
  const p3 = pearson(xs, ys, t2, n - 1);
  const finite = [p1, p2, p3].map((v, i) => ({ v, w: i + 1 })).filter((x) => Number.isFinite(x.v));
  if (finite.length === 0) return NaN;
  const num = finite.reduce((a, x) => a + x.v * x.w, 0);
  const den = finite.reduce((a, x) => a + x.w, 0);
  return num / den;
}

// Filter raw scanner peaks by the rules from the cycle-tools-api skill:
//   - cycleLength >= 30      (drop noise-band peaks)
//   - stabilityScore >= 0.4  (drop unstable)
//   - cycleLength <= dataLength / 3  (CRSI band requirement, optional)
// Then sort by `Stab` descending — same default as the .NET table.
export function filterAndSortPeaks(peaks, dataLength) {
  if (!peaks) return [];
  const cap = dataLength ? dataLength / 3 : Infinity;
  return peaks
    .filter((p) => p.cycleLength >= 30 && p.cycleLength <= cap && (p.stabilityScore ?? 0) >= 0.4)
    .sort((a, b) => (b.stabilityScore ?? 0) - (a.stabilityScore ?? 0));
}

// Auto-pick a CRSI cycle length from the currently selected cycles, matching .NET:
//   - Smallest selected cycle in 70..200 range
//   - If a selected cycle ≥ 200, use cycleLength/2 (clamped via Math.min)
//   - If no cycle in range, use the longest selected cycle
// CRSI period = half the LARGEST selected cycle from the spectrum list,
// rounded. No range clamp — the user wants the period to track the actual
// dominant cycle the trader selected, not be bounded to a fixed window.
//
// Note: this deliberately differs from the cycle-tools-api's recommended
// "half of dominant cycle, clamped [5,50]" (endpoints.md §14). The product
// decision here is that the user picks the dominant cycle explicitly via
// the spectrum table, so we trust that selection literally — if they pick
// a 600-bar cycle, length=300 it is.
//
// Bands implication: when length > dataLength/3 (≈283 for an 850-bar
// lookback), the API's `ub`/`lb` arrays come back all-NaN — the `crsi`
// line still plots correctly but the over/oversold bands disappear. That's
// a natural consequence of asking for a longer period than the bands can
// support and is preferable to silently clipping the user's choice.
//
// Safety floor: App.jsx still guards `len < 5` (the REST endpoint won't
// produce useful output below that). With cycle-scanner defaults of
// minCycleLength=15 the smallest result is 8, so the floor only matters
// if a future change lets the scanner return cycles below 10.
export function autoCrsiLength(selectedCycles) {
  if (!selectedCycles || selectedCycles.length === 0) return 0;
  const largest = selectedCycles.reduce(
    (m, c) => (Number.isFinite(c?.cycleLength) ? Math.max(m, c.cycleLength) : m),
    0,
  );
  if (largest <= 0) return 0;
  return Math.round(largest / 2);
}
