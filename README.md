# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/a25822457/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/a25822457/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar — a web dashboard that tracks pre-token crypto protocols worth farming, ranked by implied value, with a farm plan for each. It reads a sealed DefiLlama protocol snapshot (758 protocols, 2026-11-14), keeps only protocols with no token on record, and prices them off the market itself: each category's implied value uses the median market-cap / TVL of the live-token protocols in that same category, so the ranking re-prices itself on any future snapshot with no hand-kept list of names. The watchlist (40 protocols at or above $50M TVL with no token) is the floor, never the ceiling: the early radar adds 138 pre-token protocols below that floor, for 178 ranked rows. Wrapped, staked, bridged and exchange products are excluded — a staked receipt token is not a protocol still waiting for a launch of its own.

## How implied value is computed (radar-2)

```
implied = round( tvl_usd x category_multiple
                 x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
                 x (0.6 + min(age_days, 1095) / 1095 x 0.4)
                 x breadth )
```

- **category_multiple** — median mcap / TVL of live-token protocols in the same DefiLlama category (at least 3 comparables, else the global median 0.214), clamped to 0.05–0.80. Live RWA protocols price pre-token RWA; live DEXes price pre-token DEXes.
- **growth** — the protocol's 7-day TVL change, clamped to −60%…+120%, half-weighted.
- **maturity** — 0.6 + 0.4 × age/1095 days since first listing; unknown age uses 365 days. Older protocols that still have no token have had longer to earn one.
- **breadth** — 1 + 0.03 per extra chain, capped at 1.12.
- **confidence** (0–1, shown, never moves a rank) — what the snapshot actually knows: age known, 7-day growth known, a category with ≥ 3 comparables, more than one chain.

Top of the board on the sealed snapshot: Steakhouse Financial (~$521M implied), Gauntlet (~$310M), Veda (~$298M). Every row carries a 6-step farm plan derived from its own category, chains, TVL and age — never from a hand-written list of names.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22.18+ (standard library only, no dependencies). `main.ts` reads the snapshot, writes `out/board.json` (178 rows), `out/data.js`, copies `dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json`. Then open `out/dashboard/index.html` in a browser — it is fully static, no network: search, filter by category or chain, "Early only" (below the $50M floor), sort any column, open any protocol for its model breakdown and farm plan, or compare against the live-token set and the comparable-multiples table.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
