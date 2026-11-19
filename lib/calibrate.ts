// Sector multiple calibration (radar-3): the revenue multiple a token market pays each sector, measured
// from the snapshot itself rather than asserted.
//
// The snapshot's live-token protocols carry a market cap and a TVL. Their ratio, mcap / tvl, is the
// multiple the market currently pays that sector's book. Grouping those protocols by category and taking
// the median gives an observed multiple per sector. Sectors with too few live samples are shrunk toward
// the whole-snapshot median in proportion to their sample count, so a sector with one lucky sample never
// outranks a sector with twelve.
//
// What this cannot measure: the fee a protocol takes on its book. No snapshot field carries revenue, so
// the sector's fee_bps stays a stated economic assumption (a lending spread is thin, a curator's fee is
// not). The dashboard prints both: the measured multiple and the assumed fee, labelled as such.

/** A category's observed multiple and the evidence behind it. */
export interface CalibratedMultiple {
  /** The multiple this model uses for the category. */
  multiple: number;
  /** The raw median mcap/tvl of the category's live-token protocols, or null when it has none. */
  observed: number | null;
  /** How many live-token protocols the observation rests on. */
  samples: number;
  /** True when the value was shrunk toward the snapshot median rather than taken raw. */
  shrunk: boolean;
}

/** How much evidence a category needs before its own median stands on its own. */
export const CALIBRATION_PRIOR_SAMPLES = 6;

/** Plausible mcap/tvl band: outside it the sample is a data error, not a market price. */
export const CALIBRATION_MIN_RATIO = 0.01;
export const CALIBRATION_MAX_RATIO = 100;

/** The median of a non-empty list of numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The market's observed multiple for every category with at least one live-token sample, plus the
 * snapshot-wide median those thin categories are shrunk toward.
 */
export function calibrateMultiples(
  protocols: { category: string | null; tvl_usd: number; mcap_usd: number | null }[],
): { byCategory: Map<string, CalibratedMultiple>; snapshotMedian: number } {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of protocols) {
    if (p.category === null || p.mcap_usd === null || !(p.tvl_usd > 0) || !(p.mcap_usd > 0)) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!(ratio >= CALIBRATION_MIN_RATIO && ratio <= CALIBRATION_MAX_RATIO)) continue;
    allRatios.push(ratio);
    const list = ratiosByCategory.get(p.category) ?? [];
    list.push(ratio);
    ratiosByCategory.set(p.category, list);
  }
  // The snapshot has no live protocols at all: no measurement is possible, and the caller falls back
  // to the stated sector table. A zero median would silently zero every row, so it is never that.
  const snapshotMedian = allRatios.length > 0 ? median(allRatios) : 0;

  const byCategory = new Map<string, CalibratedMultiple>();
  for (const [category, ratios] of ratiosByCategory) {
    const observed = median(ratios);
    const samples = ratios.length;
    if (samples >= CALIBRATION_PRIOR_SAMPLES || snapshotMedian === 0) {
      byCategory.set(category, { multiple: observed, observed, samples, shrunk: false });
      continue;
    }
    // Shrink toward the snapshot median: weight the category's own evidence by its sample count
    // against the prior, so one sample moves the number barely and five move it most of the way.
    const w = samples / CALIBRATION_PRIOR_SAMPLES;
    const shrunkTo = observed * w + snapshotMedian * (1 - w);
    byCategory.set(category, { multiple: shrunkTo, observed, samples, shrunk: true });
  }
  return { byCategory, snapshotMedian };
}

/**
 * The multiple for a category the snapshot has no live protocol in: the snapshot-wide median, which is
 * the market's average pricing per dollar of TVL. Never a table constant — those are on a different scale
 * (a revenue multiple) and mixing the two scales on one board is how a small book outranks a large one.
 */
export function fallbackMultiple(snapshotMedian: number, statedMultiple: number): number {
  return snapshotMedian > 0 ? snapshotMedian : statedMultiple;
}
