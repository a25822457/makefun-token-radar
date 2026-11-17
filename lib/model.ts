// Token Launch Radar — the scoring model (radar-2).
//
// One sealed DefiLlama snapshot goes in, one ranked board comes out. The
// snapshot's live-token half prices its pre-token half: a pre-token
// protocol is valued at the median market-cap / TVL of the live-token
// protocols in its own category, so a new snapshot re-prices every
// category by itself and no protocol name is ever special-cased.
//
//   implied = round(tvl * categoryMultiple
//                   * (1 + clamped 7d change / 100 * 0.5)
//                   * (0.6 + min(age, 1095) / 1095 * 0.4)
//                   * (1 + 0.03 * min(chains - 1, 4)))
//
// Confidence is reported on every row but never moves a rank: it only
// counts how much the snapshot actually knows about the protocol.

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
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  min_comparables: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_floor: 0.05,
  multiple_cap: 0.8,
  breadth_per_chain: 0.03,
  breadth_max_chains: 4,
  min_comparables: 3,
};

/** The model version the dashboard prints and the rules quote. */
export const MODEL_VERSION = 'radar-2';

/** Early-radar cap: pre-token protocols below the watchlist floor, by TVL. */
export const EARLY_ROWS = 160;

/** Live-token view cap: live protocols shown, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: what to do, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

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
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A category's comparable multiple, and how many live protocols back it. */
export interface CategoryMultiple {
  multiple: number;
  comparables: number;
  fallback: boolean;
}

/**
 * Comparable multiples, computed from this snapshot alone. For every
 * category, the median mcap/TVL of its live-token protocols (both figures
 * present, TVL above zero); categories with fewer than three comparables
 * get no entry and fall back to the global median. The global median is
 * clamped to the same [0.05, 0.80] band as every category multiple.
 */
export function categoryMultiples(
  snapshot: Snapshot,
  model: ModelConstants,
): { byCategory: Map<string, CategoryMultiple>; global: number } {
  const perCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const bucket = perCategory.get(key);
    if (bucket) bucket.push(ratio);
    else perCategory.set(key, [ratio]);
  }
  const rawGlobal = all.length > 0 ? median(all) : model.base_multiple;
  const global = clamp(rawGlobal, model.multiple_floor, model.multiple_cap);
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, ratios] of perCategory) {
    if (ratios.length < model.min_comparables) continue;
    byCategory.set(category, {
      multiple: clamp(median(ratios), model.multiple_floor, model.multiple_cap),
      comparables: ratios.length,
      fallback: false,
    });
  }
  return { byCategory, global };
}

function multipleFor(
  p: SnapshotProtocol,
  multiples: { byCategory: Map<string, CategoryMultiple>; global: number },
): CategoryMultiple {
  return multiples.byCategory.get(p.category ?? 'Other') ?? {
    multiple: multiples.global,
    comparables: 0,
    fallback: true,
  };
}

/** Confidence 0..1: age known, 7d growth known, a backed category, more than one chain. */
function confidenceFor(p: SnapshotProtocol, age: number | null, cm: CategoryMultiple): number {
  let score = 0.4;
  if (age !== null) score += 0.2;
  if (p.change_7d !== null) score += 0.15;
  if (!cm.fallback) score += 0.15;
  if (p.chains.length > 1) score += 0.1;
  return Math.round(score * 100) / 100;
}

export interface ScoredProtocol {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
  catMult: number;
  breadthMult: number;
  comparables: number;
  confidence: number;
}

/**
 * One protocol's implied value and every multiplier behind it. The
 * category multiple is rounded to four decimals before pricing, because
 * the dashboard stores the rounded multiple and recomputes the row from
 * it — the two must agree to the dollar.
 */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples?: { byCategory: Map<string, CategoryMultiple>; global: number },
): ScoredProtocol {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const cm = multiples
    ? multipleFor(protocol, multiples)
    : { multiple: model.base_multiple, comparables: 0, fallback: true };
  const catMult = round4(cm.multiple);
  const breadthMult =
    1 + model.breadth_per_chain * clamp(protocol.chains.length - 1, 0, model.breadth_max_chains);
  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * catMult * growthMult * maturityMult * breadthMult),
  );
  return {
    implied,
    growthPct,
    growthMult,
    maturityMult,
    age,
    catMult,
    breadthMult,
    comparables: cm.comparables,
    confidence: confidenceFor(protocol, age, cm),
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

/** The board: every watchlist slug first, then the early radar below the floor. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor, never the ceiling: every slug on it is
  // ranked, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the floor, by
  // TVL, capped. A chosen protocol stays chosen; this only adds rows.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(slug, p);

  const scored = [...chosen.values()].map((p) => ({
    p,
    s: impliedValue(p, snapshot.as_of, model, multiples),
  }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((entry, i) => {
    const { p, s } = entry;
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
        base_multiple: round4(s.catMult),
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        age_days: s.age,
        category_multiple: round4(s.catMult),
        breadth_multiplier: round4(s.breadthMult),
        comparables: s.comparables,
      },
      confidence: s.confidence,
      farm_steps: farmSteps(p, s.age).map(stepText),
    };
  });
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
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} and place one market position on ${name}.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a
 * time, derived from the protocol's own record (category, chains, TVL,
 * age) — never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
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

/** A board row's compact form for data.js; the farm plan is generated in the page. */
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
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    category_multiple: row.model.category_multiple,
    breadth_multiplier: row.model.breadth_multiplier,
    comparables: row.model.comparables,
    confidence: row.confidence,
  };
}

/** Everything the dashboard renders, from one snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = categoryMultiples(snapshot, model);
  const comparables = [...multiples.byCategory.entries()]
    .map(([category, v]) => ({
      category,
      multiple: Math.round(v.multiple * 1000) / 1000,
      count: v.comparables,
    }))
    .sort((a, b) => b.count - a.count || (a.category < b.category ? -1 : 1));
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
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
    rows: board.map(radarRow),
    live,
    comparables,
    global_multiple: Math.round(multiples.global * 1000) / 1000,
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
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (
      typeof p.slug !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.tvl_usd !== 'number' ||
      !Number.isFinite(p.tvl_usd)
    ) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains)
        ? p.chains.filter((c): c is string => typeof c === 'string')
        : [],
      tvl_usd: p.tvl_usd,
      change_7d:
        typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd:
        typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
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

/**
 * Why a board is not one the gate will take, or null: watchlist coverage,
 * ranks 1..n, implied values in descending order, no board where every
 * row shares one value, and farm steps within their shape.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `${r.slug} has ${r.farm_steps.length} farm steps`;
    }
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
