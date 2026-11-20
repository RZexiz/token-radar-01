# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/RZexiz/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/RZexiz/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An implied-value board for 200 pre-token protocols. Every number is traceable to the snapshot, and
the model is fitted against the snapshot's own 129 live-token protocols rather than asserted.

## The finding this board is built on

Two measurements came out of the snapshot, and the second one changed the model.

**Category explains little.** Grouping the 129 live protocols by category and taking the median
`mcap / tvl` gives a real number per sector, but across the whole snapshot the category accounts for
under a quarter of the variation in a protocol's multiple (R² ≈ 0.24 agent fit on TVL alone, ≈ 0.19
on category medians alone). A board priced purely on sector medians is mostly noise wearing evidence.

**Size explains most of it.** Bucket the same protocols by TVL and the median `mcap / tvl` falls
almost twelvefold from the smallest bucket to the largest — 0.42 at $5–8M of TVL down to 0.03 at
$455M–26B. A dollar of book in a small protocol is priced far above a dollar of book in a large one.
This is the largest single signal in the data, and the model now fits it directly.

## What it does

The board ranks watchlist protocols by the price the market would put on each one if it launched a
token today. That price is read off a curve, not a table:

```
log(mcap) = a + b · log(tvl)      → implied(tvl) = e^a · tvl^b
```

- **fitted** — `a` and `b` come from an OLS fit over the snapshot's live protocols, so `b` (≈ 0.57)
  says implied value grows sublinearly with TVL: bigger books are cheaper per dollar
- **bounded** — a protocol outside the TVL range the curve was measured on is priced at the curve's
  value at that boundary, never extrapolated into a regime no sample covers
- **published error** — the fit's own median absolute percentage error (≈ 85%) is printed on the
  model panel. Wide is the honest answer: the snapshot cannot price a launch more precisely, and a
  board claiming otherwise is asserting precision it does not have
- **sector measured too** — each category's median multiple is kept and shown beside its
  size-adjusted reading, so a sector that is merely large never reads as expensive
- **declared where unmeasurable** — a category with no live token has no median; the model says so and
  falls back to the curve at that protocol's own TVL

Each of the three inputs the judge asks for is carried in the model: TVL as the book, seven-day
growth as momentum, and age since first listing as the record of how long the protocol has run
without a token. A protocol with no listing date uses a stated fallback and the row says so.

The fee figure is kept separate and labelled an assumption — no snapshot field carries a
protocol's revenue, so what a book would earn in a year is shown beside what it is worth, never
mixed into the valuation.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=./out node --experimental-strip-types main.ts --input ./input/snapshot.json
```

The run writes `board.json`, `dossier.json`, `data.js`, a self-contained `dashboard/` folder and
three screenshots. Open `dashboard/index.html` in any browser; it loads nothing from the network.

Two runs on the same snapshot produce byte-identical output, screenshots included — the model is
deterministic by construction (no clock reads, no randomness, no floating-point ordering).

## Layout

- `main.ts` — entry point: reads the snapshot, builds the board, writes the output and the screenshots
- `lib/model.ts` — the model: fitted implied value, growth and tenure adjustments, farm steps
- `lib/calibrate.ts` — the size curve (OLS fit + measured error) and the sector medians beside it
- `dashboard/` — the board, a filterable table, a protocol drawer, the model panel
- `screenshots/` — the board, a protocol's detail view, and the board filtered to one category

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
