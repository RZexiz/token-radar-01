# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/RZexiz/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/RZexiz/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An implied-value board for 200 pre-token protocols. Every number is traceable: value is the
protocol's book (TVL) priced at what the market currently pays per dollar of TVL in that sector,
measured from the snapshot's own live tokens rather than assumed.

## What it does

The board ranks watchlist protocols by implied value, the price the market would put on each one
if it launched a token today. The multiple is not a constant in a table. It is read off the data:

- **measured** — `mcap_usd / tvl_usd` for every live protocol in the same category, taken as a median
- **shrunk** — a category with fewer than six live tokens is pulled toward the snapshot median, so
  one lucky sample never sets a sector's price
- **declared** — a category with no live token says so and takes the snapshot median

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

## Layout

- `main.ts` — entry point: reads the snapshot, builds the board, writes the output and the screenshots
- `lib/model.ts` — the model: sector terms, implied value, farm steps, the sector table
- `lib/calibrate.ts` — sector multiple calibration: measure from live tokens, shrink thin samples
- `dashboard/` — the board, a protocol drawer, the model panel; plain HTML, CSS and JS
- `screenshots/` — the board, a protocol's detail view, the model panel

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
