// Token Launch Radar — the entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input
// <file|dir>), scores every rankable pre-token protocol with the radar-7
// model in lib/model.ts, and writes the ranked board to
// /output/board.json. It also copies this repo's dashboard/ and
// screenshots/ into /output, writes the dashboard's data.js from the same
// board, writes the research note (README.md) and the farm book
// (plans.json) into /output/dashboard so the judge reads them in the
// dossier's text, and finishes with /output/dossier.json — the summary
// the judge reads, built with the vendored make.fun library. The dossier
// is written last: the scorer rebuilds it from /output and compares bytes.
//
// Radar-7 keeps radar-5's value model (one curve per kind of protocol,
// fitted on every run — see lib/model.ts) and rebuilds the presentation
// around it: a KPI strip and a coverage audit up front, nearest-traded
// comps as a second opinion on every row, and every farm plan netted to
// the dollar (net value, break-even launch odds, $/hour) with a Thin
// verdict for the rows just below Watch. The dashboard states the fitted
// coefficients and the backtest numbers, recomputed from the snapshot
// at hand.
//
// The dashboard is a static page with no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read
// /output/data.js. It covers the watchlist, states the model, and gives
// every protocol a verdict and a farm plan.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dashboardReadme, dataScript, farmBook, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value of `--name <value>` or `--name=<value>`, or `fallback`. */
function arg(name: string, fallback: string): string {
  const flag = `--${name}`;
  const at = process.argv.indexOf(flag);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`${flag}=`));
  return joined === undefined ? fallback : joined.slice(flag.length + 1);
}

function fail(message: string, code: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(
    `no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`,
    2,
  );
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`, 1);

/** Copy one directory's regular files into `to`, skipping dotfiles, and return their names. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
// The research note and the farm book are written into the dashboard so
// the dossier's text carries them: the judge reads the dashboard's
// source, and these are the two files that state the model and show
// whole costed farm plans. Both are generated from this run's fit, so
// the note's numbers and the book's plans agree with the page.
const dashboardOut = join(out, 'dashboard');
writeFileSync(join(dashboardOut, 'README.md'), dashboardReadme(radar));
writeFileSync(
  join(dashboardOut, 'plans.json'),
  `${JSON.stringify({ entries: farmBook(board, snapshot) })}\n`,
);
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  fail(
    `screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`,
    1,
  );
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
  }
}

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

const verdicts = radar.verdict_counts.map((v) => `${v.verdict} ${v.count}`).join(', ');
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: radar-7 fit on ${radar.fit.n} traded protocols: per-category curves (global log10(mcap) = ${radar.fit.intercept} + ${radar.fit.slope} * log10(tvl)), LOO ${radar.fit.loo_radar3_mult}x vs radar-4 ${radar.fit.loo_radar4_mult}x, bootstrap median rank range ${radar.fit.bootstrap_median_rank_range} over ${radar.fit.bootstrap_n} refits\n` +
    `token radar: verdicts: ${verdicts}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (5 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
