# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/a25822457/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/a25822457/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar — a web dashboard that tracks pre-token crypto protocols worth farming, ranked by implied value, with a verdict and a farm plan for each. It reads a sealed DefiLlama protocol snapshot (758 protocols, 2026-11-14), keeps only protocols with no token on record, and prices them off the market itself: a size curve fitted on the snapshot's traded protocols, so the ranking re-prices itself on any future snapshot with no hand-kept list of names. The watchlist (40 protocols at or above $50M TVL with no token) is the floor, never the ceiling: the early radar ranks every other rankable pre-token protocol too, for 198 ranked rows. Wrapped, staked, bridged and exchange products are excluded — a staked receipt token is not a protocol still waiting for a launch of its own.

## How implied value is computed (radar-6 — value model unchanged from radar-5)

```
log10(implied) = a_cat + b_cat x log10(tvl_usd)        (one curve per kind of protocol)
                 + category offset + breadth slope x (chains - 1, centred)
                 + growth slope x (7-day growth, centred)
                 + maturity slope x log10(1 + age with no token, centred)
```

The coefficients are fitted from the snapshot on every run, not hard-coded: 94 traded protocols (positive market cap and TVL, not an exchange, bridge or staking receipt — those tokens are not protocol launches). A category with at least 8 traded protocols of its own gets its own curve — Lending (15, slope 1.06), Dexs (11, slope 1.12), Yield (9, slope 0.55), RWA (9, slope 0.40) — each shrunk toward the global curve (intercept 3.908, slope 0.405, n / (n + 10)), and outside the TVL range its own traded protocols cover, the curve hands back to the global slope, so a steep slope fitted on small protocols is never extrapolated at full strength. Categories without their own curve use the global curve plus their shrunk offset (at least 3 comparables, shrinkage n / (n + 10)). Market cap grows much more slowly than TVL on the global curve — the fitted multiple is 0.21x at $50M of TVL and 0.01x at $5B — so a flat multiple would overvalue the giants by an order of magnitude. The breadth slope is −0.071 per extra chain. The growth slope is −0.254 per unit of clamped growth and the maturity slope is −0.042 per log10(1 + age) — both fitted from the same traded protocols, then shrunk to a quarter and a half: at full strength they cost leave-one-out accuracy, because fast seven-day growth mean-reverts and an old protocol with no token carries a slightly lower multiple. Every row shows a P25–P75 band: half the traded protocols land within 0.32x to 3.89x of the curve.

**What the backtest says about growth and age.** Their full fitted slopes are negative, so at full strength they cost leave-one-out accuracy. Shrunk to a quarter and a half they cost almost nothing (leave-one-out 3.13x, walk-forward 2.35x / 2.15x), so the value carries both, at the weight the backtest supports. **Verdicts:** Worth farming is implied value of at least $20M (25 protocols); Watch is at least $10M, or at least $5M with 7-day growth of 10% or more (59); the rest is Skip (114). **Confidence** (0–1, shown, never moves a rank) — what the snapshot actually knows: age known, 7-day growth known, a category with ≥ 3 comparables, more than one chain.

**Rank stability.** Refitting the curve on 200 bootstrap resamples of the traded pool moves a typical row's rank by 60 places (median p90–p10 rank range) — ranks move too, because the value band is wide and rows' values overlap. The top of the board is steadier: the top row ranks 1–13 and lands in the top 20 in 95% of refits. Every row carries its rank range next to its point rank.

## Backtest (recomputed from the snapshot on every run)

Median multiplicative miss — how far the predicted market cap is from the real one, in multiples:

| Test | radar-6 (per-category curves, unchanged from radar-5) | radar-4 (one global curve) | radar-2 (flat category multiple) |
| --- | --- | --- | --- |
| Leave-one-out, 94 traded protocols | 3.13x | 3.37x | 5.54x |
| Walk-forward: train older, test newer | 2.35x | 2.35x | 3.48x |
| Walk-forward: train newer, test older | 2.15x | 2.15x | 5.48x |
| Leave-one-category-out | 2.79x | 2.83x | — |
| Leave-one-out rank correlation (Spearman) | 0.312 | 0.281 | — |

Per-category curves beat one global curve where it matters: leave-one-out 3.37x → 3.13x, leave-one-category-out 2.83x → 2.79x, rank correlation 0.281 → 0.312, with walk-forward unchanged at 2.35x / 2.15x. The gain is concentrated in Lending (leave-one-out 6.81x → 4.80x); Dexs and Yield get slightly worse, so the curves are shrunk and range-guarded rather than trusted raw. The numbers above are the honest ones: a 3.13x median miss is still wide, which is why every row carries its band and its bootstrap rank range instead of a single precise-looking number.

Top of the board on the sealed snapshot: Bittensor dTAO (~$74.9M implied), Figure Markets Prime (~$42.9M), Sentora Curator (~$41.3M). Every row carries an 8-step farm plan derived from its own category, chains, TVL, age and verdict — the top six rows name the protocol's own mechanism (staking TAO into a Bittensor subnet, lending YLDS into a Figure Markets Prime pool, depositing into a Sentora-curated Morpho vault), the rest use the mechanism template for their own kind, every hold is dated from the snapshot, and every plan names the risk to watch and ends in a break-even and an exit rule. No step promises an airdrop. The table also sorts by value per dollar committed (implied value divided by the plan's capital plus gas). The farm book (plans.json) carries the top 6 Worth rows with their whole plans, and the research note carries two costed portfolios: $1,000 across the top 5 Worth rows and $5,000 across the top 10, each sized from the rows' own suggested capital and netted to one break-even number.

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
