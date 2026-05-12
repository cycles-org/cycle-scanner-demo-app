// Cycle-math primitives matching the .NET CycleScanner2 reference implementation.
//
//   composite[i] = Σ amp_j · sin(2π · (i − minBarNum_j) / length_j − π/2)
//                  over all selected cycles j
//
// The composite is a pure sum of sine waves around zero — NO baseline added.
// Overlay mode binds the indicator to a dedicated VerticalScale via
// Indicator.bindToVerticalScale() (3.1.5+), so values are passed through raw.

export function buildCompositeSeries(selectedCycles, totalBars) {
  const out = new Float64Array(totalBars);
  for (const c of selectedCycles) {
    const length = c.cycleLength;
    const amplitude = c.amplitude;
    const minBarNum = c.minBarNum ?? 0;
    if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(amplitude)) continue;
    for (let i = 0; i < totalBars; i += 1) {
      const angle = (2 * Math.PI * (i - minBarNum)) / length - Math.PI / 2;
      out[i] += amplitude * Math.sin(angle);
    }
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
export function autoCrsiLength(selectedCycles) {
  if (!selectedCycles || selectedCycles.length === 0) return 0;
  let candidate = Infinity;
  for (const c of selectedCycles) {
    const L = c.cycleLength;
    if (L > 70 && L < 200) candidate = Math.min(L, candidate);
    else if (L >= 200) candidate = Math.min(L / 2, candidate);
  }
  if (!Number.isFinite(candidate)) {
    // No cycle in 70+ range — use longest selected.
    candidate = selectedCycles.reduce((m, c) => Math.max(m, c.cycleLength), 0);
  }
  return Math.round(candidate);
}
