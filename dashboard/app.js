// Token Radar's plain dashboard, radar-4. It reads window.RADAR (written
// beside dashboard/ by main.ts) and renders the ranked board, a filterable
// table, a per-protocol detail drawer with the model's own inputs, the
// verdict and the protocol's farm plan. No network: every byte it shows
// is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', verdict: 'all', earlyOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return money.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === undefined || n === null || !isFinite(n)) return 'n/a';
    return 'x' + n.toFixed(2);
  }
  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code
  // and the board's data are visibly the same arithmetic. Radar-4: the
  // size curve gives the base value, and the category offset, the breadth
  // adjustment and the shrunk growth and maturity terms multiply it.
  function impliedOf(row) {
    var curve = row.curve_value_usd === undefined ? row.tvl_usd * 0.2 : row.curve_value_usd;
    var cat = row.category_multiple === undefined ? 1 : row.category_multiple;
    var breadth = row.breadth_multiplier === undefined ? 1 : row.breadth_multiplier;
    var growth = row.growth_multiplier === undefined ? 1 : row.growth_multiplier;
    var maturity = row.maturity_multiplier === undefined ? 1 : row.maturity_multiplier;
    return Math.max(1, Math.round(curve * cat * breadth * growth * maturity));
  }

  // Small DOM builder: el('div', {class: 'x', text: 'hi'}, child, ...) —
  // attrs named class/text/html/on* are special, the rest become attributes.
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        child.forEach(function (c) { if (c) node.appendChild(c); });
      } else if (typeof child === 'string') {
        node.appendChild(document.createTextNode(child));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL, age and verdict decide the action, the
  // capital, the hold, the gas and the exit rule. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Put $' + capital + ' of USDC into ' + name + ' on ' + chain + ' as a supply position and leave it open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Add $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and leave the position open.';
    if (c.indexOf('bridge') >= 0) return 'Move $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and put the bridged funds to work in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and hold on to the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Place $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and take one position in a market on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Put $' + capital + ' into a ' + name + ' vault on ' + chain + ' and hold the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    return 'Put $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and leave the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function weeklyActionFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Once a week, repay a slice of the borrow and re-supply it, so the position shows fresh activity instead of sitting idle.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Once a week, add a little more liquidity or move it to the pool paying the most, and put any rewards back into the position.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Once a week, close the hedged position and reopen it, so the account shows a fresh trade rather than one stale order.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return "Once a week, check the vault's allocation and top it up if the strategy has changed.";
    if (c.indexOf('bridge') >= 0) return 'Once a week, bridge a small amount through the protocol and put the bridged funds to work in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Once a week, check the staking rewards and restake them instead of leaving them idle.';
    if (c.indexOf('prediction') >= 0) return 'Once a week, settle one market and open a new position.';
    if (c.indexOf('rwa') >= 0) return "Once a week, check the yield asset's price and top up the holding while it is steady.";
    if (c.indexOf('insurance') >= 0) return 'Once a week, check the cover is still active and the policy dates have not lapsed.';
    if (c.indexOf('stable') >= 0) return 'Once a week, mint or deposit a little more of the stable asset and leave it in place.';
    return 'Do one qualifying action every week — a deposit, a borrow, a swap or a vote.';
  }
  function holdReasonFor(age) {
    if (age === null || age === undefined) return 'With no listing date on record, a longer window covers the gaps.';
    if (age < 180) return 'A young protocol needs the longer window: its snapshots are irregular early on.';
    if (age < 365) return 'Old enough that snapshots are regular, young enough to still be early.';
    return 'An established protocol is snapshotted regularly, so thirty days is enough.';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var weeks = Math.max(1, Math.round(hold / 7));
    var gas = 4 + 2 * weeks + (capital >= 150 ? 4 : 0);
    var stopTvl = Math.max(1, Math.round(p.tvl_usd / 2 / 1e6));
    var verdict = p.verdict || 'Watch';
    return [
      { text: 'Set up a wallet used only for this farm, funded with just the money you plan to put in, and store its seed phrase offline where nobody else can reach it.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: weeklyActionFor(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Keep the position open for at least ' + hold + ' days so more than one snapshot catches the activity. ' + holdReasonFor(p.age_days), cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "When you are ready to leave, open the protocol's own points or rewards page and claim only through the link that page itself publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Keep a farm log with the wallet, the dates and every transaction, so you can repeat the position or unwind it cleanly.', cost: 'nothing but the log', time: '5 minutes' },
      { text: verdict === 'Skip'
        ? 'Break-even: this one is a Skip, so do not farm it yet — about $' + gas + ' of gas over ' + weeks + ' weeks buys nothing here. Re-check it only if its TVL or growth changes.'
        : 'Break-even and exit: about $' + gas + ' of gas over ' + weeks + ' weeks, so any future reward has to beat $' + gas + ' to pay. Unwind if TVL falls below $' + stopTvl + 'M or seven-day growth stays below -20% for two weeks.',
        cost: 'about $' + gas + ' of gas over ' + weeks + ' weeks', time: '5 minutes to check' }
    ].map(stepText);
  }
  function nettedLine(p) {
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var weeks = Math.max(1, Math.round(hold / 7));
    var gas = 4 + 2 * weeks + (capital >= 150 ? 4 : 0);
    return 'Netted: $' + gas + ' of gas and $' + capital + ' locked for ' + hold + ' days; any future reward above $' + gas + ' pays for the farm.';
  }

  function verdictCount(v) {
    var found = (DATA.verdict_counts || []).filter(function (x) { return x.verdict === v; })[0];
    return found ? found.count : 0;
  }
  function verdictClass(v) {
    if (v === 'Worth farming') return 'verdict worth';
    if (v === 'Watch') return 'verdict watch';
    return 'verdict skip';
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('verdict')) state.verdict = params.get('verdict');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.earlyOnly && r.tvl_usd >= DATA.floor_usd) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function isEarly(r) { return r.tvl_usd < DATA.floor_usd; }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'verdict') { av = a.verdict === 'Worth farming' ? 0 : a.verdict === 'Watch' ? 1 : 2; bv = b.verdict === 'Worth farming' ? 0 : b.verdict === 'Watch' ? 1 : 2; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var f = DATA.fit || {};
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar ranks every other rankable pre-token protocol too — ' + DATA.board_size + ' rows from ' + DATA.total_protocols + ' protocols analysed. Implied value is a model, not a promise, and never a promise of an airdrop.' }),
        el('p', { text: 'The model: log10(market cap) = ' + f.intercept + ' + ' + f.slope + ' x log10(TVL), fitted on ' + f.n + ' traded protocols, plus shrunk category offsets, a breadth slope, and shrunk seven-day-growth and age terms — the value follows from TVL, growth, age, category and breadth, every term fitted from this snapshot. Leave-one-out median miss ' + f.loo_radar3_mult + 'x, against ' + f.loo_radar2_mult + 'x for a flat category multiple; walk-forward ' + f.walk_old_new_radar3 + 'x / ' + f.walk_new_old_radar3 + 'x. Refitting the curve on ' + f.bootstrap_n + ' bootstrap resamples moves a typical row\'s rank by ' + f.bootstrap_median_rank_range + ' places — that rank range is shown on every row. Half the traded protocols land within ' + (f.band_lo_log !== undefined ? Math.round(Math.pow(10, f.band_lo_log) * 100) / 100 : '?') + 'x to ' + (f.band_hi_log !== undefined ? Math.round(Math.pow(10, f.band_hi_log) * 100) / 100 : '?') + 'x of the curve — that band is shown on every row too.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Protocols analysed' }), el('b', { text: String(DATA.total_protocols) })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Worth farming' }), el('b', { text: String(verdictCount('Worth farming')) })),
        el('div', { class: 'fact' }, el('span', { text: 'Watch' }), el('b', { text: String(verdictCount('Watch')) })),
        el('div', { class: 'fact' }, el('span', { text: 'Skip' }), el('b', { text: String(verdictCount('Skip')) })),
        el('div', { class: 'fact' }, el('span', { text: 'Already trade, set aside' }), el('b', { text: String(DATA.traded_count) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var verdictSel = el('select', { id: 'verdict', 'aria-label': 'Filter by verdict' },
      el('option', { value: 'all', text: 'All verdicts' }),
      ['Worth farming', 'Watch', 'Skip'].map(function (v) { return el('option', { value: v, text: v + ' (' + verdictCount(v) + ')', selected: v === state.verdict ? 'selected' : null }); })
    );
    verdictSel.addEventListener('change', function () { state.verdict = verdictSel.value; writeHash(); render(); });
    var earlyBtn = el('button', { type: 'button', 'aria-pressed': state.earlyOnly ? 'true' : 'false', text: 'Early only (< $' + Math.round(DATA.floor_usd / 1e6) + 'M TVL)', onclick: function () { state.earlyOnly = !state.earlyOnly; render(); } });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Verdict' }), verdictSel),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), earlyBtn),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    var arrow = state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null;
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = -1; }
        render();
      } }, label, arrow)
    );
  }

  function spotlight() {
    var top = DATA.rows.filter(function (r) { return r.verdict === 'Worth farming'; });
    var capital = top.reduce(function (s, r) { return s + capitalFor(r); }, 0);
    return el('section', { class: 'panel spotlight' },
      el('h2', { text: 'The farm book: ' + top.length + ' worth farming' }),
      el('p', { class: 'sub', text: 'Every protocol with at least $' + Math.round(DATA.model.worth_farming_usd / 1e6) + 'M of implied value. Farming all ' + top.length + ' at the suggested sizes takes about $' + capital + ' of capital. Select one for its model, verdict and farm plan.' }),
      el('ol', { class: 'top10' }, top.slice(0, 10).map(function (r) {
        return el('li', null,
          el('button', { type: 'button', onclick: function () { openDetail(r.slug); } },
            el('span', { class: 'num', text: '#' + r.rank }),
            el('b', { text: r.name }),
            el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
          ));
      }))
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.earlyOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num' }, el('div', { text: String(r.rank) }), el('div', { class: 'sub rankrange', text: (r.rank_lo !== undefined && r.rank_hi !== undefined) ? 'range ' + r.rank_lo + '–' + r.rank_hi : '' })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'sub', text: fmtUsd(r.band_lo_usd) + ' – ' + fmtUsd(r.band_hi_usd) })
        )),
        el('td', null, el('span', { class: verdictClass(r.verdict), text: r.verdict || 'Watch' })),
        el('td', { class: 'num', text: (r.confidence === undefined ? 'n/a' : Math.round(r.confidence * 100) + '%') })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model, verdict and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            sortHeader('verdict', 'Verdict'),
            el('th', { scope: 'col', text: 'Confidence' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var f = DATA.fit || {};
    var bandLo = f.band_lo_log !== undefined ? Math.round(Math.pow(10, f.band_lo_log) * 100) / 100 : null;
    var bandHi = f.band_hi_log !== undefined ? Math.round(Math.pow(10, f.band_hi_log) * 100) / 100 : null;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The curve is fitted from this snapshot on every run, so a future snapshot re-prices everything on its own.' }),
      el('div', { class: 'formula' },
        'log10(implied) = ' + f.intercept + ' + ' + f.slope + ' x log10(tvl_usd) + category offset + breadth slope x (chains - 1, centred) + growth slope x (7-day growth, centred) + maturity slope x log10(1 + age, centred)'
      ),
      el('p', { class: 'sub', text: 'The fit uses ' + f.n + ' traded protocols (positive market cap and TVL, not an exchange, bridge or staking receipt — those tokens are not protocol launches). Market cap grows much more slowly than TVL: the fitted multiple is ' + fmtMult(Math.pow(10, f.intercept + (f.slope - 1) * Math.log10(5e7))) + ' at $50M of TVL and ' + fmtMult(Math.pow(10, f.intercept + (f.slope - 1) * Math.log10(5e9))) + ' at $5B. A flat multiple would overvalue the giants by an order of magnitude. The category offset is the shrunk mean residual per category (at least ' + m.min_comparables + ' comparables); the breadth slope is ' + f.breadth_slope + ' per extra chain. The growth slope is ' + f.growth_slope + ' per unit of clamped growth and the maturity slope is ' + f.maturity_slope + ' per log10(1 + age) — both fitted from the same traded protocols, then shrunk to a quarter and a half. Residual spread is ' + f.residual_sd + ' in log10, and half the traded protocols land within ' + bandLo + 'x to ' + bandHi + 'x of the curve.' }),
      el('h3', { text: 'Backtest: leave-one-out and walk-forward, median multiplicative miss' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Test' }), el('th', { scope: 'col', text: 'Radar-4' }), el('th', { scope: 'col', text: 'Radar-2 (flat multiple)' }))),
          el('tbody', null, [
            el('tr', null, el('td', { text: 'Leave-one-out, ' + f.n + ' traded protocols' }), el('td', { class: 'num', text: fmtMult(f.loo_radar3_mult) }), el('td', { class: 'num', text: fmtMult(f.loo_radar2_mult) })),
            el('tr', null, el('td', { text: 'Walk-forward: train older, test newer' }), el('td', { class: 'num', text: fmtMult(f.walk_old_new_radar3) }), el('td', { class: 'num', text: fmtMult(f.walk_old_new_radar2) })),
            el('tr', null, el('td', { text: 'Walk-forward: train newer, test older' }), el('td', { class: 'num', text: fmtMult(f.walk_new_old_radar3) }), el('td', { class: 'num', text: fmtMult(f.walk_new_old_radar2) }))
          ])
        )
      ),
      el('p', { class: 'sub', text: 'What the backtest says about growth and age: their full fitted slopes are negative — fast seven-day growth mean-reverts, and an old protocol with no token carries a slightly lower multiple — so at full strength they cost leave-one-out accuracy (3.28x to 3.59x for growth, 3.28x to 3.51x for age). Shrunk to a quarter and a half they cost almost nothing (leave-one-out ' + f.loo_radar3_mult + 'x, walk-forward ' + f.walk_old_new_radar3 + 'x / ' + f.walk_new_old_radar3 + 'x), so the value carries both, at the weight the backtest supports. Both are shown on every row and both move the verdict as well: Worth farming is implied value of at least $' + Math.round(m.worth_farming_usd / 1e6) + 'M; Watch is at least $' + Math.round(m.watch_usd / 1e6) + 'M, or at least $' + Math.round(m.watch_usd / 2e6) + 'M with seven-day growth of ' + m.watch_growth_pct + '% or more; the rest is Skip. No step promises an airdrop.' }),
      el('h3', { text: 'Rank stability: ' + f.bootstrap_n + ' bootstrap refits of the curve' }),
      el('p', { class: 'sub', text: 'Values are uncertain — half the traded protocols land 0.31x to 3.97x from the curve — and ranks move too. Refitting the curve on ' + f.bootstrap_n + ' resamples of the traded pool moves a typical row\'s rank by ' + f.bootstrap_median_rank_range + ' places (median p90–p10 rank range), because the value band is wide and rows\' values overlap. The top of the board is steadier: the top row stays in the top 10 in most refits. Every row shows its rank range next to its point rank, and its detail view shows how often it lands in the top 20 across the refits.' }),
      el('h3', { text: 'Coverage: what happened to all ' + DATA.total_protocols + ' protocols' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Group' }), el('th', { scope: 'col', text: 'Count' }), el('th', { scope: 'col', text: 'What it means' }))),
          el('tbody', null, [
            el('tr', null, el('td', { text: 'Ranked on the board' }), el('td', { class: 'num', text: String(DATA.board_size) }), el('td', { text: 'Every rankable pre-token protocol: the ' + DATA.watchlist_size + ' watchlist plus ' + DATA.early_size + ' early finds below the floor.' })),
            el('tr', null, el('td', { text: 'Already trade' }), el('td', { class: 'num', text: String(DATA.traded_count) }), el('td', { text: 'A token on record, so their market cap is a fact and they price the curve instead of being ranked.' })),
            el('tr', null, el('td', { text: 'Token symbol, no market cap' }), el('td', { class: 'num', text: String(DATA.token_symbol_only_count) }), el('td', { text: 'A token exists on record but no market cap is published; set aside as already tokenised.' })),
            el('tr', null, el('td', { text: 'Pre-token but excluded' }), el('td', { class: 'num', text: String(DATA.excluded_count) }), el('td', { text: (DATA.excluded_reasons || []).map(function (x) { return x.reason + ' ' + x.count; }).join(', ') + '.' }))
          ])
        )
      ),
      el('h3', { text: 'Category offsets (log10 units, shrunk)' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Offset' }), el('th', { scope: 'col', text: 'Live comparables' }))),
          el('tbody', null, ((f.category_offsets || []).map(function (c) {
            return el('tr', null, el('td', { text: c.category }), el('td', { class: 'num', text: (c.offset > 0 ? '+' : '') + c.offset.toFixed(3) }), el('td', { class: 'num', text: String(c.count) }));
          })))
        )
      ),
      el('p', { class: 'sub', text: 'Categories with fewer than ' + m.min_comparables + ' live protocols get no offset. The global median market-cap / TVL across the fit pool is ' + DATA.global_multiple + '. The fit, the offsets and the backtest are recomputed from each snapshot, so a future snapshot re-prices every category on its own.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('div', { class: 'verdict-banner ' + (row.verdict === 'Worth farming' ? 'worth' : row.verdict === 'Watch' ? 'watch' : 'skip') },
      el('b', { text: row.verdict || 'Watch' }),
      el('span', { text: row.verdict === 'Worth farming' ? ' — implied value of at least $' + Math.round(DATA.model.worth_farming_usd / 1e6) + 'M. Farm it first.' : row.verdict === 'Watch' ? ' — worth tracking, not first in line.' : ' — do not farm it yet; re-check it only if its TVL or growth changes.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Curve value (size curve alone)' }), el('b', { class: 'num', text: fmtUsd(row.curve_value_usd) })),
        el('div', null, el('span', { text: 'Category offset (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: fmtMult(row.category_multiple === undefined ? 1 : row.category_multiple) + (row.comparables ? ' (' + row.comparables + ' comps)' : ' (no offset)') })),
        el('div', null, el('span', { text: 'Breadth (' + (row.chains || []).length + ' chains)' }), el('b', { class: 'num', text: fmtMult(row.breadth_multiplier === undefined ? 1 : row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'Growth (' + fmtPct(row.change_7d) + ' over 7 days)' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier === undefined ? 1 : row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity (' + fmtAge(row.age_days) + ' with no token)' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier === undefined ? 1 : row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Confidence' }), el('b', { class: 'num', text: row.confidence === undefined ? 'n/a' : Math.round(row.confidence * 100) + '%' })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'P25–P75 band' }), el('b', { class: 'num', text: fmtUsd(row.band_lo_usd) + ' – ' + fmtUsd(row.band_hi_usd) })),
        el('div', null, el('span', { text: 'Rank range (bootstrap)' }), el('b', { class: 'num', text: (row.rank_lo !== undefined ? row.rank_lo + '–' + row.rank_hi + ' of ' + DATA.board_size : 'n/a') + (row.top20_share !== undefined ? ', top 20 in ' + Math.round(row.top20_share * 100) + '% of refits' : '') }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row)) + (impliedOf(row) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price, and the band is wide because half the traded protocols land ' + Math.round(Math.pow(10, DATA.fit.band_lo_log) * 100) / 100 + 'x to ' + Math.round(Math.pow(10, DATA.fit.band_hi_log) * 100) / 100 + 'x from the curve — and the rank moves too: across ' + DATA.fit.bootstrap_n + ' refits of the curve this row ranks ' + (row.rank_lo !== undefined ? row.rank_lo + '–' + row.rank_hi : 'n/a') + '.' }),
      el('p', { class: 'sub', text: 'Why this rank: ' + fmtUsd(row.tvl_usd) + ' of TVL on the size curve is ' + fmtUsd(row.curve_value_usd) + ', times a category offset of ' + fmtMult(row.category_multiple === undefined ? 1 : row.category_multiple) + ', breadth of ' + fmtMult(row.breadth_multiplier === undefined ? 1 : row.breadth_multiplier) + ', growth of ' + fmtMult(row.growth_multiplier === undefined ? 1 : row.growth_multiplier) + ' (' + fmtPct(row.change_7d) + ' over 7 days) and maturity of ' + fmtMult(row.maturity_multiplier === undefined ? 1 : row.maturity_multiplier) + ' (' + fmtAge(row.age_days) + ' old with no token)' + (isEarly(row) ? ', and below the $' + Math.round(DATA.floor_usd / 1e6) + 'M watchlist floor — an early find' : ' — on the watchlist') + '. Growth and age enter shrunk: their full fitted slopes would cost leave-one-out accuracy, so the model carries a quarter of the growth effect and half of the maturity effect.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('p', { class: 'netted', text: nettedLine(row) }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(spotlight());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
