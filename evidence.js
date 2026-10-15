/* The Evidence — search, filters, hash routing and rendering.
   Data: data/index.json (search index) + data/sources/<id>.json (full records, loaded on demand).
   All text is inserted with textContent, never innerHTML.

   Pages (all hash based, so direct links and refresh work on GitHub Pages):
     #                      Overview
     #explore?q=&subject=&type=&year=&sort=   Explore evidence (findings)
     #sources?q=&subject=&type=&year=&sort=   Sources (documents)
     #f/<finding-id>        One finding
     #s/<source-id>         One source document
     #?...                  Old list links; still work and are redirected to #explore / #sources */
(function () {
  'use strict';

  const DATA = 'data/';
  const PAGE = 20;
  const SITE = 'The Evidence';

  /* The five kinds of statement. Each gets a label, a one-line definition and a colour class. */
  const KINDS = {
    stated: { label: 'Stated in the source', def: 'The document says this explicitly.' },
    summary: { label: 'Summary of the source', def: 'A faithful plain-language paraphrase of what the document says.' },
    calculation: { label: 'Calculated from source data', def: 'Arithmetic on values the source reports. Inputs and method are shown. The source did not state the result.' },
    interpretation: { label: 'Interpretation', def: 'Explanation or context added by this archive. The source did not state it.' },
    allegation: { label: 'Allegation — unresolved', def: 'A claim that is reported but has not been established.' }
  };
  const kindOf = (k) => KINDS[k] ? k : 'stated';

  const state = { q: '', subject: '', type: '', year: '', sort: 'relevance' };
  const srcCache = {};
  let DB = null;
  let token = 0;
  let saved = null;          // scroll position of the results list, kept while a finding is open
  let lastList = '#explore'; // where "Back to results" goes
  let cameFromList = false;  // set when a result card was just clicked
  let ui = null;             // handles to the Explore / Sources controls while they are on screen
  let current = { name: '' };

  const $ = (id) => document.getElementById(id);
  const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  /* ---------- tiny DOM helper ---------- */
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach((x) => add(el, x));
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    kids.forEach((c) => add(el, c));
    return el;
  }
  function safeUrl(u) {
    if (!u || typeof u !== 'string') return null;
    if (/^https?:\/\//i.test(u)) return u;
    if (/^[\w./-]+$/.test(u) && u[0] !== '/' && !u.includes('..')) return u;
    return null;
  }
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  /* ---------- labels and formatting ---------- */
  const lab = (list, id) => { const x = list.find((t) => t.id === id); return x ? x.label : id; };
  const subjLabel = (id) => lab(DB.taxonomy.subjects, id);
  const subjLabels = (ids) => (ids || []).map(subjLabel).join(', ');
  const typeLabel = (id) => lab(DB.taxonomy.types, id);
  function fmtDate(s) {
    if (!s) return null;
    const o = { timeZone: 'UTC', year: 'numeric' };
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { ...o, day: 'numeric', month: 'long' });
    if (/^\d{4}-\d{2}$/.test(s)) return new Date(s + '-01T00:00:00Z').toLocaleDateString('en-GB', { ...o, month: 'long' });
    return s;
  }
  const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
  const valueText = (f) => (f.value == null || f.value === '' ? null : String(f.value));

  /* ---------- data ---------- */
  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return r.json();
  }
  function getSource(id) {
    if (!srcCache[id]) srcCache[id] = getJSON(DATA + 'sources/' + encodeURIComponent(id) + '.json').catch((e) => { delete srcCache[id]; throw e; });
    return srcCache[id];
  }
  function prepare() {
    DB.srcById = {}; DB.fById = {};
    DB.sources.forEach((s) => {
      s.subjects = s.subjects || []; s.keywords = s.keywords || [];
      s._b = fold([s.title, s.institution, s.summary, s.keywords.join(' '), typeLabel(s.type), subjLabels(s.subjects), s.year, s.published, s.report_number].join(' '));
      s._h = fold(s.title + ' ' + (s.institution || ''));
      DB.srcById[s.id] = s;
    });
    DB.nFindings = {};
    DB.findings.forEach((f) => {
      const s = DB.srcById[f.source_id] || {};
      if (!f.subjects || !f.subjects.length) f.subjects = s.subjects || [];
      f.type = s.type; f.year = s.year; f.published = s.published || String(s.year || '');
      f.placeholder = !!(f.placeholder || s.placeholder);
      f._b = fold([f.headline, f.summary, f.intro, f.pollutant, f.value, f.unit, f.locator, (f.keywords || []).join(' '),
        KINDS[kindOf(f.kind)].label, typeLabel(f.type), subjLabels(f.subjects), s.title, s.institution, s.year, s.report_number].join(' '));
      f._h = fold(f.headline + ' ' + (f.pollutant || ''));
      DB.fById[f.id] = f;
      DB.nFindings[f.source_id] = (DB.nFindings[f.source_id] || 0) + 1;
    });
    DB.years = [...new Set(DB.sources.map((s) => s.year).filter(Boolean))].sort((a, b) => b - a);
  }

  /* ---------- search and filters ---------- */
  function parseQuery(q) {
    const toks = []; const re = /"([^"]+)"|(\S+)/g; let m;
    while ((m = re.exec(q))) { const t = fold(m[1] || m[2]).trim(); if (t) toks.push(t); }
    return toks;
  }
  /* skip = name of one filter to ignore (used to count how many results each subject tab would give) */
  function run(list, skip) {
    const toks = parseQuery(state.q);
    const out = [];
    for (const it of list) {
      if (skip !== 'subject' && state.subject && !it.subjects.includes(state.subject)) continue;
      if (state.type && it.type !== state.type) continue;
      if (state.year && String(it.year) !== state.year) continue;
      let score = 0, ok = true;
      for (const t of toks) {
        if (!it._b.includes(t)) { ok = false; break; }
        score += it._h.includes(t) ? 3 : 1;
      }
      if (ok) out.push({ it, score });
    }
    const byDate = (a, b) => String(b.it.published || '').localeCompare(String(a.it.published || ''));
    const tie = (a, b) => (a.it.id < b.it.id ? -1 : 1);
    if (state.sort === 'oldest') out.sort((a, b) => -byDate(a, b) || tie(a, b));
    else if (state.sort === 'newest') out.sort((a, b) => byDate(a, b) || tie(a, b));
    else out.sort((a, b) => b.score - a.score || byDate(a, b) || tie(a, b));
    return out.map((x) => x.it);
  }
  const filtersOn = () => !!(state.subject || state.type || state.year);
  const anyOn = () => !!(state.q || filtersOn());

  /* ---------- routing ---------- */
  function parseHash() {
    const hash = location.hash.slice(1);
    let m;
    if ((m = /^f\/([\w-]+)$/.exec(hash))) return { name: 'finding', id: m[1] };
    if ((m = /^s\/([\w-]+)$/.exec(hash))) return { name: 'source', id: m[1] };
    const qi = hash.indexOf('?');
    const word = qi < 0 ? hash : hash.slice(0, qi);
    const p = new URLSearchParams(qi < 0 ? '' : hash.slice(qi + 1));
    if (word === 'sources') return { name: 'sources', p };
    if (word === 'explore') return { name: 'explore', p };
    if (word === '' && qi >= 0) return { name: p.get('view') === 'sources' ? 'sources' : 'explore', p, legacy: true };
    return { name: 'overview', p };
  }
  function applyParams(p) {
    state.q = p.get('q') || '';
    const subj = (p.get('subject') || '').split(',')[0];
    state.subject = DB.taxonomy.subjects.some((t) => t.id === subj) ? subj : '';
    state.type = DB.taxonomy.types.some((t) => t.id === p.get('type')) ? p.get('type') : '';
    state.year = DB.years.map(String).includes(p.get('year')) ? p.get('year') : '';
    state.sort = ['newest', 'oldest'].includes(p.get('sort')) ? p.get('sort') : 'relevance';
    shown = PAGE;
  }
  /* Build the hash for a list page from the current state plus any changes */
  function hashFor(view, change) {
    const s = Object.assign({}, state, change || {});
    const p = new URLSearchParams();
    if (s.q) p.set('q', s.q);
    if (s.subject) p.set('subject', s.subject);
    if (s.type) p.set('type', s.type);
    if (s.year) p.set('year', s.year);
    if (s.sort !== 'relevance') p.set('sort', s.sort);
    const qs = p.toString();
    return '#' + view + (qs ? '?' + qs : '');
  }
  let shown = PAGE;
  function rememberScroll(e) {
    saved = { y: window.scrollY, shown, hash: lastList };
    cameFromList = !(e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button));   // ctrl/cmd-click opens a new tab: nothing to remember
  }

  /* Change filters: pushes a history entry so Back/Forward step through them */
  function setFilters(change) { location.hash = hashFor(current.name, change); }
  /* Typing in the search box: updates the page without filling the history with one entry per letter */
  function setQuery(q) {
    state.q = q;
    if (current.name === 'explore' || current.name === 'sources') {
      shown = PAGE;
      const hash = hashFor(current.name);
      history.replaceState(history.state, '', location.pathname + location.search + hash);
      lastList = hash;
      updateBrowse();
    } else {
      location.hash = hashFor('explore');   // first keystroke from another page: go to the results
    }
  }

  function route() {
    const r = parseHash();
    const my = ++token;
    const searching = document.activeElement === $('q');
    if (r.name !== 'finding' && r.name !== 'source') cameFromList = false;
    if (r.name === 'finding' || r.name === 'source') {
      current = { name: r.name };
      setNav(r.name === 'finding' ? 'explore' : 'sources');
      return r.name === 'finding' ? showFinding(r.id, my) : showSource(r.id, my);
    }
    if (r.name === 'overview') {
      current = { name: 'overview' };
      ui = null;
      setNav('overview');
      if (!searching) syncSearch('');
      return showOverview();
    }
    // Explore or Sources
    if (r.legacy) {
      const keep = new URLSearchParams(r.p); keep.delete('view');
      const qs = keep.toString();
      history.replaceState(null, '', location.pathname + location.search + '#' + r.name + (qs ? '?' + qs : ''));
    }
    applyParams(r.p);
    const sameKind = ui && ui.kind === r.name && current.name === r.name;
    current = { name: r.name };
    lastList = location.hash || '#' + r.name;
    setNav(r.name);
    if (!sameKind) drawBrowse(r.name);
    if (saved && saved.hash === lastList) shown = Math.max(shown, saved.shown);
    updateBrowse();
    document.title = pageTitle();
    if (saved && saved.hash === lastList) { window.scrollTo(0, saved.y); saved = null; }
    else if (!sameKind || !searching) window.scrollTo(0, 0);
    if (!sameKind && !searching) focusHeading();
  }
  function pageTitle() {
    const base = current.name === 'sources' ? 'Sources' : 'Explore evidence';
    return [state.subject ? subjLabel(state.subject) : null, base, SITE].filter(Boolean).join(' — ');
  }
  function setNav(name) {
    document.querySelectorAll('.mainnav a').forEach((a) => {
      if (a.getAttribute('data-nav') === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  function syncSearch(v) { const q = $('q'); if (q && document.activeElement !== q) q.value = v; }
  function focusHeading() { const t = document.querySelector('#view h1'); if (t) t.focus({ preventScroll: true }); }
  function mount(...kids) { const v = $('view'); v.replaceChildren(...kids); v.hidden = false; }

  /* ---------- shared bits ---------- */
  function kindBadge(kind, withDef) {
    const k = kindOf(kind);
    return h('span', { class: 'kind kind-' + k, text: KINDS[k].label, title: withDef ? null : KINDS[k].def });
  }
  const phBadge = () => h('span', { class: 'ph', text: 'Placeholder — not real data' });
  function pageHead(title, intro) {
    return h('header', { class: 'page-head' }, h('h1', { tabindex: '-1', text: title }), intro ? h('p', { class: 'lede', text: intro }) : null);
  }
  const srcLine = (s, locator) => [s.institution, fmtDate(s.published)].filter(Boolean).join(' · ') + (locator ? ' · ' + locator : '');

  /* A finding as it appears in any list. The headline is the link; the whole card is clickable. */
  function findingCard(f, opts) {
    const s = DB.srcById[f.source_id] || {};
    const v = valueText(f);
    const text = f.summary || f.intro;
    return h('article', { class: 'card' + (v ? ' has-result' : '') },
      h('div', { class: 'card-main' },
        h('p', { class: 'card-top' }, h('span', { class: 'subject', text: subjLabels(f.subjects) || typeLabel(f.type) }), kindBadge(f.kind)),
        h('h3', { class: 'card-title' }, h('a', { class: 'stretch', href: '#f/' + f.id, onclick: rememberScroll, text: f.headline })),
        text ? h('p', { class: 'card-text', text: text }) : null,
        h('p', { class: 'card-src' }, h('span', { class: 'src-title', text: s.title || f.source_id }), h('span', { text: srcLine(s, f.locator) })),
        f.placeholder ? phBadge() : null),
      v ? h('div', { class: 'card-result' },
        h('span', { class: 'cr-label', text: 'Key result' }),
        h('span', { class: 'cr-value' }, h('span', { class: 'v', text: v }), f.unit ? h('span', { class: 'u', text: ' ' + f.unit }) : null),
        f.pollutant ? h('span', { class: 'cr-what', text: f.pollutant }) : null) : null);
  }
  function sourceCard(s) {
    const n = DB.nFindings[s.id] || 0;
    return h('article', { class: 'card has-result' },
      h('div', { class: 'card-main' },
        h('p', { class: 'card-top' }, h('span', { class: 'subject', text: typeLabel(s.type) }), h('span', { class: 'meta', text: s.year || 'n.d.' })),
        h('h3', { class: 'card-title' }, h('a', { class: 'stretch', href: '#s/' + s.id, onclick: rememberScroll, text: s.title })),
        s.summary ? h('p', { class: 'card-text', text: s.summary }) : null,
        h('p', { class: 'card-src' }, h('span', { text: srcLine(s) + (s.report_number ? ' · No. ' + s.report_number : '') })),
        s.placeholder ? phBadge() : null),
      h('div', { class: 'card-result' },
        h('span', { class: 'cr-value' }, h('span', { class: 'v', text: String(n) })),
        h('span', { class: 'cr-what', text: n === 1 ? 'finding' : 'findings' })));
  }
  function pagedList(box, items, build) {
    const list = h('div', { class: 'cards' });
    const more = h('div', { class: 'more' });
    box.append(list, more);
    let n = 0;
    const draw = () => {
      const upto = Math.min(shown, items.length);
      for (; n < upto; n++) list.appendChild(build(items[n]));
      more.replaceChildren();
      if (n < items.length) {
        more.append(h('span', { class: 'meta', text: 'Showing ' + n + ' of ' + items.length }),
          h('button', { type: 'button', class: 'btn', text: 'Show ' + Math.min(PAGE, items.length - n) + ' more', onclick: () => { shown = n + PAGE; draw(); } }));
      }
    };
    draw();
  }

  /* ================= OVERVIEW ================= */
  function showOverview() {
    document.title = SITE + ' — Stories from Gabès';
    const perSubject = DB.taxonomy.subjects.map((s) => ({ s, n: DB.findings.filter((f) => f.subjects.includes(s.id)).length })).filter((x) => x.n);
    const feat = DB.findings.filter((f) => f.featured).slice(0, 4);
    mount(
      h('header', { class: 'page-head hero' },
        h('h1', { tabindex: '-1', text: 'The Evidence' }),
        h('p', { class: 'lede', text: 'The environmental crisis in Gabès is documented in scientific analyses, institutional reports, and legal records. This archive brings those findings together, makes each one understandable, and traces every claim back to its source.' }),
        h('div', { class: 'cta' },
          h('a', { class: 'btn primary', href: '#explore', text: 'Explore all ' + DB.findings.length + ' findings' }),
          h('a', { class: 'btn', href: '#sources', text: 'Browse ' + DB.sources.length + ' source documents' })),
        h('p', { class: 'meta', text: DB.generated ? 'Archive updated ' + fmtDate(DB.generated) : null })),
      h('section', { class: 'band', 'aria-labelledby': 'ovSubj' },
        h('h2', { id: 'ovSubj', text: 'Browse by subject' }),
        h('ul', { class: 'subject-grid' }, perSubject.map(({ s, n }) =>
          h('li', null, h('a', { href: '#explore?subject=' + s.id }, h('span', { class: 'sg-name', text: s.label }), h('span', { class: 'sg-n', text: plural(n, 'finding', 'findings') })))))),
      feat.length ? h('section', { class: 'band', 'aria-labelledby': 'ovKey' },
        h('h2', { id: 'ovKey', text: 'Key findings' }),
        h('div', { class: 'cards' }, feat.map((f) => findingCard(f)))) : null,
      h('section', { class: 'band how', 'aria-labelledby': 'ovHow' },
        h('h2', { id: 'ovHow', text: 'How to read a finding' }),
        h('p', { class: 'prose', text: 'Every finding has the same layout: the subject, a headline saying what was found, a short introduction, the key result, an explanation of what it means and does not mean, and the source with a link to the original document.' }),
        h('p', { class: 'prose', text: 'Not every statement carries the same weight, so each finding is labelled with what kind of statement it is:' }),
        h('dl', { class: 'legend' }, Object.keys(KINDS).flatMap((k) => [h('dt', null, kindBadge(k, true)), h('dd', { text: KINDS[k].def })])))
    );
    focusHeadingIfNav();
    window.scrollTo(0, 0);
  }
  function focusHeadingIfNav() { if (document.activeElement !== $('q')) focusHeading(); }

  /* ================= EXPLORE / SOURCES ================= */
  function drawBrowse(kind) {
    const isF = kind === 'explore';
    const u = { kind };
    u.subjLinks = {};
    // subject navigation: tabs on wide screens, a drop-down on narrow ones. Same state, same links.
    u.tabs = h('ul', { class: 'subject-tabs' });
    const mk = (id, label) => {
      const a = h('a', { href: '#', 'data-s': id }, h('span', { class: 'st-name', text: label }), h('span', { class: 'st-n' }));
      u.subjLinks[id] = a; u.tabs.appendChild(h('li', null, a));
    };
    mk('', 'All subjects');
    DB.taxonomy.subjects.forEach((s) => mk(s.id, s.label));
    u.subjSel = h('select', { id: 'subjSel', onchange: (e) => setFilters({ subject: e.target.value }) });
    u.subjSel.appendChild(h('option', { value: '', text: 'All subjects' }));
    DB.taxonomy.subjects.forEach((s) => u.subjSel.appendChild(h('option', { value: s.id, text: s.label })));

    u.type = h('select', { id: 'fType', onchange: (e) => setFilters({ type: e.target.value }) }, h('option', { value: '', text: 'All source types' }),
      DB.taxonomy.types.map((t) => h('option', { value: t.id, text: t.label })));
    u.year = h('select', { id: 'fYear', onchange: (e) => setFilters({ year: e.target.value }) }, h('option', { value: '', text: 'All years' }),
      DB.years.map((y) => h('option', { value: String(y), text: String(y) })));
    u.sort = h('select', { id: 'fSort', onchange: (e) => setFilters({ sort: e.target.value }) },
      h('option', { value: 'relevance', text: 'Best match' }), h('option', { value: 'newest', text: 'Newest first' }), h('option', { value: 'oldest', text: 'Oldest first' }));
    u.active = h('div', { class: 'active', 'aria-label': 'Active filters' });
    u.count = h('p', { class: 'count', role: 'status' });
    u.cross = h('p', { class: 'cross' });
    u.results = h('div', { id: 'results' });

    const field = (label, sel) => h('div', { class: 'field' }, h('label', { for: sel.id, text: label }), sel);
    ui = u;
    mount(
      isF ? pageHead('Explore evidence', 'Each result is one finding taken from a source document, with a plain-language introduction, the key result and a link to the original. Search above, or narrow the list by subject, source type and year.')
        : pageHead('Sources', 'The documents behind the findings: studies, laboratory analyses, audits, official reports and legal texts. Open one to see every finding taken from it and to read the original.'),
      h('section', { class: 'controls' },
        h('nav', { class: 'subjects', 'aria-label': 'Subjects' },
          h('p', { class: 'ctl-title', text: 'Subject' }), u.tabs,
          h('div', { class: 'subject-select' }, h('label', { for: 'subjSel', text: 'Subject' }), u.subjSel)),
        h('div', { class: 'filters' }, field('Source type', u.type), field('Year', u.year), field('Sort by', u.sort)),
        u.active),
      h('section', { class: 'results', 'aria-labelledby': 'resH' },
        h('h2', { class: 'vh', id: 'resH', text: 'Results' }), u.count, u.cross, u.results));
  }

  function updateBrowse() {
    const u = ui; if (!u) return;
    const isF = u.kind === 'explore';
    const pool = isF ? DB.findings : DB.sources;
    const items = run(pool);
    syncSearch(state.q);
    u.type.value = state.type; u.year.value = state.year; u.sort.value = state.sort; u.subjSel.value = state.subject;

    // subject tabs: counts show how many results each subject would give with the other filters kept
    const base = run(pool, 'subject');
    const per = {}; base.forEach((it) => it.subjects.forEach((s) => { per[s] = (per[s] || 0) + 1; }));
    for (const id in u.subjLinks) {
      const a = u.subjLinks[id];
      const n = id === '' ? base.length : (per[id] || 0);
      a.href = hashFor(u.kind, { subject: id });
      a.querySelector('.st-n').textContent = n;
      if (id === state.subject) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    }
    [...u.subjSel.options].forEach((o) => {
      const n = o.value === '' ? base.length : (per[o.value] || 0);
      o.textContent = (o.value === '' ? 'All subjects' : subjLabel(o.value)) + ' (' + n + ')';
    });

    // active filter chips: each is a button that removes that filter
    const chips = [];
    if (state.q) chips.push(['Search', '“' + state.q + '”', () => { state.q = ''; setQuery(''); syncSearch(''); }]);
    if (state.subject) chips.push(['Subject', subjLabel(state.subject), () => setFilters({ subject: '' })]);
    if (state.type) chips.push(['Type', typeLabel(state.type), () => setFilters({ type: '' })]);
    if (state.year) chips.push(['Year', state.year, () => setFilters({ year: '' })]);
    u.active.replaceChildren();
    u.active.hidden = !chips.length;
    chips.forEach(([k, v, fn]) => u.active.appendChild(h('button', { type: 'button', class: 'chip', onclick: fn, 'aria-label': 'Remove filter ' + k + ': ' + v },
      h('span', { class: 'chip-k', text: k + ':' }), ' ', v, h('span', { class: 'chip-x', 'aria-hidden': 'true', text: ' ×' }))));
    if (chips.length > 1) u.active.appendChild(h('button', { type: 'button', class: 'linkbtn', text: 'Clear all', onclick: clearAll }));

    u.count.textContent = plural(items.length, isF ? 'finding' : 'source', isF ? 'findings' : 'sources') + (anyOn() ? ' match' + (items.length === 1 ? 'es' : '') : '');

    // search runs across everything: point to the other list when it has matches too
    u.cross.replaceChildren();
    if (state.q) {
      const other = run(isF ? DB.sources : DB.findings);
      if (other.length) {
        const view = isF ? 'sources' : 'explore';
        u.cross.append('Also in ' + (isF ? 'Sources' : 'Explore evidence') + ': ',
          h('a', { href: hashFor(view), text: plural(other.length, isF ? 'source document' : 'finding', isF ? 'source documents' : 'findings') + ' match' + (other.length === 1 ? 'es' : '') + ' “' + state.q + '”' }));
      }
    }
    u.cross.hidden = !u.cross.firstChild;

    u.results.replaceChildren();
    if (!items.length) { u.results.appendChild(emptyState(isF)); return; }
    pagedList(u.results, items, isF ? findingCard : sourceCard);
  }
  function clearAll() { state.q = ''; syncSearch(''); location.hash = hashFor(current.name, { q: '', subject: '', type: '', year: '' }); }
  function emptyState(isF) {
    return h('div', { class: 'state' },
      h('h2', { text: 'Nothing matches that search.' }),
      h('p', { text: 'Try fewer words, a different spelling, or a chemical name on its own. Filters combine, so removing one may help.' }),
      h('button', { type: 'button', class: 'btn', text: 'Clear search and filters', onclick: clearAll }));
  }

  /* ---------- detail helpers ---------- */
  function backLink() {
    const a = h('a', { class: 'back-results', href: lastList, text: '← Back to results' });
    a.addEventListener('click', (e) => {
      // one step back keeps the exact list, filters and scroll position
      if (history.state && history.state.fromList && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.button) { e.preventDefault(); history.back(); }
    });
    return a;
  }
  const block = (title, ...kids) => h('section', { class: 'block' }, h('h2', { text: title }), ...kids);
  function kv(rows) {
    const dl = h('dl', { class: 'kv' });
    rows.forEach(([k, v]) => { dl.append(h('dt', { text: k }), h('dd', null, v == null || v === '' ? h('span', { class: 'na', text: 'Not reported' }) : v)); });
    return dl;
  }
  function errorBox(retry) {
    return h('div', { class: 'state' }, h('h2', { text: 'Something went wrong.' }),
      h('p', { text: 'This record could not be loaded. Check your connection and try again.' }),
      h('button', { type: 'button', class: 'btn', text: 'Try again', onclick: retry }));
  }
  function notFound(what) {
    return h('div', { class: 'state' }, h('h1', { tabindex: '-1', text: 'This ' + what + ' could not be found.' }),
      h('p', { text: 'It may have been renamed, or it has not been published.' }), h('a', { class: 'btn', href: '#explore', text: 'Explore all evidence' }));
  }
  function originalLinks(src, page) {
    const url = safeUrl(src.url), pdf = safeUrl(src.pdf);
    const links = [];
    if (pdf) links.push(h('a', { class: 'btn primary', href: pdf + (page ? '#page=' + page : ''), target: '_blank', rel: 'noopener', text: 'Read original PDF' + (page ? ' (page ' + page + ')' : '') + ' ↗' }));
    if (url) links.push(h('a', { class: pdf ? 'btn' : 'btn primary', href: url, target: '_blank', rel: 'noopener', text: 'Read original report ↗' }));
    return links.length ? h('div', { class: 'links' }, links)
      : h('p', { class: 'warn', text: 'The original document is not linked yet, so this cannot be checked against its source from here.' });
  }
  function finish(root, ...kids) {
    root.replaceChildren(...kids);
    window.scrollTo(0, 0);
    const t = root.querySelector('h1'); if (t) t.focus({ preventScroll: true });
  }
  function barRow(label, value, unit, share, cls) {
    const fill = h('div', { class: 'fill ' + cls });
    fill.style.width = Math.max(share * 100, 0.8) + '%';
    return h('div', { class: 'cbar' }, h('div', { class: 'cbar-top' }, h('span', { text: label }), h('b', { text: value + ' ' + unit })), h('div', { class: 'track' }, fill));
  }
  const ratioText = (r) => (r >= 10 ? String(Math.round(r)) : r.toPrecision(2));
  function comparison(full, src) {
    const st = full.standard, sample = full.sample || {};
    const stSrc = st.source_id && DB.srcById[st.source_id];
    const v = num(full.value), l = num(st.limit);
    const comparable = st.comparable === true && v != null && l != null && full.unit === st.unit;
    const kids = [];
    if (comparable) {
      const max = Math.max(v, l);
      const label = 'Measured value compared with ' + st.name + ': ' + v + ' and ' + l + ' ' + full.unit;
      kids.push(h('figure', { class: 'bars', role: 'img', 'aria-label': label },
        barRow('Measured value', v, full.unit, v / max, ''),
        barRow(st.name || 'Standard', l, full.unit, l / max, 'lim'),
        h('figcaption', { text: 'Bars start at zero · ' + full.unit + ' · Source: ' + (src.title || '') + (full.locator ? ', ' + full.locator : '') + (sample.date ? ' · Sampled ' + fmtDate(sample.date) : '') })));
      kids.push(h('p', { class: 'small', text: 'Why these can be compared: ' + (st.comparable_note || 'same unit and same basis.') }));
    } else {
      kids.push(h('p', { class: 'caution', text: 'These two values are shown side by side but not compared. The measurement and the standard may not use the same basis (units, averaging period or sampling method), so no ratio is calculated. Check the source before comparing them.' }));
    }
    kids.push(kv([
      ['Measured value', valueText(full) ? valueText(full) + ' ' + (full.unit || '') : null],
      ['Measurement basis', sample.basis],
      ['Standard', st.name],
      ['Standard value', st.limit != null ? st.limit + ' ' + (st.unit || '') : null],
      ['Standard basis', st.basis],
      ['Standard source', stSrc ? h('a', { href: '#s/' + stSrc.id, text: stSrc.title + (st.locator ? ', ' + st.locator : '') }) : (st.source_label || null)]
    ]));
    return { el: block('How it compares with a standard', ...kids), ratio: comparable ? v / l : null };
  }
  function citation(src, full) {
    return [src.institution, src.title + (src.published ? ' (' + src.published + ')' : ''), full && full.locator, safeUrl(src.url) || safeUrl(src.pdf)].filter(Boolean).join('. ');
  }
  function citeBlock(src, full) {
    const text = citation(src, full);
    const btn = h('button', { type: 'button', class: 'btn', text: 'Copy citation' });
    btn.addEventListener('click', () => {
      const done = (m) => { btn.textContent = m; setTimeout(() => { btn.textContent = 'Copy citation'; }, 1800); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => done('Copied'), () => done('Select the text to copy'));
      else done('Select the text to copy');
    });
    return [h('p', { class: 'cite', text: text }), btn];
  }

  /* ================= FINDING ================= */
  const KEY_HEAD = { legislation: 'What the text says', audit: 'What the audit recorded' };
  async function showFinding(id, my) {
    const root = $('view');
    mount(); root.hidden = false;
    const f = DB.fById[id];
    if (!f) { document.title = 'Not found — ' + SITE; finish(root, h('div', { class: 'detail' }, backLink(), notFound('finding'))); return; }
    document.title = f.headline + ' — ' + SITE;
    root.replaceChildren(h('div', { class: 'detail' }, backLink(), h('p', { class: 'state', text: 'Loading the full record…' })));
    if (cameFromList) { history.replaceState({ fromList: true }, ''); cameFromList = false; }
    let src;
    try { src = await getSource(f.source_id); } catch (e) { if (my === token) finish(root, h('div', { class: 'detail' }, backLink(), errorBox(() => showFinding(id, my)))); return; }
    if (my !== token) return;
    const full = (src.findings || []).find((x) => x.id === id) || f;
    const kind = kindOf(full.kind);
    const ph = !!(src.placeholder || full.placeholder);
    const sample = full.sample || {};
    const v = valueText(full);
    const intro = full.intro || f.intro || full.summary;
    const draft = full.status && !['verified', 'published'].includes(full.status);

    /* --- main column --- */
    const main = [];
    main.push(h('header', { class: 'f-head' },
      h('p', { class: 'f-meta' }, h('span', { class: 'subject', text: subjLabels(f.subjects) || typeLabel(f.type) }), h('span', { class: 'meta', text: typeLabel(f.type) + (src.year ? ' · ' + src.year : '') })),
      h('h1', { tabindex: '-1', text: full.headline }),
      intro ? h('p', { class: 'intro', text: intro }) : null,
      h('p', { class: 'f-kind' }, kindBadge(kind, true), h('span', { text: ' ' + KINDS[kind].def })),
      ph ? phBadge() : null,
      draft ? h('p', { class: 'warn', text: 'Draft — this finding has not been verified yet and is not yet part of the published archive.' }) : null));

    // key result: a measurement, or the source's own words, or the conclusion in one line
    const keyTitle = v ? 'Key result' : (kind === 'interpretation' ? 'Interpretation added by this archive' : kind === 'allegation' ? 'The allegation' : (KEY_HEAD[src.type] || 'Key conclusion'));
    const ctx = [];
    if (full.pollutant) ctx.push(['Substance', full.pollutant]);
    if (sample.type) ctx.push(['Sample', sample.type]);
    if (sample.location) ctx.push(['Where', sample.location]);
    if (sample.date) ctx.push(['When', fmtDate(sample.date)]);
    if (sample.basis) ctx.push(['Basis', sample.basis]);
    let keyBody = null;
    if (v) {
      keyBody = [h('p', { class: 'big' }, h('span', { class: 'n', text: v }), full.unit ? h('span', { class: 'u', text: ' ' + full.unit }) : null),
        ctx.length ? kv(ctx) : null,
        full.quote ? h('blockquote', null, full.quote, h('cite', { text: [src.institution, full.locator].filter(Boolean).join(' — ') })) : null];
    } else if (full.quote) {
      keyBody = [h('blockquote', null, full.quote, h('cite', { text: [src.institution, full.locator].filter(Boolean).join(' — ') })),
        full.summary && full.summary !== intro ? h('p', { class: 'conclusion', text: full.summary }) : null];
    } else if (full.summary && full.intro && full.summary !== full.intro) {
      keyBody = [h('p', { class: 'conclusion', text: full.summary })];
    }
    if (keyBody) main.push(h('section', { class: 'key', 'aria-labelledby': 'keyH' }, h('h2', { id: 'keyH', text: keyTitle }), ...keyBody));

    if (full.explanation) main.push(block('What does this mean?', h('p', { class: 'prose', text: full.explanation }),
      kind === 'interpretation' || full.explanation ? h('p', { class: 'small', text: 'This explanation is written for readability by this archive. It is not a statement from the source.' }) : null));

    let ratio = null;
    if (full.standard) { const c = comparison(full, src); main.push(c.el); ratio = c.ratio; }

    const calcRows = () => {
      const c = full.calculation || {};
      const rows = [['Method', c.method], ['Inputs', c.inputs], ['Result', c.result]];
      if (ratio != null) rows.push(['Ratio to standard', valueText(full) + ' ÷ ' + full.standard.limit + ' = ' + ratioText(ratio)]);
      return kv(rows);
    };
    const hasCalc = !!(full.calculation || ratio != null);
    if (hasCalc && kind === 'calculation') main.push(block('How this was calculated', calcRows(), h('p', { class: 'small', text: 'Arithmetic derived from the reported values. It is not a finding of the source.' })));

    if (full.limitations) main.push(block('Limits and context', h('p', { class: 'prose', text: full.limitations })));

    // technical detail: open on demand, never needed to understand the finding
    const tech = [];
    if (sample.method || sample.type || sample.location || sample.date || sample.basis || full.pollutant)
      tech.push(h('h3', { text: 'Sampling and measurement' }), kv([['Substance or subject', full.pollutant], ['Sample type', sample.type], ['Location', sample.location], ['Sampling date', sample.date ? fmtDate(sample.date) : null], ['Method', sample.method], ['Basis', sample.basis]]));
    if (hasCalc && kind !== 'calculation') tech.push(h('h3', { text: 'Calculation' }), calcRows(), h('p', { class: 'small', text: 'Arithmetic derived from the reported values. It is not a finding of the source.' }));
    if (tech.length) main.push(h('details', { class: 'tech' }, h('summary', { text: 'Methodology and technical details' }), h('div', { class: 'tech-body' }, tech)));

    const rel = (full.related || []).map((r) => DB.fById[r]).filter(Boolean);
    if (rel.length) main.push(block('Related findings', h('ul', { class: 'rel' }, rel.map((r) => h('li', null, h('a', { href: '#f/' + r.id, text: r.headline }), h('span', { class: 'meta', text: (DB.srcById[r.source_id] || {}).title || '' }))))));
    const more = DB.findings.filter((x) => x.source_id === src.id && x.id !== id).length;
    if (more) main.push(block('More from this source', h('p', null, h('a', { href: '#s/' + src.id, text: 'See all ' + (more + 1) + ' findings from this document' }))));

    /* --- source and verification: a panel that stays beside the finding on wide screens --- */
    const side = h('aside', { class: 'source-panel', 'aria-labelledby': 'srcH' },
      h('h2', { id: 'srcH', text: 'Source and verification' }),
      h('p', { class: 'sp-title' }, h('a', { href: '#s/' + src.id, text: src.title })),
      kv([['Institution', src.institution], ['Published', fmtDate(src.published)], ['Page, table or section', full.locator], ['Report number', src.report_number]]),
      originalLinks(src, full.page),
      h('details', { class: 'cite-box' }, h('summary', { text: 'Cite this finding' }), ...citeBlock(src, full)));

    finish(root, h('div', { class: 'detail' }, backLink(), h('div', { class: 'f-layout' }, h('article', { class: 'f-main' }, main), side)));
  }

  /* ================= SOURCE ================= */
  function showSource(id, my) {
    const root = $('view');
    mount();
    const s = DB.srcById[id];
    if (!s) { document.title = 'Not found — ' + SITE; finish(root, h('div', { class: 'detail' }, backLink(), notFound('source'))); return; }
    if (cameFromList) { history.replaceState({ fromList: true }, ''); cameFromList = false; }
    document.title = s.title + ' — ' + SITE;
    const items = DB.findings.filter((f) => f.source_id === id);
    shown = PAGE;
    const box = h('div');
    finish(root, h('div', { class: 'detail' }, backLink(),
      h('header', { class: 'f-head' },
        h('p', { class: 'f-meta' }, h('span', { class: 'subject', text: typeLabel(s.type) }), h('span', { class: 'meta', text: subjLabels(s.subjects) })),
        h('h1', { tabindex: '-1', text: s.title }),
        s.summary ? h('p', { class: 'intro', text: s.summary }) : null,
        s.placeholder ? phBadge() : null),
      h('div', { class: 'f-layout' },
        h('div', { class: 'f-main' }, block('Findings from this document (' + items.length + ')', box)),
        h('aside', { class: 'source-panel', 'aria-labelledby': 'srcH' },
          h('h2', { id: 'srcH', text: 'About this document' }),
          kv([['Institution', s.institution], ['Published', fmtDate(s.published)], ['Document date', fmtDate(s.document_date)], ['Report number', s.report_number], ['Subjects', subjLabels(s.subjects) || null]]),
          originalLinks(s),
          h('details', { class: 'cite-box' }, h('summary', { text: 'Cite this document' }), ...citeBlock(s, null))))));
    if (!items.length) box.appendChild(h('p', { class: 'na', text: 'No published findings have been extracted from this document yet.' }));
    else pagedList(box, items, (f) => findingCard(f));
  }

  /* ---------- start ---------- */
  async function init() {
    const st = $('status');
    st.replaceChildren(h('p', { class: 'state', text: 'Loading the archive…' }));
    try { DB = await getJSON(DATA + 'index.json'); }
    catch (e) { st.replaceChildren(h('div', { class: 'state' }, h('h2', { text: 'The archive could not be loaded.' }), h('p', { text: 'Check your connection and try again.' }), h('button', { type: 'button', class: 'btn', text: 'Try again', onclick: init }))); return; }
    prepare();
    st.replaceChildren();

    const q = $('q');
    q.disabled = false;
    let timer;
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => setQuery(q.value.trim()), 140); });
    $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(timer); setQuery(q.value.trim()); q.blur(); });
    $('skip').addEventListener('click', (e) => { e.preventDefault(); $('main').focus(); });   // a plain #main link would change the page route

    const dev = $('devbanner');
    if (DB.dev) {
      const noIntro = DB.findings.filter((f) => !f.intro).length;
      dev.textContent = 'Development build — this archive currently contains placeholder content that is not real evidence.' + (noIntro ? ' ' + plural(noIntro, 'finding has', 'findings have') + ' no introduction yet.' : '');
      dev.hidden = false;
    }
    window.addEventListener('hashchange', route);
    route();
  }
  init();
})();
