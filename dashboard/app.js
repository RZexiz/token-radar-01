// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board, a filterable table, a per-protocol detail drawer with the model's own inputs and the
// protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
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

  // The model in one function. The page recomputes each row from the snapshot figures and compares the
  // result with the number board.json carries, so the page and the data are visibly one arithmetic.
  function impliedOf(row, model) {
    var growth = Math.min(
      model.growth_cap,
      Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d)
    );
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var tenure =
      model.tenure_floor + (Math.min(Math.max(age, 0), model.tenure_days) / model.tenure_days) * model.tenure_range;
    var tvlRatio = Math.max(row.tvl_usd, 1) / 1e6;
    var liquidity =
      model.liquidity_floor +
      Math.min(Math.log(tvlRatio) / Math.log(model.liquidity_ref_usd / 1e6), 1) * model.liquidity_range;
    // Value = the book, priced at what the sector's own live tokens are worth per dollar of TVL.
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * growthMult * tenure * liquidity));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan mirrors the derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold, and every cost and time. No name is special-cased.
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
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0)
      return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0)
      return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0)
      return 'Provide $' + capital + " of liquidity to " + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('chain') >= 0)
      return 'Bridge $' + capital + ' of USDC to ' + chain + " and use " + name + "'s own bridge and app for one swap.";
    if (c.indexOf('bridge') >= 0)
      return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0)
      return "Stake $" + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0)
      return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0)
      return 'Fund $' + capital + ' and place one market position on ' + name + ', then claim the resolved payout.';
    if (c.indexOf('stable') >= 0)
      return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('rwa') >= 0)
      return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' through ' + name + ' and hold it.';
    if (c.indexOf('insurance') >= 0)
      return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy open.';
    if (c.indexOf('basis') >= 0)
      return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and let it run one funding cycle.';
    if (c.indexOf('payment') >= 0)
      return 'Route $' + capital + ' of a payment through ' + name + ' on ' + chain + ' and keep the receipt.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
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
        el('span', null, document.createTextNode('Snapshot '), el('b', { text: DATA.as_of })),
        el('span', null, document.createTextNode('Model '), el('b', { text: DATA.model_version })),
        el('span', null, document.createTextNode('Total implied '), el('b', { text: fmtUsd(DATA.total_implied_usd) }))
      )
    );
  }

  function cards() {
    var top = DATA.rows[0];
    var early = DATA.rows.filter(function (r) { return !isWatchlist(r.slug); }).length;
    return el('section', { class: 'cards', 'aria-label': 'Board summary' },
      el('div', { class: 'card' }, el('span', { text: 'Rows ranked' }), el('b', { text: String(DATA.board_size) }),
        el('em', { text: DATA.watchlist_size + ' watchlist + ' + early + ' early' })),
      el('div', { class: 'card' }, el('span', { text: 'Top implied value' }), el('b', { text: fmtUsd(top ? top.implied_value_usd : 0) }),
        el('em', { text: top ? top.name : 'none' })),
      el('div', { class: 'card' }, el('span', { text: 'Set aside' }), el('b', { text: String(DATA.live_size) }),
        el('em', { text: 'protocols that already trade' })),
      el('div', { class: 'card' }, el('span', { text: 'Categories' }), el('b', { text: String(DATA.sectors.length) }),
        el('em', { text: 'each with its own fee and multiple' }))
    );
  }
  function isWatchlist(slug) {
    if (!DATA._watch) {
      DATA._watch = {};
      DATA.rows.slice(0, DATA.watchlist_size).forEach(function (r) { DATA._watch[r.slug] = true; });
    }
    return !!DATA._watch[slug];
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' pre-token protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) +
          'M of TVL and no token on record. The early radar adds the pre-token protocols below that floor, by score. ' +
          'Implied value comes from the protocol\'s own TVL, its sector\'s economics, its seven-day growth and its age; it is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token set aside' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Snapshot source' }), el('b', { text: 'DefiLlama' }))
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
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = DATA.rows[0].implied_value_usd || 1;
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
        el('td', { class: 'rank', text: '#' + r.rank }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, isWatchlist(r.slug) ? el('span', { class: 'status', text: 'watchlist' }) : el('span', { class: 'tag early', text: 'early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Source' })
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
        el('td', { class: 'rank', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'unnamed chain') }))),
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
    var sectorRows = DATA.sectors.slice(0, 30).map(function (s) {
      var evidence = s.samples === 0
        ? 'snapshot median'
        : s.samples + (s.samples === 1 ? ' live token' : ' live tokens') + (s.shrunk ? ', shrunk' : '');
      return el('tr', null,
        el('td', { text: s.category }),
        el('td', { class: 'num', text: (s.fee_bps / 100).toFixed(2) + '%' }),
        el('td', { class: 'num', text: (Math.round(s.multiple * 100) / 100) + '×' }),
        el('td', { class: 'num' + (s.samples === 0 ? ' weak' : ''), text: evidence }),
        el('td', { class: 'sub', text: s.note })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        el('div', null, el('b', { text: 'multiple' }), ' = median( mcap / tvl ) over the snapshot\'s live tokens in that category'),
        el('div', null, el('b', { text: 'growth' }), ' = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight),
        el('div', null, el('b', { text: 'tenure' }), ' = ' + m.tenure_floor + ' + min(age_days, ' + m.tenure_days + ') / ' + m.tenure_days + ' × ' + m.tenure_range),
        el('div', null, el('b', { text: 'liquidity' }), ' = ' + m.liquidity_floor + ' + min(log10(tvl / $1M) / log10($3B / $1M), 1) × ' + m.liquidity_range),
        el('div', null, el('b', { text: 'implied' }), ' = max(1, round(tvl_usd × multiple × growth × tenure × liquidity))')
      ),
      el('p', { class: 'sub', text: 'TVL, seven-day growth and listing date come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days.' }),
      el('p', { class: 'sub', text: 'The multiple is measured, not assumed: the snapshot\'s own live-token protocols carry a market cap and a TVL, so mcap / tvl reads off what the market currently pays each sector per dollar of book. A category with fewer than six live tokens is shrunk toward the snapshot median, so one lucky sample never sets a sector\'s price. A category with none takes the snapshot median and says so.' }),
      el('p', { class: 'sub', text: 'The fee figure is a stated assumption, not a measurement: no snapshot field carries a protocol\'s revenue, so what a book would earn a year is shown separately from what it is worth.' }),
      el('h3', { text: 'Sector terms: assumed fee, measured multiple' }),
      el('div', { class: 'sector-table' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Assumed fee on TVL' }), el('th', { scope: 'col', text: 'Measured multiple' }), el('th', { scope: 'col', text: 'Evidence' }), el('th', { scope: 'col', text: 'Where the revenue comes from' }))),
          el('tbody', null, sectorRows)
        )
      )
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
    // Carried from board.json, not recomputed: a second implementation in the page is how the plan
    // and the cost table end up quoting different deposits.
    var steps = row.farm_steps || [];
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' · ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Market multiple: mcap per $1 of TVL' }), el('b', { class: 'num', text: (Math.round(row.multiple * 100) / 100) + '×' })),
        el('div', null, el('span', { text: 'Where that multiple comes from' }), el('b', { class: 'num sub', text: row.multiple_source || 'n/a' })),
        el('div', null, el('span', { text: 'Book earnings a year at ' + (row.fee_bps / 100).toFixed(2) + '% of TVL (reference)' }), el('b', { class: 'num', text: fmtUsd(row.revenue_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Tenure multiplier' }), el('b', { class: 'num', text: String(row.tenure_multiplier) })),
        el('div', null, el('span', { text: 'Liquidity multiplier' }), el('b', { class: 'num', text: String(row.liquidity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Sector note: ' + row.sector_note + '.' }),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) +
        (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') +
        ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    // The costed position. Read from data.js, never recomputed here: the page and board.json have to
    // agree on the dollars, and a second implementation is how they stop agreeing.
    if (row.farm) {
      var f = row.farm;
      var head = el('p', { class: 'sub', text: row.farm_headline || '' });
      var rowsCost = f.costs.map(function (c) {
        return el('tr', null,
          el('td', { text: c.label }),
          el('td', { class: 'num', text: fmtUsd(c.usd) }),
          el('td', { class: 'sub', text: c.basis })
        );
      });
      var verdictText = f.verdict === 'farm' ? 'Cheap to hold' : f.verdict === 'thin' ? 'Worth it only on a long hold' : 'Too expensive to hold';
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Cost of being present' }),
        head,
        el('table', { class: 'cost-table' },
          el('thead', null, el('tr', null,
            el('th', { text: 'Cost' }), el('th', { class: 'num', text: 'Dollars' }), el('th', { text: 'How it is arrived at' })
          )),
          el('tbody', null, rowsCost,
            el('tr', { class: 'total' },
              el('td', { text: 'Total cost of the position' }),
              el('td', { class: 'num', text: fmtUsd(f.cost_total_usd) }),
              el('td', { class: 'sub', text: f.hurdle_pct.toFixed(1) + '% of the ' + fmtUsd(f.deposit_usd) + ' deposit, ' + fmtUsd(f.cost_per_day_usd) + ' a day over ' + f.hold_days + ' days' })
            )
          )
        ),
        el('p', { class: 'sub' },
          el('b', { text: verdictText + '. ' }),
          el('span', { text: f.verdict_reason })
        ),
        el('p', { class: 'sub', text: 'Every number above is arithmetic on a stated assumption: the chain fee is that chain\'s typical plain transaction, the spread is ' +
          '0.5% each way, and the capital charge is ' + f.yield_assumption_pct + '% a year it could have earned elsewhere. The snapshot carries no airdrop size, date or terms, so no return is predicted here — only what being present costs.' })
      ));
    }
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
    if (state.tab === 'pre-token') shell.appendChild(cards());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
  }

  readHash();
  render();
  if (state.selected) openDetail(state.selected);
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
