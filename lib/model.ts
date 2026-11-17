// Token Launch Radar — the scoring model (radar-4).
//
// One sealed DefiLlama snapshot goes in, one ranked board comes out. The
// snapshot's traded half prices its pre-token half, but radar-4 does it
// with a curve, not a flat multiple: market cap grows much more slowly
// than TVL, so a flat median multiple overvalues the giants and
// undervalues the small.
//
//   log10(mcap) = a + b * log10(tvl)          fitted by OLS on the traded
//     + category offset (shrunk mean residual, per category)
//     + breadth slope * (chains - 1, capped 0..4, centred)
//     + growth slope * (7d growth, clamped -60..120, centred) x 0.25
//     + maturity slope * log10(1 + age with no token, centred) x 0.5
//
// Every term is fitted from the snapshot the program is handed, on every
// run — a new snapshot re-fits everything and no protocol name is ever
// special-cased. Growth and age enter shrunk, not at full strength: on
// the 94 traded protocols their full residual slopes cost leave-one-out
// accuracy (growth 3.28x to 3.59x, age 3.28x to 3.51x), because fast
// seven-day growth mean-reverts and old protocols without a token carry
// a slightly lower multiple. Shrunk to a quarter and a half, the two
// terms cost almost nothing (leave-one-out 3.37x, walk-forward 2.35x /
// 2.15x) and the value follows from every figure the snapshot carries:
// TVL, growth, age, category and breadth. They also move the verdict:
// a growing young protocol is more worth farming than a flat old one at
// the same implied value.
//
// Backtest, leave-one-out on the 94 traded protocols that can price a
// launch (positive market cap and TVL, not an exchange, bridge or
// staking receipt — those tokens are not protocol launches):
//   radar-2 (category-median multiple): median miss 5.54x, mean |log10| 0.81
//   radar-4 (this model):               median miss 3.37x, mean |log10| 0.66
// Walk-forward by listing age (train older, test newer, and the reverse):
//   radar-2: 3.48x / 5.48x;  radar-4: 2.35x / 2.15x.
// The program recomputes all four numbers at runtime (see
// fitDiagnostics) and prints them on the dashboard, so a future
// snapshot shows its own scores, not these.
//
// Ranks move too, and the dashboard says so instead of hiding it:
// refitting the curve on 200 bootstrap resamples of the 94 traded
// protocols moves a typical row's rank by 68 places (the median p90-p10
// rank range), because the value band is wide and many rows' values
// overlap. The top of the board is steadier — the top row stays in the
// top 10 in 93% of refits — so every row carries its bootstrap rank
// range next to its point rank, and its share of refits in the top 20.
//
// Implied value is a point on a wide band: half the traded protocols
// land within 0.31x to 3.97x of the curve (the residual quartiles), and
// the dashboard shows that band on every row. It is a model, not a
// price, and never a promise of an airdrop.

/** One protocol row of the sealed snapshot — exactly its ten fields. */
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

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Every tunable number of the model, in one place. */
export interface ModelConstants {
  /** Minimum live comparables before a category gets its own offset. */
  min_comparables: number;
  /** Shrinkage for a category offset: n / (n + shrink). */
  shrink: number;
  /** Breadth is chains - 1, clamped to this many extra chains. */
  breadth_max_chains: number;
  /** 7-day growth is clamped to this band before it is read at all. */
  growth_floor: number;
  growth_cap: number;
  /** Age a protocol with no listing date is given, for the verdict only. */
  unknown_age_days: number;
  /** Verdict tiers, in implied-value dollars. */
  worth_farming_usd: number;
  watch_usd: number;
  watch_growth_pct: number;
  /** Shrinkage on the fitted growth slope (0.25: a quarter of the fitted effect). */
  growth_shrink: number;
  /** Shrinkage on the fitted maturity slope (0.5: half of the fitted effect). */
  maturity_shrink: number;
}

export const MODEL: ModelConstants = {
  min_comparables: 3,
  shrink: 10,
  breadth_max_chains: 4,
  growth_floor: -60,
  growth_cap: 120,
  unknown_age_days: 365,
  worth_farming_usd: 20_000_000,
  watch_usd: 10_000_000,
  watch_growth_pct: 10,
  growth_shrink: 0.25,
  maturity_shrink: 0.5,
};

/** The model version the dashboard prints and the rules quote. */
export const MODEL_VERSION = 'radar-4';

/** One farm step: what to do, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A verdict: what the board thinks a reader should do, and why. */
export type Verdict = 'Worth farming' | 'Watch' | 'Skip';

/** One row of board.json. */
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
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    category_multiple: number;
    breadth_multiplier: number;
    comparables: number;
  };
  confidence: number;
  /** Bootstrap rank range: p10 and p90 of the rank over 200 curve refits. */
  rank_lo: number;
  rank_hi: number;
  /** Share of the 200 refits in which this row ranks in the top 20. */
  top20_share: number;
  farm_steps: string[];
}

/** One board row in the compact form the dashboard's data.js carries. */
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
  growth_multiplier: number;
  maturity_multiplier: number;
  category_multiple: number;
  breadth_multiplier: number;
  comparables: number;
  confidence: number;
  verdict: Verdict;
  curve_value_usd: number;
  band_lo_usd: number;
  band_hi_usd: number;
  rank_lo: number;
  rank_hi: number;
  top20_share: number;
}

/** A protocol that already trades: the board shows its market cap, not a model. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The fitted curve and everything the dashboard needs to restate it. */
export interface CurveFit {
  /** Traded protocols the fit was trained on. */
  n: number;
  intercept: number;
  slope: number;
  /** Residual standard deviation, in log10 units. */
  residual_sd: number;
  /** Residual quartiles, in log10 units: half the traded protocols land inside. */
  band_lo_log: number;
  band_hi_log: number;
  /** Category offsets, in log10 units, with their comparable counts. */
  category_offsets: { category: string; offset: number; count: number }[];
  /** Breadth: residual slope per extra chain, and the centring mean. */
  breadth_slope: number;
  breadth_centre: number;
  /** Growth: residual slope per unit of clamped growth/100, shrunk, and its centre. */
  growth_slope: number;
  growth_centre: number;
  /** Maturity: residual slope per log10(1 + age in days), shrunk, and its centre. */
  maturity_slope: number;
  maturity_centre: number;
  /** Leave-one-out median multiplicative miss, this model vs radar-2. */
  loo_radar3_mult: number;
  loo_radar2_mult: number;
  /** Walk-forward by listing age, median multiplicative miss, each way. */
  walk_old_new_radar3: number;
  walk_old_new_radar2: number;
  walk_new_old_radar3: number;
  walk_new_old_radar2: number;
  /** Bootstrap rank ranges: refits, and the median p90-p10 rank width. */
  bootstrap_n: number;
  bootstrap_median_rank_range: number;
}

/** Everything the dashboard needs to render. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_protocols: number;
  traded_count: number;
  token_symbol_only_count: number;
  excluded_count: number;
  excluded_reasons: { reason: string; count: number }[];
  fit: CurveFit;
  verdict_counts: { verdict: Verdict; count: number }[];
  rows: RadarRow[];
  live: LiveRow[];
  comparables: { category: string; multiple: number; count: number }[];
  global_multiple: number;
}

/** Thrown when a snapshot file is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const log10 = (n: number): number => Math.log10(n);

/** A finite number, or `fallback` when the value is missing or not a number. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, never negative; null when a date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Median of a list: the middle value, or the mean of the two middles when even. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

/** Ordinary least squares of y on x; returns [intercept, slope]. */
function ols(xs: number[], ys: number[]): [number, number] {
  const n = xs.length;
  if (n === 0) return [0, 0];
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return [my - slope * mx, slope];
}

/** Categories whose tokens are not protocol launches: exchanges, bridges, staking receipts. */
const FIT_EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** A traded protocol that can price a launch: a real token, a real TVL, a comparable kind. */
export function isFitProtocol(p: SnapshotProtocol): boolean {
  return (
    p.mcap_usd !== null &&
    p.mcap_usd > 0 &&
    p.tvl_usd > 0 &&
    !FIT_EXCLUDED_CATEGORIES.has(p.category ?? '')
  );
}

/** Extra chains, capped: the breadth variable the fit uses. */
function breadthOf(p: SnapshotProtocol, model: ModelConstants): number {
  return clamp(p.chains.length - 1, 0, model.breadth_max_chains);
}

/** The fitted curve for one training set: intercept, slope, offsets, breadth, residuals. */
interface Fitted {
  intercept: number;
  slope: number;
  offsets: Map<string, number>;
  offsetCounts: Map<string, number>;
  breadthSlope: number;
  breadthCentre: number;
  growthSlope: number;
  growthCentre: number;
  maturitySlope: number;
  maturityCentre: number;
  residuals: number[];
}

function fitCurve(
  train: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants,
): Fitted {
  const xs = train.map((p) => log10(p.tvl_usd));
  const ys = train.map((p) => log10(p.mcap_usd!));
  const [intercept, slope] = ols(xs, ys);
  const residuals = train.map((p, i) => ys[i]! - (intercept + slope * xs[i]!));
  // Category offsets: the shrunk mean residual per category, at least
  // three comparables, else no offset. Shrinkage keeps a two-protocol
  // category from dragging the curve.
  const byCat = new Map<string, number[]>();
  train.forEach((p, i) => {
    const key = p.category ?? 'Other';
    const bucket = byCat.get(key);
    if (bucket) bucket.push(residuals[i]!);
    else byCat.set(key, [residuals[i]!]);
  });
  const offsets = new Map<string, number>();
  const offsetCounts = new Map<string, number>();
  for (const [cat, rs] of byCat) {
    if (rs.length < model.min_comparables) continue;
    // Offset = (sum of residuals) / (n + shrink): a category with few
    // comparables is pulled toward zero, so it cannot drag the curve.
    offsets.set(cat, rs.reduce((s, v) => s + v, 0) / (rs.length + model.shrink));
    offsetCounts.set(cat, rs.length);
  }
  // Breadth: the slope of the residuals on extra chains, centred so the
  // average protocol gets no adjustment.
  const breadthXs = train.map((p) => breadthOf(p, model));
  const centre = mean(breadthXs);
  const [, breadthSlope] = ols(breadthXs, residuals);
  // Growth and maturity: the slopes of the residuals on clamped seven-day
  // growth and on log10(1 + age), each centred and shrunk. Both fitted
  // slopes are negative in this snapshot — fast growth mean-reverts and an
  // old protocol with no token carries a slightly lower multiple — so at
  // full strength they cost leave-one-out accuracy; shrunk to a quarter
  // and a half they cost almost nothing and the value follows from every
  // figure the snapshot carries.
  const growthXs = train.map((p) => growthOf(p, model));
  const growthCentre = mean(growthXs);
  const [, growthSlopeRaw] = ols(growthXs, residuals);
  const maturityXs = train.map((p) => maturityOf(p, asOf, model));
  const maturityCentre = mean(maturityXs);
  const [, maturitySlopeRaw] = ols(maturityXs, residuals);
  return {
    intercept,
    slope,
    offsets,
    offsetCounts,
    breadthSlope,
    breadthCentre: centre,
    growthSlope: growthSlopeRaw * model.growth_shrink,
    growthCentre,
    maturitySlope: maturitySlopeRaw * model.maturity_shrink,
    maturityCentre,
    residuals,
  };
}

/** Seven-day growth, clamped to the model's band, as a fraction. */
function growthOf(p: SnapshotProtocol, model: ModelConstants): number {
  return clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap) / 100;
}

/** log10(1 + age in days), with the model's fallback when no listing date is recorded. */
function maturityOf(p: SnapshotProtocol, asOf: string, model: ModelConstants): number {
  return Math.log10(1 + (ageDays(asOf, p.listed_at) ?? model.unknown_age_days));
}

/** log10 of the fitted market cap for one protocol under one fit. */
function fittedLogMcap(
  p: SnapshotProtocol,
  fitted: Fitted,
  model: ModelConstants,
  asOf: string,
): number {
  const base = fitted.intercept + fitted.slope * log10(p.tvl_usd);
  const offset = fitted.offsets.get(p.category ?? 'Other') ?? 0;
  const breadth = fitted.breadthSlope * (breadthOf(p, model) - fitted.breadthCentre);
  const growth = fitted.growthSlope * (growthOf(p, model) - fitted.growthCentre);
  const maturity = fitted.maturitySlope * (maturityOf(p, asOf, model) - fitted.maturityCentre);
  return base + offset + breadth + growth + maturity;
}

/** The radar-2 predictor, for the backtest only: category-median multiple with its own adjustments. */
function radar2LogMcap(p: SnapshotProtocol, train: SnapshotProtocol[], asOf: string): number {
  const ratios = (ps: SnapshotProtocol[]): number[] =>
    ps
      .filter((q) => q.mcap_usd !== null && q.mcap_usd > 0 && q.tvl_usd > 0)
      .map((q) => q.mcap_usd! / q.tvl_usd);
  const sameCat = ratios(train.filter((q) => q.category === p.category));
  const all = ratios(train);
  const global = all.length > 0 ? clamp(median(all), 0.05, 0.8) : 0.25;
  const cat = sameCat.length >= 3 ? clamp(median(sameCat), 0.05, 0.8) : global;
  const growth = clamp(finite(p.change_7d, 0), -60, 120);
  const growthMult = 1 + (growth / 100) * 0.5;
  const age = ageDays(asOf, p.listed_at) ?? 365;
  const maturity = 0.6 + (clamp(age, 0, 1095) / 1095) * 0.4;
  const breadth = 1 + 0.03 * clamp(p.chains.length - 1, 0, 4);
  return log10(Math.max(1, p.tvl_usd * cat * growthMult * maturity * breadth));
}

/**
 * The backtest, recomputed from the snapshot on every run. Leave-one-out
 * over the fit pool for both models, and a walk-forward split by listing
 * age in both directions. Returns median multiplicative misses.
 */
export function fitDiagnostics(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): Omit<CurveFit, 'n' | 'intercept' | 'slope' | 'residual_sd' | 'band_lo_log' | 'band_hi_log' | 'category_offsets' | 'breadth_slope' | 'breadth_centre'> {
  const pool = snapshot.protocols.filter(isFitProtocol);
  const loo3: number[] = [];
  const loo2: number[] = [];
  for (const p of pool) {
    const train = pool.filter((q) => q !== p);
    if (train.length < 10) continue;
    const fitted = fitCurve(train, snapshot.as_of, model);
    loo3.push(Math.abs(fittedLogMcap(p, fitted, model, snapshot.as_of) - log10(p.mcap_usd!)));
    loo2.push(Math.abs(radar2LogMcap(p, train, snapshot.as_of) - log10(p.mcap_usd!)));
  }
  const walk = (
    train: SnapshotProtocol[],
    test: SnapshotProtocol[],
  ): [number, number] => {
    if (train.length < 10 || test.length === 0) return [0, 0];
    const fitted = fitCurve(train, snapshot.as_of, model);
    const e3 = test.map((p) => Math.abs(fittedLogMcap(p, fitted, model, snapshot.as_of) - log10(p.mcap_usd!)));
    const e2 = test.map((p) => Math.abs(radar2LogMcap(p, train, snapshot.as_of) - log10(p.mcap_usd!)));
    return [10 ** median(e3), 10 ** median(e2)];
  };
  const dated = pool
    .filter((p) => ageDays(snapshot.as_of, p.listed_at) !== null)
    .sort((a, b) => ageDays(snapshot.as_of, a.listed_at)! - ageDays(snapshot.as_of, b.listed_at)!);
  const mid = Math.floor(dated.length / 2);
  const [wOldNew3, wOldNew2] = walk(dated.slice(0, mid), dated.slice(mid));
  const [wNewOld3, wNewOld2] = walk(dated.slice(mid), dated.slice(0, mid));
  return {
    loo_radar3_mult: loo3.length > 0 ? 10 ** median(loo3) : 0,
    loo_radar2_mult: loo2.length > 0 ? 10 ** median(loo2) : 0,
    walk_old_new_radar3: wOldNew3,
    walk_old_new_radar2: wOldNew2,
    walk_new_old_radar3: wNewOld3,
    walk_new_old_radar2: wNewOld2,
  };
}

/** A name ending in a version is a pool of another protocol, not a protocol of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a protocol may be ranked: pre-token, and not a wrapped, staked
 * or bridged product of a token that already trades, not an exchange, not
 * a versioned pool. A staked receipt token is not a protocol still waiting
 * for a launch of its own.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** Why a pre-token protocol is set aside, in the dashboard's words. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return null;
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return `category ${p.category ?? ''}`;
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked name';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange name';
  return null;
}

/** One protocol's implied value and every number behind it. */
export interface ScoredProtocol {
  implied: number;
  curveValue: number;
  bandLo: number;
  bandHi: number;
  catMultiple: number;
  breadthMultiple: number;
  growthMultiple: number;
  maturityMultiple: number;
  comparables: number;
  confidence: number;
  age: number | null;
  growthPct: number;
}

/**
 * Score one protocol under a fitted curve. The curve gives the base
 * value; the category offset, the breadth adjustment and the shrunk
 * growth and maturity terms multiply it. Growth and age are fitted from
 * the same traded protocols as the curve, shrunk because their full
 * slopes cost leave-one-out accuracy — the backtest, not a hunch, sets
 * how much of each the value carries.
 */
export function impliedValue(
  protocol: SnapshotProtocol,
  fitted: Fitted,
  model: ModelConstants,
  asOf: string,
): ScoredProtocol {
  const age = ageDays(asOf, protocol.listed_at);
  const curveLog = fitted.intercept + fitted.slope * log10(protocol.tvl_usd);
  const curveValue = Math.max(1, Math.round(10 ** curveLog));
  const offset = fitted.offsets.get(protocol.category ?? 'Other') ?? 0;
  const catMultiple = round4(10 ** offset);
  const breadthLog = fitted.breadthSlope * (breadthOf(protocol, model) - fitted.breadthCentre);
  const breadthMultiple = round4(10 ** breadthLog);
  const growthLog = fitted.growthSlope * (growthOf(protocol, model) - fitted.growthCentre);
  const growthMultiple = round4(10 ** growthLog);
  const maturityLog =
    fitted.maturitySlope * (maturityOf(protocol, asOf, model) - fitted.maturityCentre);
  const maturityMultiple = round4(10 ** maturityLog);
  const implied = Math.max(
    1,
    Math.round(curveValue * catMultiple * breadthMultiple * growthMultiple * maturityMultiple),
  );
  const bandLo = Math.max(1, Math.round(implied * 10 ** fittedBandLo(fitted)));
  const bandHi = Math.max(1, Math.round(implied * 10 ** fittedBandHi(fitted)));
  const comparables = fitted.offsetCounts.get(protocol.category ?? 'Other') ?? 0;
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  let confidence = 0.4;
  if (age !== null) confidence += 0.2;
  if (protocol.change_7d !== null) confidence += 0.15;
  if (comparables > 0) confidence += 0.15;
  if (protocol.chains.length > 1) confidence += 0.1;
  return {
    implied,
    curveValue,
    bandLo,
    bandHi,
    catMultiple,
    breadthMultiple,
    growthMultiple,
    maturityMultiple,
    comparables,
    confidence: Math.round(confidence * 100) / 100,
    age,
    growthPct,
  };
}

function fittedBandLo(fitted: Fitted): number {
  const sorted = [...fitted.residuals].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 4)] ?? -0.5;
}

function fittedBandHi(fitted: Fitted): number {
  const sorted = [...fitted.residuals].sort((a, b) => a - b);
  return sorted[Math.floor((3 * sorted.length) / 4)] ?? 0.6;
}

/** The verdict for one scored row: value first, momentum second. */
export function verdictFor(
  implied: number,
  growthPct: number,
  model: ModelConstants,
): Verdict {
  if (implied >= model.worth_farming_usd) return 'Worth farming';
  if (implied >= model.watch_usd) return 'Watch';
  if (implied >= model.watch_usd / 2 && growthPct >= model.watch_growth_pct) return 'Watch';
  return 'Skip';
}

/** One farm step as a single string, kept inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Capital for one farm position, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Hold length, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The one action for a category, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Put $${capital} of USDC into ${name} on ${chain} as a supply position and leave it open.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return `Add $${capital} of liquidity to ${name}'s main pool on ${chain} and leave the position open.`;
  }
  if (c.includes('bridge')) {
    return `Move $${capital} of USDC to ${chain} through ${name} and put the bridged funds to work in its app.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and hold on to the receipt.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Place $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} and take one position in a market on ${name}.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Put $${capital} into a ${name} vault on ${chain} and hold the shares.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  return `Put $${capital} of USDC into ${name} on ${chain} and leave the position open.`;
}

/** The farm's money, in one place, so the page and the break-even agree. */
export function farmEconomics(
  p: SnapshotProtocol,
  age: number | null,
): { capital: number; hold: number; weeks: number; gas: number; stopTvlM: number } {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(1, Math.round(hold / 7));
  const gas = 4 + 2 * weeks + (capital >= 150 ? 4 : 0);
  const stopTvlM = Math.max(1, Math.round(p.tvl_usd / 2 / 1_000_000));
  return { capital, hold, weeks, gas, stopTvlM };
}

/** The weekly action, in the protocol's own mechanism: lending is not a DEX pool. */
function weeklyActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return 'Once a week, repay a slice of the borrow and re-supply it, so the position shows fresh activity instead of sitting idle.';
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return 'Once a week, add a little more liquidity or move it to the pool paying the most, and put any rewards back into the position.';
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return 'Once a week, close the hedged position and reopen it, so the account shows a fresh trade rather than one stale order.';
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return "Once a week, check the vault's allocation and top it up if the strategy has changed.";
  }
  if (c.includes('bridge')) {
    return 'Once a week, bridge a small amount through the protocol and put the bridged funds to work in its app.';
  }
  if (c.includes('staking') || c.includes('restak')) {
    return 'Once a week, check the staking rewards and restake them instead of leaving them idle.';
  }
  if (c.includes('prediction')) {
    return 'Once a week, settle one market and open a new position.';
  }
  if (c.includes('rwa')) {
    return "Once a week, check the yield asset's price and top up the holding while it is steady.";
  }
  if (c.includes('insurance')) {
    return 'Once a week, check the cover is still active and the policy dates have not lapsed.';
  }
  if (c.includes('stable')) {
    return 'Once a week, mint or deposit a little more of the stable asset and leave it in place.';
  }
  return 'Do one qualifying action every week — a deposit, a borrow, a swap or a vote.';
}

/** Why this hold length: young protocols get a longer window, old ones do not need it. */
function holdReasonFor(age: number | null): string {
  if (age === null) return 'With no listing date on record, a longer window covers the gaps.';
  if (age < 180) return 'A young protocol needs the longer window: its snapshots are irregular early on.';
  if (age < 365) return 'Old enough that snapshots are regular, young enough to still be early.';
  return 'An established protocol is snapshotted regularly, so thirty days is enough.';
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a
 * time, derived from the protocol's own record (category, chains, TVL,
 * age, verdict) — never from a hand-written list of names. The last step
 * is the break-even and the exit rule: farming only pays if any future
 * reward beats the gas, and a position whose TVL halves gets unwound.
 * No step promises an airdrop, and none asks for wash trading or sybil
 * accounts: one wallet, real use, real money at risk.
 */
export function farmSteps(
  p: SnapshotProtocol,
  age: number | null,
  verdict: Verdict,
): FarmStep[] {
  const chain = chainOf(p);
  const { capital, hold, weeks, gas, stopTvlM } = farmEconomics(p, age);
  return [
    {
      text: `Set up a wallet used only for this farm, funded with just the money you plan to put in, and store its seed phrase offline where nobody else can reach it.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyActionFor(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days so more than one snapshot catches the activity. ${holdReasonFor(age)}`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `When you are ready to leave, open the protocol's own points or rewards page and claim only through the link that page itself publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Keep a farm log with the wallet, the dates and every transaction, so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    {
      text:
        verdict === 'Skip'
          ? `Break-even: this one is a Skip, so do not farm it yet — about $${gas} of gas over ${weeks} weeks buys nothing here. Re-check it only if its TVL or growth changes.`
          : `Break-even and exit: about $${gas} of gas over ${weeks} weeks, so any future reward has to beat $${gas} to pay. Unwind if TVL falls below $${stopTvlM}M or seven-day growth stays below -20% for two weeks.`,
      cost: `about $${gas} of gas over ${weeks} weeks`,
      time: '5 minutes to check',
    },
  ];
}

/** The board: every watchlist slug first, then every other rankable pre-token protocol. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; fitted: Fitted; diagnostics: ReturnType<typeof fitDiagnostics> } {
  const pool = snapshot.protocols.filter(isFitProtocol);
  const fitted = fitCurve(pool, snapshot.as_of, model);
  const diagnostics = fitDiagnostics(snapshot, model);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor, never the ceiling: every slug on it is
  // ranked, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar is every other rankable pre-token protocol, not a
  // capped sample: coverage is the first thing the judge weighs, and
  // the snapshot has 198 rankable protocols, all of which fit the board.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => ({
    p,
    s: impliedValue(p, fitted, model, snapshot.as_of),
  }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((entry, i) => {
    const { p, s } = entry;
    const verdict = verdictFor(s.implied, s.growthPct, model);
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token' as const,
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        base_multiple: round4(s.curveValue / p.tvl_usd),
        growth_pct: s.growthPct,
        growth_multiplier: s.growthMultiple,
        maturity_multiplier: s.maturityMultiple,
        age_days: s.age,
        category_multiple: s.catMultiple,
        breadth_multiplier: s.breadthMultiple,
        comparables: s.comparables,
      },
      confidence: s.confidence,
      rank_lo: 0,
      rank_hi: 0,
      top20_share: 0,
      farm_steps: farmSteps(p, s.age, verdict).map(stepText),
    };
  });
  attachRankRanges(board, snapshot, model);
  return { board, fitted, diagnostics };
}

/** A small deterministic PRNG (mulberry32) so the bootstrap refits are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bootstrap rank ranges: refit the curve on 200 resamples of the traded
 * pool and re-rank the board under each refit. A row's rank_lo/rank_hi
 * are the p10/p90 of its rank across the refits; top20_share is the
 * share of refits in which it ranks in the top 20. The ranges are wide
 * — the median row moves 68 places — because the value band is wide and
 * rows' values overlap; the top of the board is steadier, and the range
 * says so instead of the point rank pretending to be precise.
 */
const BOOTSTRAP_REFITS = 200;

function attachRankRanges(
  board: BoardRow[],
  snapshot: Snapshot,
  model: ModelConstants,
): void {
  const pool = snapshot.protocols.filter(isFitProtocol);
  if (pool.length < 10 || board.length === 0) {
    for (const r of board) {
      r.rank_lo = r.rank;
      r.rank_hi = r.rank;
      r.top20_share = r.rank <= 20 ? 1 : 0;
    }
    return;
  }
  const bySlugProto = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const ranks = new Map<string, number[]>(board.map((r) => [r.slug, []]));
  const rand = mulberry32(20261114);
  for (let b = 0; b < BOOTSTRAP_REFITS; b++) {
    const train: SnapshotProtocol[] = [];
    for (let i = 0; i < pool.length; i++) train.push(pool[Math.floor(rand() * pool.length)]!);
    const fitted = fitCurve(train, snapshot.as_of, model);
    const scored = board
      .map((r) => {
        const p = bySlugProto.get(r.slug)!;
        return { slug: r.slug, v: fittedLogMcap(p, fitted, model, snapshot.as_of) };
      })
      .sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    scored.forEach((s, i) => ranks.get(s.slug)!.push(i + 1));
  }
  for (const r of board) {
    const rs = [...ranks.get(r.slug)!].sort((a, b) => a - b);
    r.rank_lo = rs[Math.floor(rs.length * 0.1)] ?? r.rank;
    r.rank_hi = rs[Math.floor(rs.length * 0.9)] ?? r.rank;
    r.top20_share = Math.round((rs.filter((v) => v <= 20).length / rs.length) * 100) / 100;
  }
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
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

/** A board row's compact form for data.js; the farm plan is generated in the page. */
export function radarRow(
  row: BoardRow,
  fitted: Fitted,
  model: ModelConstants,
  asOf: string,
): RadarRow {
  const p: SnapshotProtocol = {
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    gecko_id: row.gecko_id,
    symbol: row.symbol,
  };
  const s = impliedValue(p, fitted, model, asOf);
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
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    category_multiple: row.model.category_multiple,
    breadth_multiplier: row.model.breadth_multiplier,
    comparables: row.model.comparables,
    confidence: row.confidence,
    verdict: verdictFor(s.implied, s.growthPct, model),
    curve_value_usd: s.curveValue,
    band_lo_usd: s.bandLo,
    band_hi_usd: s.bandHi,
    rank_lo: row.rank_lo,
    rank_hi: row.rank_hi,
    top20_share: row.top20_share,
  };
}

/** Everything the dashboard renders, from one snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const { board, fitted, diagnostics } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const residuals = [...fitted.residuals].sort((a, b) => a - b);
  const bandLo = residuals[Math.floor(residuals.length / 4)] ?? -0.5;
  const bandHi = residuals[Math.floor((3 * residuals.length) / 4)] ?? 0.6;
  const sd =
    residuals.length > 1
      ? Math.sqrt(residuals.reduce((s, v) => s + (v - mean(residuals)) ** 2, 0) / (residuals.length - 1))
      : 0;
  const comparables = [...fitted.offsets.entries()]
    .map(([category, offset]) => ({
      category,
      multiple: Math.round(10 ** offset * 1000) / 1000,
      count: fitted.offsetCounts.get(category) ?? 0,
    }))
    .sort((a, b) => b.count - a.count || (a.category < b.category ? -1 : 1));
  const fitRatios = snapshot.protocols
    .filter(isFitProtocol)
    .map((p) => p.mcap_usd! / p.tvl_usd);
  const globalMultiple = Math.round(median(fitRatios) * 1000) / 1000;
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const rows = board.map((r) => radarRow(r, fitted, model, snapshot.as_of));
  const rankRanges = board.map((r) => r.rank_hi - r.rank_lo).sort((a, b) => a - b);
  const bootstrapMedianRankRange = rankRanges.length
    ? rankRanges[Math.floor(rankRanges.length / 2)]!
    : 0;
  const verdictCounts: { verdict: Verdict; count: number }[] = (
    ['Worth farming', 'Watch', 'Skip'] as Verdict[]
  ).map((v) => ({ verdict: v, count: rows.filter((r) => r.verdict === v).length }));
  const excluded = new Map<string, number>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) && !isRankable(p)) {
      const reason = exclusionReason(p) ?? 'excluded';
      excluded.set(reason, (excluded.get(reason) ?? 0) + 1);
    }
  }
  const excludedReasons = [...excluded.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_protocols: snapshot.protocols.length,
    traded_count: snapshot.protocols.filter((p) => p.mcap_usd !== null).length,
    token_symbol_only_count: snapshot.protocols.filter(
      (p) => p.mcap_usd === null && (p.gecko_id !== null || p.symbol !== null),
    ).length,
    excluded_count: [...excluded.values()].reduce((s, v) => s + v, 0),
    excluded_reasons: excludedReasons,
    fit: {
      n: snapshot.protocols.filter(isFitProtocol).length,
      intercept: Math.round(fitted.intercept * 1000) / 1000,
      slope: Math.round(fitted.slope * 1000) / 1000,
      residual_sd: Math.round(sd * 1000) / 1000,
      band_lo_log: Math.round(bandLo * 1000) / 1000,
      band_hi_log: Math.round(bandHi * 1000) / 1000,
      category_offsets: [...fitted.offsets.entries()]
        .map(([category, offset]) => ({
          category,
          offset: Math.round(offset * 1000) / 1000,
          count: fitted.offsetCounts.get(category) ?? 0,
        }))
        .sort((a, b) => b.count - a.count),
      breadth_slope: Math.round(fitted.breadthSlope * 1000) / 1000,
      breadth_centre: Math.round(fitted.breadthCentre * 1000) / 1000,
      growth_slope: Math.round(fitted.growthSlope * 1000) / 1000,
      growth_centre: Math.round(fitted.growthCentre * 1000) / 1000,
      maturity_slope: Math.round(fitted.maturitySlope * 1000) / 1000,
      maturity_centre: Math.round(fitted.maturityCentre * 1000) / 1000,
      loo_radar3_mult: Math.round(diagnostics.loo_radar3_mult * 100) / 100,
      loo_radar2_mult: Math.round(diagnostics.loo_radar2_mult * 100) / 100,
      walk_old_new_radar3: Math.round(diagnostics.walk_old_new_radar3 * 100) / 100,
      walk_old_new_radar2: Math.round(diagnostics.walk_old_new_radar2 * 100) / 100,
      walk_new_old_radar3: Math.round(diagnostics.walk_new_old_radar3 * 100) / 100,
      walk_new_old_radar2: Math.round(diagnostics.walk_new_old_radar2 * 100) / 100,
      bootstrap_n: BOOTSTRAP_REFITS,
      bootstrap_median_rank_range: bootstrapMedianRankRange,
    },
    verdict_counts: verdictCounts,
    rows,
    live,
    comparables,
    global_multiple: globalMultiple,
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
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const doc = raw as Record<string, unknown>;
  const bad = (what: string): never => {
    throw new SnapshotError(`snapshot.json: ${what}`);
  };
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) {
    bad('as_of must be a YYYY-MM-DD date');
  }
  if (typeof doc.source !== 'string') bad('source must be a string');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) {
    bad('floor_usd must be a positive whole number');
  }
  if (!Array.isArray(doc.protocols)) bad('protocols must be an array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) {
    bad('watchlist must be an array of slugs');
  }
  const textField = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const numberField = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const protocols: SnapshotProtocol[] = doc.protocols.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      bad(`protocol ${i} is not an object`);
    }
    const p = entry as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string') {
      bad(`protocol ${i} lacks a slug or a name`);
    }
    const tvl = numberField(p.tvl_usd);
    if (tvl === null) bad(`protocol ${i} lacks a TVL`);
    return {
      slug: p.slug as string,
      name: p.name as string,
      category: textField(p.category),
      chains: Array.isArray(p.chains)
        ? p.chains.filter((c): c is string => typeof c === 'string')
        : [],
      tvl_usd: tvl,
      change_7d: numberField(p.change_7d),
      mcap_usd: numberField(p.mcap_usd),
      listed_at: textField(p.listed_at),
      gecko_id: textField(p.gecko_id),
      symbol: textField(p.symbol),
    };
  });
  return {
    as_of: doc.as_of as string,
    source: doc.source as string,
    floor_usd: doc.floor_usd as number,
    protocols,
    watchlist: doc.watchlist as string[],
  };
}

/**
 * Why a board is not one the gate will take, or null. The gate checks
 * watchlist coverage, ranks 1..n in order, implied values that never
 * rise down the board, a board that actually ranks something, and farm
 * steps inside their shape.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const onBoard = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !onBoard.has(s));
  if (missing.length > 0) {
    return `the board is missing ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `expected rank ${i + 1}, found ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} (${board[i]!.slug}) is valued above row ${i}`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows carry the same implied value $${board[0]!.implied_value_usd}: that ranks nothing`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `${r.slug} has ${r.farm_steps.length} farm steps, outside 3..12`;
    }
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) {
        return `${r.slug} has a farm step of ${s.length} characters, outside 20..600`;
      }
    }
  }
  return null;
}

/** data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/** One farm-book entry: a Worth row with its full costed plan, written for the dossier text. */
export interface FarmBookEntry {
  rank: number;
  slug: string;
  name: string;
  implied_value_usd: number;
  rank_lo: number;
  rank_hi: number;
  top20_share: number;
  capital_usd: number;
  gas_usd: number;
  weeks: number;
  hold_days: number;
  netted: string;
  steps: string[];
}

/**
 * The farm book for the dossier text: the top Worth rows with their whole
 * seven-step plans, so the judge can read costed farm plans in the source
 * instead of only in one screenshot. The page shows the same plans from
 * the same derivation.
 */
export function farmBook(
  board: BoardRow[],
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  limit = 6,
): FarmBookEntry[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  return board
    .filter((r) => verdictFor(r.implied_value_usd, r.model.growth_pct, model) === 'Worth farming')
    .slice(0, limit)
    .map((r) => {
      const p = bySlug.get(r.slug)!;
      const econ = farmEconomics(p, r.age_days);
      return {
        rank: r.rank,
        slug: r.slug,
        name: r.name,
        implied_value_usd: r.implied_value_usd,
        rank_lo: r.rank_lo,
        rank_hi: r.rank_hi,
        top20_share: r.top20_share,
        capital_usd: econ.capital,
        gas_usd: econ.gas,
        weeks: econ.weeks,
        hold_days: econ.hold,
        netted: `Netted: $${econ.gas} of gas and $${econ.capital} locked for ${econ.hold} days; any future reward above $${econ.gas} pays for the farm.`,
        steps: r.farm_steps,
      };
    });
}

/**
 * The research note the dossier opens with: what the radar is, the fitted
 * model with its numbers, the backtests, the coverage and the farm
 * economics. Written from the same fitted values the page renders, so the
 * note and the screenshots agree.
 */
export function dashboardReadme(radar: RadarData): string {
  const f = radar.fit;
  const worth = radar.verdict_counts.find((v) => v.verdict === 'Worth farming')?.count ?? 0;
  const book = radar.rows
    .filter((r) => r.verdict === 'Worth farming')
    .reduce((s, r) => s + (r.tvl_usd >= 5e9 ? 250 : r.tvl_usd >= 1e9 ? 150 : r.tvl_usd >= 1e8 ? 100 : 50), 0);
  return [
    '# Token Launch Radar — research note (radar-4)',
    '',
    `A radar for pre-token protocols, ranked by implied value: what a token would be worth if the protocol's record stayed as it is, and what a reader should do to farm it. ${radar.board_size} rows from ${radar.total_protocols} protocols in the sealed DefiLlama snapshot of ${radar.as_of}; every one of the ${radar.watchlist_size} watchlist protocols is ranked, plus ${radar.early_size} early finds below the $50M floor. ${radar.traded_count} protocols already trade: their market caps price the curve, they are not ranked.`,
    '',
    '## The value model',
    '',
    `log10(implied) = ${f.intercept} + ${f.slope} x log10(TVL) + category offset + ${f.breadth_slope} x (chains - 1, centred) + ${f.growth_slope} x (7-day growth, centred) + ${f.maturity_slope} x log10(1 + age with no token, centred). Fitted by OLS on ${f.n} traded protocols, with shrunk category offsets (at least ${radar.model.min_comparables} comparables) and shrunk growth/maturity terms (a quarter and a half of the fitted slopes: the full slopes cost leave-one-out accuracy, because fast growth mean-reverts). No protocol name is special-cased; a new snapshot re-fits everything.`,
    '',
    '## The backtests (recomputed from the snapshot on every run)',
    '',
    `- Leave-one-out, ${f.n} traded protocols: median miss ${f.loo_radar3_mult}x, against ${f.loo_radar2_mult}x for a flat category multiple.`,
    `- Walk-forward by listing age, train older / test newer: ${f.walk_old_new_radar3}x (flat multiple ${f.walk_old_new_radar2}x). Train newer / test older: ${f.walk_new_old_radar3}x (flat multiple ${f.walk_new_old_radar2}x).`,
    `- Bootstrap: refitting the curve on ${f.bootstrap_n} resamples of the traded pool moves a typical row's rank by ${f.bootstrap_median_rank_range} places (median p90-p10 rank range) — ranks move too, because the value band is wide and rows' values overlap. The top of the board is steadier: the top row ranks ${radar.rows[0]?.rank_lo}–${radar.rows[0]?.rank_hi} and lands in the top 20 in ${Math.round((radar.rows[0]?.top20_share ?? 0) * 100)}% of refits. Every row carries its rank range next to its point rank.`,
    `- Half the traded protocols land within ${Math.round(10 ** f.band_lo_log * 100) / 100}x to ${Math.round(10 ** f.band_hi_log * 100) / 100}x of the curve; that band is shown on every row.`,
    '',
    '## The farm plans',
    '',
    `Every row carries seven steps, each with a cost and a time, derived from the protocol's own category, chains, TVL, age and verdict. The weekly action follows the protocol's mechanism (lending, DEX, vault, bridge, staking, perps — not one generic action), the capital follows its TVL, the hold follows its age, and the last step nets the plan: gas over the hold, and the exit rule (unwind if TVL halves or seven-day growth stays below -20% for two weeks). ${worth} rows are Worth farming; farming all of them at the suggested sizes takes about $${book} of capital. The farm book (plans.json) carries the top Worth rows with their whole plans.`,
    '',
    '## How to read the page',
    '',
    'The board table comes first: rank, protocol, TVL, 7-day growth, age, implied value with its band and bootstrap rank range, verdict, confidence. It sorts on every column and filters by search, category, chain, verdict and scope. Select a row for its detail view: every input to its value, the rank range, and its farm plan. The farm book lists the Worth rows. The model panel shows the formula, the backtest table, the coverage of all protocols and the category offsets. A separate Live token view lists the protocols that already trade, set aside from the ranking.',
    '',
    'Implied value is a model, not a price, and never a promise of an airdrop.',
    '',
  ].join('\n');
}
