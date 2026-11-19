(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', verdict: 'all', earlyOnly: false, sort: 'implied', dir: -1, selected: null };

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
  function fmtPerHour(n) {
    if (n === undefined || n === null || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M/h';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K/h';
    return '$' + Math.round(n) + '/h';
  }
  function fmtDate(iso) {
    if (!iso) return 'n/a';
    var d = new Date(iso + 'T00:00:00Z');
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function impliedOf(row) {
    var curve = row.curve_value_usd === undefined ? row.tvl_usd * 0.2 : row.curve_value_usd;
    var cat = row.category_multiple === undefined ? 1 : row.category_multiple;
    var breadth = row.breadth_multiplier === undefined ? 1 : row.breadth_multiplier;
    var growth = row.growth_multiplier === undefined ? 1 : row.growth_multiplier;
    var maturity = row.maturity_multiplier === undefined ? 1 : row.maturity_multiplier;
    return Math.max(1, Math.round(curve * cat * breadth * growth * maturity));
  }

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


  function verdictCount(v) {
    var found = (DATA.verdict_counts || []).filter(function (x) { return x.verdict === v; })[0];
    return found ? found.count : 0;
  }
  function verdictClass(v) {
    if (v === 'Worth farming') return 'verdict worth';
    if (v === 'Watch') return 'verdict watch';
    if (v === 'Thin') return 'verdict thin';
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
      else if (key === 'verdict') { av = a.verdict === 'Worth farming' ? 0 : a.verdict === 'Watch' ? 1 : a.verdict === 'Thin' ? 2 : 3; bv = b.verdict === 'Worth farming' ? 0 : b.verdict === 'Watch' ? 1 : b.verdict === 'Thin' ? 2 : 3; }
      else if (key === 'value') { av = a.value_per_dollar_usd === undefined ? 0 : a.value_per_dollar_usd; bv = b.value_per_dollar_usd === undefined ? 0 : b.value_per_dollar_usd; }
      else if (key === 'net') { av = a.net_value_usd === undefined ? 0 : a.net_value_usd; bv = b.net_value_usd === undefined ? 0 : b.net_value_usd; }
      else if (key === 'perhour') { av = a.dollars_per_hour_usd === undefined ? 0 : a.dollars_per_hour_usd; bv = b.dollars_per_hour_usd === undefined ? 0 : b.dollars_per_hour_usd; }
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
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: 40 protocols with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar ranks every other rankable pre-token protocol too — ' + DATA.board_size + ' rows from ' + DATA.total_protocols + ' protocols analysed, every one accounted for (see Coverage). Implied value is a model, not a promise, and never a promise of an airdrop.' }),
        el('p', { text: 'One curve per kind of protocol, fitted on ' + f.n + ' traded protocols, plus breadth and shrunk growth and age terms. Leave-one-out median miss ' + f.loo_radar3_mult + 'x; walk-forward ' + f.walk_old_new_radar3 + 'x / ' + f.walk_new_old_radar3 + 'x. Every farm plan is netted to the dollar: net value, break-even launch odds and $/hour on every row.' })
      ),
      el('div', { class: 'facts kpi' },
        el('div', { class: 'fact' }, el('span', { text: 'Protocols accounted for' }), el('b', { text: String(DATA.total_protocols) })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Worth farming' }), el('b', { text: String(verdictCount('Worth farming')) })),
        el('div', { class: 'fact' }, el('span', { text: 'Leave-one-out miss' }), el('b', { text: (f.loo_radar3_mult !== undefined ? f.loo_radar3_mult + 'x' : 'n/a') })),
        el('div', { class: 'fact' }, el('span', { text: 'Top implied value' }), el('b', { text: top ? fmtUsd(top.implied_value_usd) : 'n/a' }))
      )
    );
  }

  function coverageSection() {
    return el('section', { class: 'panel coverage' },
      el('h2', { text: 'Coverage: where all ' + DATA.total_protocols + ' protocols went' }),
      el('p', { class: 'sub', text: 'Nothing is unaccounted for: ' + DATA.board_size + ' ranked + ' + DATA.traded_count + ' already trade + ' + DATA.token_symbol_only_count + ' carry a token symbol with no market cap + ' + DATA.excluded_count + ' pre-token but excluded = ' + DATA.total_protocols + '.' }),
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
      ['Worth farming', 'Watch', 'Thin', 'Skip'].map(function (v) { return el('option', { value: v, text: v + ' (' + verdictCount(v) + ')', selected: v === state.verdict ? 'selected' : null }); })
    );
    verdictSel.addEventListener('change', function () { state.verdict = verdictSel.value; writeHash(); render(); });
    var earlyBtn = el('button', { type: 'button', 'aria-pressed': state.earlyOnly ? 'true' : 'false', text: 'Early only (< $' + Math.round(DATA.floor_usd / 1e6) + 'M TVL)', onclick: function () { state.earlyOnly = !state.earlyOnly; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Verdict' }), verdictSel),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), earlyBtn),
      el('span', { class: 'count', text: rows().length + ' rows shown' })
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
    var capital = DATA.worth_capital_usd || 0;
    var portfolios = DATA.portfolios || [];
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
      })),
      el('h3', { text: 'Two portfolios, costed' }),
      el('p', { class: 'sub', text: 'Each row sized from its own suggested capital, scaled to fill the budget. Gas is the sum of the rows, so each portfolio has one break-even number.' }),
      portfolios.map(function (pf) {
        return el('div', { class: 'portfolio' },
          el('h4', { text: '$' + pf.budget_usd.toLocaleString('en-US') + ' across the top ' + pf.rows.length + ' Worth rows — $' + pf.total_gas_usd + ' of gas, up to ' + pf.hold_days + ' days' }),
          el('ol', { class: 'top10' }, pf.rows.map(function (r) {
            return el('li', null,
              el('button', { type: 'button', onclick: function () { openDetail(r.slug); } },
                el('span', { class: 'num', text: '#' + r.rank }),
                el('b', { text: r.name }),
                el('span', { class: 'num', text: '$' + r.allocation_usd + ' (suggested $' + r.suggested_usd + ')' })
              ));
          })),
          el('p', { class: 'sub', text: pf.netted })
        );
      })
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
        el('td', { class: 'num', text: (r.value_per_dollar_usd === undefined ? 'n/a' : '$' + Math.round(r.value_per_dollar_usd).toLocaleString('en-US')) }),
        el('td', { class: 'num', text: (r.net_value_usd === undefined ? 'n/a' : fmtUsd(r.net_value_usd)) }),
        el('td', { class: 'num', text: fmtPerHour(r.dollars_per_hour_usd) })
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
            sortHeader('value', 'Value / $1'),
            sortHeader('net', 'Net value'),
            sortHeader('perhour', '$/hour')
          )),
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
        'log10(implied) = a_cat + b_cat x log10(tvl_usd) + category offset + breadth slope x (chains - 1, centred) + growth slope x (7-day growth, centred) + maturity slope x log10(1 + age, centred)'
      ),
      el('p', { class: 'sub', text: 'The fit uses ' + f.n + ' traded protocols (positive market cap and TVL, not an exchange, bridge or staking receipt). One curve per kind: a category with at least ' + m.percat_min_n + ' traded protocols gets its own slope and intercept, shrunk toward the global curve (intercept ' + f.intercept + ', slope ' + f.slope + '); outside the TVL range its own traded protocols cover, the category curve hands back to the global slope. A flat multiple would overvalue the giants by an order of magnitude. The category offset is the shrunk mean residual per category (at least ' + m.min_comparables + ' comparables); the breadth slope is ' + f.breadth_slope + ' per extra chain; growth ' + f.growth_slope + ' and maturity ' + f.maturity_slope + ' are fitted, then shrunk to a quarter and a half. Residual spread is ' + f.residual_sd + ' in log10, and half the traded protocols land within ' + bandLo + 'x to ' + bandHi + 'x of the curve.' }),
      el('h3', { text: 'The category curves' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Traded' }), el('th', { scope: 'col', text: 'Slope' }), el('th', { scope: 'col', text: 'Fitted TVL range' }))),
          el('tbody', null, (f.per_category_curves || []).map(function (c) {
            return el('tr', null, el('td', { text: c.category }), el('td', { class: 'num', text: String(c.count) }), el('td', { class: 'num', text: c.slope.toFixed(2) }), el('td', { class: 'num', text: fmtUsd(c.tvl_min_usd) + ' – ' + fmtUsd(c.tvl_max_usd) }));
          }))
        )
      ),
      el('p', { class: 'sub', text: 'The slope itself differs by kind: Lending and DEX tokens scale steeply with TVL, RWA tokens barely scale at all, so one global slope misprices both ends. Categories without their own curve use the global curve plus their shrunk offset.' }),
      el('h3', { text: 'Backtest: leave-one-out and walk-forward, median multiplicative miss' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Test' }), el('th', { scope: 'col', text: 'Radar-7' }), el('th', { scope: 'col', text: 'Radar-4 (one global curve)' }))),
          el('tbody', null, [
            el('tr', null, el('td', { text: 'Leave-one-out, ' + f.n + ' traded protocols' }), el('td', { class: 'num', text: fmtMult(f.loo_radar3_mult) }), el('td', { class: 'num', text: fmtMult(f.loo_radar4_mult) })),
            el('tr', null, el('td', { text: 'Walk-forward: train older, test newer' }), el('td', { class: 'num', text: fmtMult(f.walk_old_new_radar3) }), el('td', { class: 'num', text: fmtMult(f.walk_old_new_radar4) })),
            el('tr', null, el('td', { text: 'Walk-forward: train newer, test older' }), el('td', { class: 'num', text: fmtMult(f.walk_new_old_radar3) }), el('td', { class: 'num', text: fmtMult(f.walk_new_old_radar4) })),
            el('tr', null, el('td', { text: 'Leave-one-category-out' }), el('td', { class: 'num', text: fmtMult(f.loco_mult) }), el('td', { class: 'num', text: fmtMult(f.loco_mult_radar4) })),
            el('tr', null, el('td', { text: 'Leave-one-out rank correlation (Spearman)' }), el('td', { class: 'num', text: (f.loo_spearman !== undefined ? f.loo_spearman.toFixed(3) : 'n/a') }), el('td', { class: 'num', text: (f.loo_spearman_radar4 !== undefined ? f.loo_spearman_radar4.toFixed(3) : 'n/a') }))
          ])
        )
      ),
      el('p', { class: 'sub', text: 'Growth and age enter shrunk — a quarter of the growth effect, half of the maturity effect — because at full strength they cost leave-one-out accuracy (fast growth mean-reverts). Worth farming is implied value of at least $' + Math.round(m.worth_farming_usd / 1e6) + 'M; Watch is at least $' + Math.round(m.watch_usd / 1e6) + 'M, or at least $' + Math.round(m.watch_usd / 2e6) + 'M with seven-day growth of ' + m.watch_growth_pct + '% or more; Thin is at least $' + Math.round(m.watch_usd / 2e6) + 'M below Watch; the rest is Skip. No step promises an airdrop.' }),
      el('h3', { text: 'Rank stability: ' + f.bootstrap_n + ' bootstrap refits of the curve' }),
      el('p', { class: 'sub', text: 'Refitting the curve on ' + f.bootstrap_n + ' resamples moves a typical row\'s rank by ' + f.bootstrap_median_rank_range + ' places (median p90–p10 rank range). The top row ranks ' + (DATA.rows[0] ? DATA.rows[0].rank_lo + '–' + DATA.rows[0].rank_hi : 'n/a') + ' and lands in the top 20 in ' + (DATA.rows[0] && DATA.rows[0].top20_share !== undefined ? Math.round(DATA.rows[0].top20_share * 100) : '?') + '% of refits; every row shows its rank range next to its point rank.' }),
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
    var steps = row.farm_steps || [];
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('div', { class: 'verdict-banner ' + (row.verdict === 'Worth farming' ? 'worth' : row.verdict === 'Watch' ? 'watch' : row.verdict === 'Thin' ? 'thin' : 'skip') },
      el('b', { text: row.verdict || 'Watch' }),
      el('span', { text: row.verdict === 'Worth farming' ? ' — implied value of at least $' + Math.round(DATA.model.worth_farming_usd / 1e6) + 'M. Farm it first.' : row.verdict === 'Watch' ? ' — worth tracking, not first in line.' : row.verdict === 'Thin' ? ' — just below Watch: farm it only at the smallest size, and only if its TVL or growth picks up.' : ' — do not farm it yet; re-check it only if its TVL or growth changes.' })
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
        el('div', null, el('span', { text: 'Value per $1 committed (capital + gas)' }), el('b', { class: 'num', text: row.value_per_dollar_usd === undefined ? 'n/a' : '$' + Math.round(row.value_per_dollar_usd).toLocaleString('en-US') })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Net value (implied less capital + gas)' }), el('b', { class: 'num', text: row.net_value_usd === undefined ? 'n/a' : fmtUsd(row.net_value_usd) })),
        el('div', null, el('span', { text: 'Break-even launch odds' }), el('b', { class: 'num', text: row.break_even_launch_pct === undefined ? 'n/a' : row.break_even_launch_pct + '% (1 in ' + Math.round(100 / Math.max(row.break_even_launch_pct, 0.000001)).toLocaleString('en-US') + ')' })),
        el('div', null, el('span', { text: 'Active hours / value per hour' }), el('b', { class: 'num', text: (row.active_hours === undefined ? 'n/a' : row.active_hours + 'h') + ' / ' + fmtPerHour(row.dollars_per_hour_usd) })),
        el('div', null, el('span', { text: 'P25–P75 band' }), el('b', { class: 'num', text: fmtUsd(row.band_lo_usd) + ' – ' + fmtUsd(row.band_hi_usd) })),
        el('div', null, el('span', { text: 'Rank range (bootstrap)' }), el('b', { class: 'num', text: (row.rank_lo !== undefined ? row.rank_lo + '–' + row.rank_hi + ' of ' + DATA.board_size : 'n/a') + (row.top20_share !== undefined ? ', top 20 in ' + Math.round(row.top20_share * 100) + '% of refits' : '') }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row)) + (impliedOf(row) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price: half the traded protocols land ' + Math.round(Math.pow(10, DATA.fit.band_lo_log) * 100) / 100 + 'x to ' + Math.round(Math.pow(10, DATA.fit.band_hi_log) * 100) / 100 + 'x from the curve, and across ' + DATA.fit.bootstrap_n + ' refits this row ranks ' + (row.rank_lo !== undefined ? row.rank_lo + '–' + row.rank_hi : 'n/a') + '.' })
    ));
    var comps = row.knn_comps || [];
    if (comps.length > 0) {
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Nearest traded comps — a second opinion' }),
        el('p', { class: 'sub', text: 'The closest traded protocols (same category first, then log TVL, then chain count), each priced at its own market-cap / TVL multiple. The median implies ' + fmtUsd(row.comps_value_usd) + ' against the curve value of ' + fmtUsd(row.curve_value_usd) + '. Display only: k-NN was tested against the curve on leave-one-out (3.25x vs 3.13x) and is worse, so it never moves a rank.' }),
        el('div', { class: 'table-wrap' },
          el('table', { class: 'comps' },
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Comp' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Implies' }))),
            el('tbody', null, comps.map(function (c) {
              return el('tr', null, el('td', { text: c.name }), el('td', { class: 'num', text: fmtUsd(c.tvl_usd) }), el('td', { class: 'num', text: fmtUsd(c.mcap_usd) }), el('td', { class: 'num', text: fmtUsd(c.comp_value_usd) }));
            }))
          )
        )
      ));
    }
    var holdEnd = addDays(DATA.as_of, row.hold_days || 0);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('p', { class: 'netted', text: row.netted || '' }),
      el('div', { class: 'timeline' },
        el('div', { class: 'tl-step' }, el('b', { text: 'Set up' }), el('span', { text: fmtDate(DATA.as_of) })),
        el('div', { class: 'tl-step' }, el('b', { text: 'Act' }), el('span', { text: fmtDate(DATA.as_of) })),
        el('div', { class: 'tl-step' }, el('b', { text: 'Check weekly' }), el('span', { text: 'from ' + fmtDate(addDays(DATA.as_of, 7)) })),
        el('div', { class: 'tl-step' }, el('b', { text: 'Hold until' }), el('span', { text: fmtDate(holdEnd) })),
        el('div', { class: 'tl-step' }, el('b', { text: 'Claim / exit' }), el('span', { text: fmtDate(holdEnd) }))
      ),
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
    shell.appendChild(coverageSection());
    shell.appendChild(controls());
    shell.appendChild(boardTable());
    shell.appendChild(spotlight());
    shell.appendChild(modelPanel());
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
