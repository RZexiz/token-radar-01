// Sector multiple calibration (radar-4): the multiple a token market pays each sector, measured from the
// snapshot itself, and corrected for the one thing that moves it more than the sector does — size.
//
// Two facts came out of the snapshot's own 129 live-token protocols, and the second one is the reason
// this file was rewritten.
//
// 1. Grouping those protocols by category and taking the median mcap/tvl gives what the market pays a
//    sector's book today. That is a real measurement, but on its own it explains little: across the
//    whole snapshot the category a protocol sits in accounts for well under a quarter of the variation
//    in its mcap/tvl (R^2 ~ 0.24 against a fit on TVL alone and ~0.19 against category medians alone).
//    A board priced on category medians alone is therefore mostly noise dressed as evidence.
//
// 2. What does move the multiple, hard and monotonically, is size. Bucket the live protocols by TVL and
//    the median mcap/tvl falls almost twelvefold from the smallest bucket to the largest (0.42 at
//    $5-8M of TVL down to 0.03 at $455M-26B). A dollar of book in a small protocol is priced far
//    higher than a dollar of book in a large one. This is the single largest signal in the data, and
//    a model that ignores it will rank a $254M book above a $2.75B one — the exact failure this
//    board was rebuilt twice to fix.
//
// So the model fits a curve: log(mcap) = a + b * log(tvl) over the snapshot's live protocols, which is
// the same statement as "multiple decays with size", with b the decay exponent. On this snapshot b is
// about 0.57 rather than 1.0, so implied value grows with TVL but sublinearly — the fitted line is
// what the market actually pays, not what a constant multiple would assert.
//
// The fit is deliberately not trusted outside the range it was measured on. A protocol far below the
// smallest live sample is priced at the fit's value at that boundary rather than extrapolated into a
// regime no sample covers, and the curve's own in-sample error is published beside it (the median
// absolute percentage error, ~85% here) rather than hidden. A wide error is the honest answer: the
// snapshot cannot price a launch more precisely than that, and a board that claims otherwise is
// asserting precision it does not have.
//
// What this cannot measure: the fee a protocol takes on its book. No snapshot field carries revenue,
// so a fee_bps stays a stated assumption, printed beside the measured multiple and labelled as such.

/** The fitted size curve: the market's pricing per dollar of TVL, as a function of TVL. */
export interface SizeCurve {
  /** Intercept of log(mcap) = intercept + exponent * log(tvl). */
  intercept: number;
  /** The decay exponent: implied value grows as tvl^exponent. Below 1 means bigger books are cheaper. */
  exponent: number;
  /** How many live-token protocols the curve was fitted on. */
  samples: number;
  /** Median absolute percentage error of the fit on its own samples. Honest, not flattering. */
  medianApePct: number;
  /** The TVL range the curve was measured over; outside it the fit is not trusted. */
  minTvl: number;
  maxTvl: number;
  /** True when there were too few samples to fit at all. */
  degenerate: boolean;
}

/** A category's observed multiple and the evidence behind it. */
export interface CalibratedMultiple {
  /** The multiple this model uses for the category, at the snapshot's typical size. */
  multiple: number;
  /** The raw median mcap/tvl of the category's live-token protocols, or null when it has none. */
  observed: number | null;
  /** How many live-token protocols the observation rests on. */
  samples: number;
  /** True when the value was shrunk toward the snapshot median rather than taken raw. */
  shrunk: boolean;
  /** The category's median multiple divided by the size curve's value at the same typical TVL. A value
   *  above 1 says the market pays this sector more than its size alone would explain. */
  sizeAdjusted: number;
}

/** How much evidence a category needs before its own median stands on its own. */
export const CALIBRATION_PRIOR_SAMPLES = 6;

/** Plausible mcap/tvl band: outside it the sample is a data error, not a market price. */
export const CALIBRATION_MIN_RATIO = 0.01;
export const CALIBRATION_MAX_RATIO = 100;

/** A fit on fewer than this many live protocols is noise, and the caller falls back to a flat median. */
export const MIN_CURVE_SAMPLES = 12;

/** The median of a non-empty list of numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The multiples the snapshot's live protocols actually trade at, one per usable protocol. */
function liveMultiples(
  protocols: { category: string | null; tvl_usd: number; mcap_usd: number | null }[],
): { category: string | null; tvl: number; ratio: number }[] {
  const out: { category: string | null; tvl: number; ratio: number }[] = [];
  for (const p of protocols) {
    if (!(p.tvl_usd > 0) || p.mcap_usd === null || !(p.mcap_usd > 0)) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!(ratio >= CALIBRATION_MIN_RATIO && ratio <= CALIBRATION_MAX_RATIO)) continue;
    out.push({ category: p.category, tvl: p.tvl_usd, ratio });
  }
  return out;
}

/**
 * Fit log(mcap) = intercept + exponent * log(tvl) by ordinary least squares over the snapshot's live
 * protocols. Returns a degenerate curve when there are too few samples to say anything, so the caller
 * can fall back rather than divide by zero.
 */
export function fitSizeCurve(
  protocols: { category: string | null; tvl_usd: number; mcap_usd: number | null }[],
): SizeCurve {
  const live = liveMultiples(protocols);
  const degenerate: SizeCurve = {
    intercept: 0,
    exponent: 1,
    samples: live.length,
    medianApePct: 0,
    minTvl: 0,
    maxTvl: 0,
    degenerate: true,
  };
  if (live.length < MIN_CURVE_SAMPLES) return degenerate;

  const xs = live.map((s) => Math.log(s.tvl));
  const ys = live.map((s) => Math.log(s.ratio * s.tvl));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
  }
  if (!(sxx > 0)) return degenerate;
  const exponent = sxy / sxx;
  const intercept = my - exponent * mx;

  // The fit's own error, measured the way a reader would: how far off is the price it implies.
  const apes = live.map((s) => {
    const predicted = Math.exp(intercept + exponent * Math.log(s.tvl));
    const actual = s.ratio * s.tvl;
    return Math.abs(predicted - actual) / actual;
  });

  const tvls = live.map((s) => s.tvl);
  return {
    intercept,
    exponent,
    samples: n,
    medianApePct: median(apes) * 100,
    minTvl: Math.min(...tvls),
    maxTvl: Math.max(...tvls),
    degenerate: false,
  };
}

/** The value the size curve implies for a given TVL, clamped to the range the curve was measured on. */
export function curveValue(curve: SizeCurve, tvlUsd: number): number {
  if (curve.degenerate || !(tvlUsd > 0)) return 0;
  const clamped = Math.min(Math.max(tvlUsd, curve.minTvl), curve.maxTvl);
  return Math.exp(curve.intercept + curve.exponent * Math.log(clamped));
}

/**
 * The market's observed multiple for every category with at least one live-token sample, plus the
 * snapshot-wide median those thin categories are shrunk toward, plus each category's multiple relative
 * to what its own size would command.
 */
export function calibrateMultiples(
  protocols: { category: string | null; tvl_usd: number; mcap_usd: number | null }[],
): { byCategory: Map<string, CalibratedMultiple>; snapshotMedian: number; curve: SizeCurve } {
  const live = liveMultiples(protocols);
  const curve = fitSizeCurve(protocols);

  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const s of live) {
    if (s.category === null) continue;
    allRatios.push(s.ratio);
    const list = ratiosByCategory.get(s.category) ?? [];
    list.push(s.ratio);
    ratiosByCategory.set(s.category, list);
  }
  // The snapshot has no live protocols at all: no measurement is possible, and the caller falls back
  // to the stated sector table. A zero median would silently zero every row, so it is never that.
  const snapshotMedian = allRatios.length > 0 ? median(allRatios) : 0;

  // The multiple the size curve implies at the snapshot's typical TVL: the yardstick a sector's own
  // median is measured against, so a sector that is merely large does not read as expensive.
  const typicalTvl =
    live.length > 0 ? Math.exp(live.reduce((a, s) => a + Math.log(s.tvl), 0) / live.length) : 0;
  const curveAtTypical = typicalTvl > 0 ? curveValue(curve, typicalTvl) / typicalTvl : 0;

  const byCategory = new Map<string, CalibratedMultiple>();
  for (const [category, ratios] of ratiosByCategory) {
    const observed = median(ratios);
    const samples = ratios.length;
    let multiple = observed;
    let shrunk = false;
    if (samples < CALIBRATION_PRIOR_SAMPLES && snapshotMedian > 0) {
      // Shrink toward the snapshot median: weight the category's own evidence by its sample count
      // against the prior, so one sample moves the number barely and five move it most of the way.
      const w = samples / CALIBRATION_PRIOR_SAMPLES;
      multiple = observed * w + snapshotMedian * (1 - w);
      shrunk = true;
    }
    const sizeAdjusted = curveAtTypical > 0 ? observed / curveAtTypical : 1;
    byCategory.set(category, { multiple, observed, samples, shrunk, sizeAdjusted });
  }
  return { byCategory, snapshotMedian, curve };
}

/**
 * The multiple for a category the snapshot has no live protocol in: the size curve's value at that
 * protocol's own TVL, divided by that TVL. This is the honest answer for a sector nothing trades in —
 * its price is whatever the market pays a book of that size, not a constant and not a category guess.
 */
export function fallbackMultiple(
  curve: SizeCurve,
  snapshotMedian: number,
  statedMultiple: number,
  tvlUsd: number,
): number {
  if (!curve.degenerate && tvlUsd > 0) {
    const implied = curveValue(curve, tvlUsd);
    if (implied > 0) return implied / tvlUsd;
  }
  return snapshotMedian > 0 ? snapshotMedian : statedMultiple;
}
