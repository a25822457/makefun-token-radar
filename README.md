# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/a25822457/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/a25822457/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar — a web dashboard that tracks pre-token crypto protocols worth farming, ranked by implied value, with a verdict and a farm plan for each. It reads a sealed DefiLlama protocol snapshot (758 protocols, 2026-11-14), keeps only protocols with no token on record, and prices them off the market itself: a size curve fitted on the snapshot's traded protocols, so the ranking re-prices itself on any future snapshot with no hand-kept list of names. The watchlist (40 protocols at or above $50M TVL with no token) is the floor, never the ceiling: the early radar ranks every other rankable pre-token protocol too, for 198 ranked rows. Wrapped, staked, bridged and exchange products are excluded — a staked receipt token is not a protocol still waiting for a launch of its own.

## How implied value is computed (radar-4)

```
log10(implied) = 3.908 + 0.405 x log10(tvl_usd)
                 + category offset + breadth slope x (chains - 1, centred)
                 + growth slope x (7-day growth, centred)
                 + maturity slope x log10(1 + age with no token, centred)
```

The coefficients are fitted from the snapshot on every run, not hard-coded: 94 traded protocols (positive market cap and TVL, not an exchange, bridge or staking receipt — those tokens are not protocol launches). Market cap grows much more slowly than TVL — the fitted multiple is 0.21x at $50M of TVL and 0.02x at $5B — so a flat multiple would overvalue the giants by an order of magnitude. The category offset is the shrunk mean residual per category (at least 3 comparables, shrinkage n / (n + 10)); the breadth slope is −0.06 per extra chain. The growth slope is −0.231 per unit of clamped growth and the maturity slope is −0.07 per log10(1 + age) — both fitted from the same traded protocols, then shrunk to a quarter and a half: at full strength they cost leave-one-out accuracy, because fast seven-day growth mean-reverts and an old protocol with no token carries a slightly lower multiple. Every row shows a P25–P75 band: half the traded protocols land within 0.31x to 3.97x of the curve.

**What the backtest says about growth and age.** Their full fitted slopes are negative, so at full strength they cost leave-one-out accuracy (3.28x to 3.59x for growth, 3.28x to 3.51x for age). Shrunk to a quarter and a half they cost almost nothing (leave-one-out 3.37x, walk-forward 2.35x / 2.15x), so the value carries both, at the weight the backtest supports. **Verdicts:** Worth farming is implied value of at least $20M (19 protocols); Watch is at least $10M, or at least $5M with 7-day growth of 10% or more (64); the rest is Skip (115). **Confidence** (0–1, shown, never moves a rank) — what the snapshot actually knows: age known, 7-day growth known, a category with ≥ 3 comparables, more than one chain.

**Rank stability.** Refitting the curve on 200 bootstrap resamples of the traded pool moves a typical row's rank by 68 places (median p90–p10 rank range) — ranks move too, because the value band is wide and rows' values overlap. The top of the board is steadier: the top row ranks 1–10 and lands in the top 20 in 93% of refits. Every row carries its rank range next to its point rank.

## Backtest (recomputed from the snapshot on every run)

Median multiplicative miss — how far the predicted market cap is from the real one, in multiples:

| Test | radar-4 | radar-2 (flat category multiple) |
| --- | --- | --- |
| Leave-one-out, 94 traded protocols | 3.37x | 5.54x |
| Walk-forward: train older, test newer | 2.35x | 3.48x |
| Walk-forward: train newer, test older | 2.15x | 5.48x |

Adding seven-day growth and age at full strength makes leave-one-out worse (3.28x to 3.59x for growth, 3.28x to 3.51x for age), so both enter shrunk — a quarter of the growth slope, half of the maturity slope — at a cost of 0.09x on leave-one-out and nothing on walk-forward. The numbers above are the honest ones: a 3.37x median miss is still wide, which is why every row carries its band and its bootstrap rank range instead of a single precise-looking number.

Top of the board on the sealed snapshot: Sentora Curator (~$43M implied), Steakhouse Financial (~$38M), Bittensor dTAO (~$37M). Every row carries a 7-step farm plan derived from its own category, chains, TVL, age and verdict — never from a hand-written list of names — with the weekly action following the protocol's own mechanism, ending in a break-even and an exit rule. No step promises an airdrop.

## Coverage: what happened to all 758 protocols

| Group | Count |
| --- | --- |
| Ranked on the board | 198 |
| Already trade (token on record) | 144 |
| Token symbol, no market cap | 272 |
| Pre-token but excluded (CEX 42, Liquid Staking 38, Bridge 28, Canonical Bridge 15, versioned names 11, wrapped/staked names 5, Liquid Restaking 3, Restaked BTC 2) | 144 |

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22.18+ (standard library only, no dependencies). `main.ts` reads the snapshot, writes `out/board.json` (198 rows), `out/data.js`, copies `dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json`. Then open `out/dashboard/index.html` in a browser — it is fully static, no network: search, filter by category, chain or verdict, "Early only" (below the $50M floor), sort any column, open any protocol for its model breakdown, verdict and farm plan, or compare against the live-token set and the backtest table.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
