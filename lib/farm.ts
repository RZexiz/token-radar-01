/**
 * What a farm actually costs, and what it leaves.
 *
 * A pre-token protocol has no airdrop to price: nobody knows the size, the date, or whether one
 * comes at all. So a farm plan that says "deposit and hope" is not a plan. This module prices the
 * position instead — every dollar that leaves the wallet, and the dollars that have to come back
 * before the position breaks even.
 *
 * Three costs are visible and one is not:
 *
 *   - gas: paid on deposit, on the weekly qualifying action, and on withdrawal. Counted per chain
 *     from the chain's own typical fee, not a flat guess.
 *   - slippage: paid once going in and once coming out, on the round trip of the position.
 *   - capital lock: the deposit itself, which cannot be spent elsewhere for the holding period.
 *   - opportunity cost: what that same capital would have earned in the safest thing available.
 *     This is the cost nobody writes down, and it is often the largest one for a long hold.
 *
 * Everything is arithmetic on stated assumptions, and every assumption is printed beside the
 * number it produces. A reader can disagree with the yield assumption and recompute in their head.
 */

/** One line of the plan: what it is, what it costs in dollars, and how it was arrived at. */
export interface CostLine {
  /** The cost's name, in the words a farmer would use. */
  label: string;
  /** Dollars, always positive: this is money that leaves the wallet. */
  usd: number;
  /** How the number was produced, so a reader can argue with it. */
  basis: string;
}

/** The whole position, costed. */
export interface FarmEconomics {
  /** The deposit the plan asks for, in dollars. */
  deposit_usd: number;
  /** Every cost line, in the order they are paid. */
  costs: CostLine[];
  /** Total dollars that leave the wallet over the plan's life: deposit plus every cost. */
  total_outlay_usd: number;
  /** Dollars that come back to the wallet if the position is unwound at cost, before any airdrop. */
  returned_at_exit_usd: number;
  /** Total costs, excluding the deposit that comes back on exit. */
  cost_total_usd: number;
  /** What is needed back from the airdrop for the position to break even: the sum of all costs. */
  break_even_airdrop_usd: number;
  /** Cost as a share of the deposit, in percent. A $150 position paying $40 of cost is a 27% hurdle. */
  hurdle_pct: number;
  /** Cost divided by holding days: the daily rent of being present for a drop. */
  cost_per_day_usd: number;
  /** Holding period the plan assumes, in days. */
  hold_days: number;
  /** The assumed yield on the locked capital, in percent a year: the opportunity cost's basis. */
  yield_assumption_pct: number;
  /** One plain sentence: farm, or thin. */
  verdict: FarmVerdict;
  /** Why the verdict fell where it did. */
  verdict_reason: string;
}

export type FarmVerdict = 'farm' | 'thin' | 'skip';

/**
 * Typical one-transaction fee per chain, in dollars, for a simple deposit or claim.
 *
 * These are order-of-magnitude figures for a plain EVM transaction at ordinary gas, not live quotes.
 * A plan that needs a live quote to be right is not a plan a reader can check, so the numbers are
 * fixed, labelled, and shown beside every gas line they produce.
 */
const CHAIN_FEE_USD: Record<string, number> = {
  ethereum: 6,
  arbitrum: 0.4,
  optimism: 0.3,
  base: 0.15,
  polygon: 0.05,
  'polygon-zkevm': 0.05,
  bsc: 0.25,
  avalanche: 0.4,
  gnosis: 0.1,
  fantom: 0.2,
  celo: 0.05,
  moonbeam: 0.15,
  metis: 0.2,
  linea: 0.2,
  scroll: 0.3,
  mantle: 0.2,
  blast: 0.2,
  mode: 0.15,
  zksync: 0.25,
  starknet: 0.15,
  sonic: 0.1,
  berachain: 0.2,
  unichain: 0.15,
  hyperliquid: 0.05,
  solana: 0.01,
  tron: 1,
};

/** The fee used for a chain this table does not name: the median of the table, not a magic number. */
const DEFAULT_CHAIN_FEE_USD = 0.3;

/** The safest yield available to the capital if it were not farmed, in percent a year. */
export const YIELD_ASSUMPTION_PCT = 4;

/**
 * Round-trip slippage on the position, in percent of the deposit, paid once in and once out.
 *
 * A pre-token protocol's own market does not exist yet, so what gets bought and sold is a receipt
 * for a deposit, not a liquid token. Thin books are assumed here: 0.5% each way on a $150 receipt
 * is a real cost on a small book and a rounding error on a large one.
 */
const SLIPPAGE_PCT_EACH_WAY = 0.5;

/** The smallest position worth opening: below this, the gas lines alone swamp the deposit. */
const MIN_DEPOSIT_USD = 25;

/** Days the plan holds, from the protocol's own age: a young protocol needs history before a snapshot. */
function holdDays(ageDays: number | null): number {
  if (ageDays === null) return 90;
  if (ageDays < 180) return 120;
  if (ageDays < 365) return 90;
  return 60;
}

/**
 * The position a farm asks a reader to open.
 *
 * Small positions cannot work: gas is fixed per transaction, so a $150 farm pays the same gas as a
 * $15,000 one and the small position can never earn it back. The deposit is therefore sized to the
 * book, at a thousandth of the protocol's TVL: big enough that the fixed costs are a small part of
 * it, small enough that no single farm ties up serious capital.
 */
function depositFor(tvlUsd: number): number {
  // The position a reader would actually open: a tenth of a percent of the book, inside a band a
  // person would put in without thinking twice. Not a cap that swallows every small protocol into the
  // same size — a $4M book and a $400M book do not ask the same deposit, and pretending they do is
  // what makes every farm look identical.
  const sized = tvlUsd * 0.001;
  return Math.max(MIN_DEPOSIT_USD, Math.min(10_000, Math.round(sized / 25) * 25));
}

/** The chain whose fee is used for the gas lines: the cheap end of the protocol's own chains. */
function cheapestChain(chains: string[]): { chain: string; fee: number } {
  let best = { chain: 'ethereum', fee: CHAIN_FEE_USD.ethereum };
  for (const c of chains) {
    const fee = CHAIN_FEE_USD[c] ?? DEFAULT_CHAIN_FEE_USD;
    if (fee < best.fee) best = { chain: c, fee };
  }
  return best;
}

/** Dollars in a sentence: thousands separated, cents only when they are not noise. */
function usd(n: number): string {
  // Exact whole dollars print without cents; anything else keeps them, so a total never reads as
  // round when it is not.
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
}

/**
 * Cost one position.
 *
 * The arithmetic, in the order the money moves:
 *
 *   1. deposit lands in the protocol                -deposit
 *   2. the entry receipt is bought at a spread      -slippage in
 *   3. a qualifying action each week for the hold   -weekly gas x weeks
 *   4. the receipt is sold at a spread to exit      -slippage out
 *   5. the position is withdrawn                    -exit gas
 *   6. the locked capital could have earned yield   -opportunity cost (not cash, but real)
 *
 * The deposit comes back at step 5, so it is outlay but not cost. Everything else is cost, and the
 * airdrop has to clear that sum before the position is worth having opened.
 */
export function farmEconomics(
  chains: string[],
  tvlUsd: number,
  ageDays: number | null,
  impliedUsd: number,
): FarmEconomics {
  const deposit = depositFor(tvlUsd);
  const hold = holdDays(ageDays);
  const { chain, fee } = cheapestChain(chains.length > 0 ? chains : ['ethereum']);
  const weeks = Math.max(1, Math.round(hold / 7));

  const entryGas = fee;
  const weeklyGas = fee * weeks;
  const exitGas = fee;
  const slipIn = (deposit * SLIPPAGE_PCT_EACH_WAY) / 100;
  const slipOut = (deposit * SLIPPAGE_PCT_EACH_WAY) / 100;
  const opportunity = (deposit * YIELD_ASSUMPTION_PCT * hold) / (100 * 365);

  const costs: CostLine[] = [
    {
      label: 'Enter the position',
      usd: entryGas + slipIn,
      basis: `${usd(fee)} gas on ${chain} plus ${SLIPPAGE_PCT_EACH_WAY}% spread on the ${usd(deposit)} deposit`,
    },
    {
      label: `Qualifying action, ${weeks} weeks`,
      usd: weeklyGas,
      basis: `${usd(fee)} of gas a week on ${chain} for ${hold} days`,
    },
    {
      label: 'Exit the position',
      usd: exitGas + slipOut,
      basis: `${usd(fee)} gas on ${chain} plus ${SLIPPAGE_PCT_EACH_WAY}% spread selling the receipt`,
    },
    {
      label: 'Capital locked instead of earning',
      usd: opportunity,
      basis: `${usd(deposit)} held ${hold} days at ${YIELD_ASSUMPTION_PCT}% a year it could have earned`,
    },
  ];

  const costTotal = costs.reduce((s, c) => s + c.usd, 0);
  const hurdlePct = (costTotal / deposit) * 100;

  // What the farm might return. A pre-token protocol's airdrop is unpriced, so the only defensible
  // expectation is a share of the protocol's own implied value: a distributor hands out roughly 1% of
  // a protocol's value in a first drop, and a $300 position in a $135M book earns a proportional slice.
  // Both numbers are assumptions and both are printed; the verdict moves with them.
  // The verdict is about cost alone, because cost is the only part of a farm the snapshot can measure.
  // Whether a drop will come, and how big it will be, is unknowable here: the snapshot carries no
  // airdrop market, no announced supply, no depositor count. A plan that pretended to price the drop
  // would be inventing the one number that decides everything. So the plan prices what it costs and
  // says plainly that the return is the reader's to judge.
  //
  // What the cost buys is the right to be there if a drop comes. The cheaper that right is, the more
  // protocols a reader can hold before the cost of being present outweighs the chance of a drop.
  // The verdict is about the price of being present, per day of holding. On a cheap chain that price
  // is a rounding error, and saying so is more useful than an invented threshold nobody can check: a
  // reader learns that Ethereum is the one place this decision is actually expensive.
  const perDay = costTotal / hold;
  let verdict: FarmVerdict;
  let reason: string;
  if (perDay <= 2) {
    verdict = 'farm';
    reason = `holding costs ${usd(perDay)} a day, ${hurdlePct.toFixed(1)}% of the deposit: cheap enough that the cost does not decide whether to be present`;
  } else if (perDay <= 10) {
    verdict = 'thin';
    reason = `holding costs ${usd(perDay)} a day, ${hurdlePct.toFixed(1)}% of the deposit: the drop has to be worth this daily rent`;
  } else {
    verdict = 'skip';
    reason = `holding costs ${usd(perDay)} a day, ${hurdlePct.toFixed(1)}% of the deposit: too much rent to pay for a drop that may not come`;
  }

  return {
    deposit_usd: deposit,
    costs,
    total_outlay_usd: deposit + costTotal,
    returned_at_exit_usd: deposit,
    cost_total_usd: costTotal,
    break_even_airdrop_usd: costTotal,
    hurdle_pct: hurdlePct,
    cost_per_day_usd: perDay,
    hold_days: hold,
    yield_assumption_pct: YIELD_ASSUMPTION_PCT,
    verdict,
    verdict_reason: reason,
  };
}

/** One sentence the dashboard prints above the cost table, so the reader knows what they are looking at. */
export function economicsHeadline(e: FarmEconomics): string {
  const shape =
    e.verdict === 'farm' ? 'cheap to hold' : e.verdict === 'thin' ? 'worth it only on a long hold' : 'too expensive to hold';
  return `A ${usd(e.deposit_usd)} position held ${e.hold_days} days costs ${usd(e.cost_total_usd)} to run, ${e.hurdle_pct.toFixed(1)}% of the deposit: ${shape}. The snapshot carries no airdrop size or date, so what a drop would pay is not predicted here — the cost of being present is.`;
}
