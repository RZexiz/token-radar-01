// The token radar's model (radar-2): one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds the
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures, in four stated parts:
//
//   revenue    = tvl_usd x FEE_BPS(category) / 10000     what the protocol earns a year on its own book
//   multiple   = CATEGORY_MULTIPLE(category)            the revenue multiple a token market pays that sector
//   growthMult = 1 + clamp(change_7d, -60, 120)/100 x GROWTH_WEIGHT
//   tenureMult = 0.55 + min(age_days, 1460)/1460 x 0.45  (age unknown: 365 days)
//   liquidity  = 0.75 + min(log10(tvl/1e6)/log10(3000), 1) x 0.25
//   implied    = max(1, round(revenue x multiple x growthMult x tenureMult x liquidity))
//
// No protocol name is ever special-cased: the same function scores every row. Every constant is stated
// on the dashboard, every sector's terms are printed there, and each row's detail view shows the parts.
//
// The multiple is not asserted: it is measured. The snapshot's own live-token protocols carry both a
// market cap and a TVL, so the multiple the market pays each sector is read off them (lib/calibrate.ts)
// and only thin sectors fall back toward the snapshot median. The fee stays a stated sector assumption,
// because no snapshot field carries a protocol's revenue.

import { calibrateMultiples, fallbackMultiple, curveValue, CALIBRATION_PRIOR_SAMPLES, type CalibratedMultiple, type SizeCurve } from './calibrate.ts';

/** A curve with no measurement behind it: callers fall back to the stated multiple. */
const EMPTY_CURVE: SizeCurve = { intercept: 0, exponent: 1, samples: 0, medianApePct: 0, minTvl: 0, maxTvl: 0, degenerate: true };

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  tenure_floor: number;
  tenure_range: number;
  tenure_days: number;
  unknown_age_days: number;
  liquidity_floor: number;
  liquidity_range: number;
  liquidity_ref_usd: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 120,
  tenure_floor: 0.55,
  tenure_range: 0.45,
  tenure_days: 1460,
  unknown_age_days: 365,
  liquidity_floor: 0.75,
  liquidity_range: 0.25,
  liquidity_ref_usd: 3_000_000_000,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-4';

/** How many pre-token protocols below the watchlist floor the early radar carries, by score. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 28;

/**
 * The sector's own economics, as a table the dashboard prints: how much of its TVL a protocol in this
 * category can plausibly take as yearly revenue (bps), and the revenue multiple a token market pays
 * that sector. A lending market earns a thin spread on a large book; a curator earns a fee on the
 * capital it allocates; a chain's own token captures its blockspace. Unknown sectors take the middle.
 */
export interface SectorTerms {
  fee_bps: number;
  multiple: number;
  note: string;
}

export const SECTORS: Record<string, SectorTerms> = {
  Lending: { fee_bps: 250, multiple: 14, note: 'spread between borrow and supply rates on the book' },
  CDP: { fee_bps: 200, multiple: 12, note: 'stability fee on minted debt' },
  'Collateral Markets': { fee_bps: 220, multiple: 13, note: 'fee on collateral lent against' },
  'Risk Curators': { fee_bps: 150, multiple: 18, note: 'performance fee on allocated capital' },
  'Onchain Capital Allocator': { fee_bps: 150, multiple: 17, note: 'management fee on vault AUM' },
  Dexs: { fee_bps: 90, multiple: 22, note: 'swap fee share on routed volume' },
  Dex: { fee_bps: 90, multiple: 22, note: 'swap fee share on routed volume' },
  Yield: { fee_bps: 180, multiple: 15, note: 'yield captured on deployed capital' },
  'Yield Aggregator': { fee_bps: 170, multiple: 15, note: 'performance fee on harvested yield' },
  Restaking: { fee_bps: 120, multiple: 20, note: 'commission on restaked security' },
  'Staking Pool': { fee_bps: 100, multiple: 16, note: 'commission on staked balance' },
  Chain: { fee_bps: 300, multiple: 26, note: 'blockspace and gas captured by the native token' },
  Bridge: { fee_bps: 70, multiple: 19, note: 'transfer fee on bridged volume' },
  RWA: { fee_bps: 280, multiple: 16, note: 'fee on tokenized asset yield' },
  Insurance: { fee_bps: 350, multiple: 12, note: 'premium written against covered risk' },
  Payments: { fee_bps: 160, multiple: 20, note: 'routing fee on settled volume' },
  CeDeFi: { fee_bps: 200, multiple: 15, note: 'fee on the hybrid book' },
  'Basis Trading': { fee_bps: 130, multiple: 17, note: 'spread captured on the basis' },
  'Leveraged Farming': { fee_bps: 210, multiple: 13, note: 'fee on levered positions' },
  Perpetuals: { fee_bps: 110, multiple: 21, note: 'taker fee on perp volume' },
  Derivatives: { fee_bps: 110, multiple: 21, note: 'fee on derivative flow' },
  Prediction: { fee_bps: 140, multiple: 18, note: 'fee on resolved markets' },
  Stablecoin: { fee_bps: 190, multiple: 11, note: 'float income on issued supply' },
  'Stablecoin Wrapper': { fee_bps: 120, multiple: 12, note: 'yield share on wrapped supply' },
  'Governance Incentives': { fee_bps: 130, multiple: 15, note: 'fee on incentivised liquidity' },
  NFT: { fee_bps: 220, multiple: 16, note: 'royalty and marketplace fee' },
  Gaming: { fee_bps: 240, multiple: 14, note: 'in-game fee on economic activity' },
};

/** The sector's terms: a named sector's own, else the middle of the table. */
export function sectorTerms(category: string | null): SectorTerms {
  if (category !== null && SECTORS[category] !== undefined) return SECTORS[category]!;
  const lower = (category ?? '').toLowerCase();
  if (lower.length > 0) {
    for (const key of Object.keys(SECTORS)) {
      const k = key.toLowerCase();
      if (lower.includes(k) || k.includes(lower)) return SECTORS[key]!;
    }
  }
  return { fee_bps: 170, multiple: 16, note: 'the middle of the sector table: this category has no row of its own' };
}

/** One sector's terms as the dashboard prints them: the assumed fee, the measured multiple, its evidence. */
export interface SectorRow {
  category: string;
  fee_bps: number;
  multiple: number;
  note: string;
  /** How many live-token protocols the multiple was measured on. */
  samples: number;
  /** The category's own median mcap/tvl, or null when nothing was measured. */
  observed: number | null;
  /** True when the multiple was shrunk toward the snapshot median for thin evidence. */
  shrunk: boolean;
}

/**
 * The whole sector table, for the dashboard's model panel. Every category the board actually scores is
 * present, with the market-measured multiple when the snapshot has live protocols to measure it on.
 */
export function sectorTable(snapshot?: Snapshot): SectorRow[] {
  const calibration = snapshot !== undefined ? calibrateMultiples(snapshot.protocols) : null;
  const categories = new Set<string>(Object.keys(SECTORS));
  if (calibration !== null) for (const c of calibration.byCategory.keys()) categories.add(c);
  return [...categories]
    .map((c) => {
      const terms = sectorTerms(c);
      const measured = calibration?.byCategory.get(c);
      return {
        category: c,
        fee_bps: terms.fee_bps,
        multiple: measured !== undefined ? Math.round(measured.multiple * 100) / 100 : terms.multiple,
        note: terms.note,
        samples: measured?.samples ?? 0,
        observed: measured?.observed ?? null,
        shrunk: measured?.shrunk ?? false,
      };
    })
    .sort((a, b) => b.multiple - a.multiple || b.fee_bps - a.fee_bps);
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    fee_bps: number;
    revenue_usd: number;
    multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    tenure_multiplier: number;
    liquidity_multiplier: number;
    age_days: number | null;
    sector_note: string;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the farm plan is derived in the page from the same inputs. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  revenue_usd: number;
  fee_bps: number;
  multiple: number;
  growth_multiplier: number;
  tenure_multiplier: number;
  liquidity_multiplier: number;
  sector_note: string;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  sectors: SectorRow[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The multipliers, the revenue and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  calibration?: Map<string, CalibratedMultiple> | null,
  snapshotMedian = 0,
  curve?: SizeCurve | null,
): {
  implied: number;
  revenue: number;
  feeBps: number;
  multiple: number;
  growthPct: number;
  growthMult: number;
  tenureMult: number;
  liquidityMult: number;
  age: number | null;
  sectorNote: string;
  multipleSamples: number;
  multipleObserved: number | null;
} {
  const terms = sectorTerms(protocol.category);
  // The value a dollar of TVL commands comes from the market's own live protocols in this category. That
  // ratio, mcap / tvl, needs no fee assumption: the market has already priced the book. The sector table's
  // figure is the fallback only when the snapshot holds no live protocol in the category to measure on.
  const measured = protocol.category !== null ? calibration?.get(protocol.category) : undefined;
  const multiple =
    measured !== undefined
      ? measured.multiple
      : fallbackMultiple(curve ?? EMPTY_CURVE, snapshotMedian, terms.multiple, protocol.tvl_usd);
  const age = ageDays(asOf, protocol.listed_at);
  // The book's own earnings, at the sector's stated fee: a reference figure the row prints, not the
  // multiplier path. It answers "what would this book earn a year", separate from "what is it worth".
  const revenue = (protocol.tvl_usd * terms.fee_bps) / 10_000;
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const tenureMult =
    model.tenure_floor + (Math.min(Math.max(ageForModel, 0), model.tenure_days) / model.tenure_days) * model.tenure_range;
  const tvlRatio = Math.max(protocol.tvl_usd, 1) / 1_000_000;
  const liquidityMult =
    model.liquidity_floor +
    Math.min(Math.log10(tvlRatio) / Math.log10(model.liquidity_ref_usd / 1_000_000), 1) * model.liquidity_range;
  // Value = the book, priced at what its own sector's live tokens are worth per dollar of TVL, adjusted for
  // how fast the book is growing, how long it has held it, and how much of it could actually be traded.
  // With a fitted size curve the value IS the curve's reading at this book's size: the curve already
  // prices TVL (it was fitted against mcap, not against a constant multiple), so multiplying by TVL
  // again would count the book twice — the bug that made a $254M book outrank a $2.75B one.
  const base = curve && !curve.degenerate ? curveValue(curve, protocol.tvl_usd) : protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * tenureMult * liquidityMult));
  return {
    implied,
    revenue,
    feeBps: terms.fee_bps,
    multiple,
    growthPct,
    growthMult,
    tenureMult,
    liquidityMult,
    age,
    sectorNote: terms.note,
    multipleSamples: measured?.samples ?? 0,
    multipleObserved: measured?.observed ?? null,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const calibrated = calibrateMultiples(snapshot.protocols);
  const calibration = calibrated.byCategory;
  const snapshotMedian = calibrated.snapshotMedian;
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is on the board.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, ranked by score, capped. A watchlist
  // protocol is never displaced by an early one.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, implied: impliedValue(p, snapshot.as_of, model, calibration, snapshotMedian, calibrated.curve).implied }))
    .sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model, calibration, snapshotMedian, calibrated.curve) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      fee_bps: s.feeBps,
      revenue_usd: Math.round(s.revenue),
      multiple: s.multiple,
      growth_pct: Math.round(s.growthPct * 100) / 100,
      growth_multiplier: round4(s.growthMult),
      tenure_multiplier: round4(s.tenureMult),
      liquidity_multiplier: round4(s.liquidityMult),
      age_days: s.age,
      sector_note: s.sectorNote,
      multiple_samples: s.multipleSamples,
      multiple_observed: s.multipleObserved,
      multiple_source:
        s.multipleSamples === 0
          ? 'snapshot median: no live token in this category to measure on'
          : s.multipleSamples < CALIBRATION_PRIOR_SAMPLES
            ? 'measured on ' + s.multipleSamples + ' live token' + (s.multipleSamples === 1 ? '' : 's') + ', shrunk toward the snapshot median'
            : 'measured on ' + s.multipleSamples + ' live tokens in this category',
    },
    farm_steps: farmSteps(s.p, s.age, s.implied).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The sector's own first action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('chain'))
    return `Bridge $${capital} of USDC to ${chain} and use ${name}'s own bridge and app for one swap.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction'))
    return `Fund $${capital} and place one market position on ${name}, then claim the resolved payout.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of the protocol's yield asset on ${chain} through ${name} and hold it.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy open.`;
  if (c.includes('basis'))
    return `Deposit $${capital} of USDC into ${name} on ${chain} and let it run one funding cycle.`;
  if (c.includes('payment'))
    return `Route $${capital} of a payment through ${name} on ${chain} and keep the receipt.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age, and the implied value the model gives it),
 * never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const chains = p.chains.length > 1 ? `${p.chains[0]} and ${p.chains[1]}` : chain;
  const worth = implied >= 5_000_000 ? 'a large book' : implied >= 500_000 ? 'a mid-size book' : 'a small book';
  return [
    {
      text: `Open a fresh wallet for ${p.name} alone, fund it on ${chains}, and keep the seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week: a deposit, a borrow, a swap or a vote on ${p.name}.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold for at least ${hold} days: ${p.name} is ${worth} at a $${Math.round(implied).toLocaleString('en-US')} implied value and a snapshot needs two months of history.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s own points or rewards page before you withdraw, and claim only from the link it publishes itself.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan derived in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    revenue_usd: row.model.revenue_usd,
    fee_bps: row.model.fee_bps,
    multiple: row.model.multiple,
    growth_multiplier: row.model.growth_multiplier,
    tenure_multiplier: row.model.tenure_multiplier,
    liquidity_multiplier: row.model.liquidity_multiplier,
    sector_note: row.model.sector_note,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    sectors: sectorTable(snapshot),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
