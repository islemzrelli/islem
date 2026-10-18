/* The Evidence — search, filters, hash routing and rendering.
   Data: data/index.json (search index, key results, taxonomy) + data/sources/<id>.json (full records, loaded on demand).
   All text is inserted with textContent, never innerHTML.

   Pages (hash based, so direct links and refresh work on GitHub Pages):
     #                                       Overview
     #explore?q=&subject=&type=&year=        Explore evidence, "Key results" view (the default)
     #explore?view=all&sort=...              Explore evidence, "All evidence" view
     #sources?q=&subject=&type=&year=&sort=  Sources (documents)
     #f/<finding-id>                         One finding
     #s/<source-id>                          One source document
     #?...                                   Old list links; still work and are redirected */
(function () {
  'use strict';

  const DATA = 'data/';
  const PAGE = 30;
  const SITE = 'The Evidence';

  /* How a statement relates to its source. */
  const KINDS = {
    stated: { label: 'Stated in the source', def: 'The document says this explicitly.' },
    summary: { label: 'Summary of the source', def: 'A faithful plain-language paraphrase of what the document says.' },
    calculation: { label: 'Calculated from source data', def: 'Arithmetic on values the source reports. Inputs and method are shown. The source did not state the result.' },
    interpretation: { label: 'Interpretation', def: 'Explanation or context added by this archive. The source did not state it.' }
  };
  const kindOf = (k) => KINDS[k] ? k : 'stated';
  const GROUPS = { health: 'Health', environment: 'Environment', accountability: 'Accountability' };
  const REF_TYPES = {
    national_law_or_standard: 'Tunisian law or standard',
    bank_safeguard: 'African Development Bank safeguard',
    national_law_and_bank_safeguard: 'Tunisian law and African Development Bank safeguard'
  };

  const state = { q: '', subject: '', type: '', year: '', sort: 'relevance', view: 'key' };
  const srcCache = {};
  let DB = null;
  let token = 0;
  let saved = null;          // scroll position of the list, kept while a finding is open
  let lastList = '#explore'; // where "Back to results" goes
  let cameFromList = false;  // set when a result was just clicked
  let ui = null;             // handles to the Explore / Sources controls while they are on screen
  let current = { name: '' };
  let shown = PAGE;

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
  const asText = (v) => (Array.isArray(v) ? v.join(', ') : v);

  /* ---------- labels and formatting ---------- */
  const lab = (list, id) => { const x = list.find((t) => t.id === id); return x ? x.label : id; };
  const subjLabel = (id) => lab(DB.taxonomy.subjects, id);
  const subjLabels = (ids) => (ids || []).map(subjLabel).join(', ');
  const typeLabel = (id) => lab(DB.taxonomy.types, id);
  const evLabel = (id) => (DB.evById[id] ? DB.evById[id].label : '');
  const srcName = (s) => s.short_title || s.title || s.id;
  function fmtDate(s) {
    if (!s) return null;
    const o = { timeZone: 'UTC', year: 'numeric' };
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { ...o, day: 'numeric', month: 'long' });
    if (/^\d{4}-\d{2}$/.test(s)) return new Date(s + '-01T00:00:00Z').toLocaleDateString('en-GB', { ...o, month: 'long' });
    return s;
  }
  const num = (v) => {
    if (v === '' || v == null) return null;
    const n = Number(String(v).replace(',', '.'));
    return isNaN(n) ? null : n;
  };
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
    DB.evById = {};
    (DB.taxonomy.evidence_levels || []).forEach((e) => { DB.evById[e.id] = e; });
    DB.srcById = {}; DB.fById = {};
    DB.sources.forEach((s) => {
      s.subjects = s.subjects || []; s.keywords = s.keywords || [];
      s._b = fold([s.title, s.short_title, asText(s.authors), s.institution, s.summary, s.keywords.join(' '), typeLabel(s.type), subjLabels(s.subjects), s.year, s.published, s.report_number, s.doi].join(' '));
      s._h = fold(s.title + ' ' + (s.short_title || '') + ' ' + (s.institution || ''));
      DB.srcById[s.id] = s;
    });
    DB.nFindings = {};
    DB.findings.forEach((f) => {
      const s = DB.srcById[f.source_id] || {};
      if (!f.subjects || !f.subjects.length) f.subjects = s.subjects || [];
      f.type = s.type; f.year = s.year; f.published = s.published || String(s.year || '');
      f.placeholder = !!(f.placeholder || s.placeholder);
      f._b = fold([f.headline, f.summary, f.intro, f.pollutant, f.value, f.unit, f.locator, (f.keywords || []).join(' '),
        KINDS[kindOf(f.kind)].label, evLabel(f.evidence_level), f.rating, typeLabel(f.type), subjLabels(f.subjects), s.title, s.short_title, asText(s.authors), s.institution, s.year, s.report_number].join(' '));
      f._h = fold(f.headline + ' ' + (f.pollutant || ''));
      DB.fById[f.id] = f;
      DB.nFindings[f.source_id] = (DB.nFindings[f.source_id] || 0) + 1;
    });
    DB.years = [...new Set(DB.sources.map((s) => s.year).filter(Boolean))].sort((a, b) => b - a);
    // key results: curated plain-language summaries, each backed by findings
    DB.key_results = DB.key_results || [];
    DB.key_results.forEach((k) => {
      k.support = (k.support || []).filter((id) => DB.fById[id]);
      const fs = k.support.map((id) => DB.fById[id]);
      k.sourceIds = [...new Set(fs.map((f) => f.source_id))];
      k.types = [...new Set(fs.map((f) => f.type))];
      k.years = [...new Set(fs.map((f) => String(f.year)))];
      if (!k.subjects || !k.subjects.length) k.subjects = [...new Set(fs.flatMap((f) => f.subjects))];
      k._b = fold([k.headline, k.plain, k.not_shown, k.figure, k.unit, evLabel(k.evidence_level), subjLabels(k.subjects), fs.map((f) => f.headline + ' ' + (f.pollutant || '')).join(' ')].join(' '));
      k._h = fold(k.headline + ' ' + (k.figure || ''));
    });
  }

  /* ---------- search and filters ---------- */
  function parseQuery(q) {
    const toks = []; const re = /"([^"]+)"|(\S+)/g; let m;
    while ((m = re.exec(q))) { const t = fold(m[1] || m[2]).trim(); if (t) toks.push(t); }
    return toks;
  }
  /* skip = 'subject' ignores the subject filter (used to count what each subject tab would give).
     keep = true keeps the editors' order (key results). */
  function run(list, skip, keep) {
    const toks = parseQuery(state.q);
    const out = [];
    for (const it of list) {
      if (skip !== 'subject' && state.subject && !it.subjects.includes(state.subject)) continue;
      if (state.type && !(it.types ? it.types.includes(state.type) : it.type === state.type)) continue;
      if (state.year && !(it.years ? it.years.includes(state.year) : String(it.year) === state.year)) continue;
      let score = 0, ok = true;
      for (const t of toks) {
        if (!it._b.includes(t)) { ok = false; break; }
        score += it._h.includes(t) ? 3 : 1;
      }
      if (ok) out.push({ it, score });
    }
    if (keep) return out.map((x) => x.it);
    const byDate = (a, b) => String(b.it.published || '').localeCompare(String(a.it.published || ''));
    const tie = (a, b) => (a.it.id < b.it.id ? -1 : 1);
    if (state.sort === 'oldest') out.sort((a, b) => -byDate(a, b) || tie(a, b));
    else if (state.sort === 'newest') out.sort((a, b) => byDate(a, b) || tie(a, b));
    else out.sort((a, b) => b.score - a.score || byDate(a, b) || tie(a, b));
    return out.map((x) => x.it);
  }
  const anyOn = () => !!(state.q || state.subject || state.type || state.year);

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
    state.view = ['all', 'findings'].includes(p.get('view')) ? 'all' : 'key';
    shown = PAGE;
  }
  /* Build the hash for a list page from the current state plus any changes */
  function hashFor(route, change) {
    const s = Object.assign({}, state, change || {});
    const p = new URLSearchParams();
    if (s.q) p.set('q', s.q);
    if (s.subject) p.set('subject', s.subject);
    if (s.type) p.set('type', s.type);
    if (s.year) p.set('year', s.year);
    if (s.sort !== 'relevance' && !(route === 'explore' && s.view === 'key')) p.set('sort', s.sort);
    if (route === 'explore' && s.view === 'all') p.set('view', 'all');
    const qs = p.toString();
    return '#' + route + (qs ? '?' + qs : '');
  }
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
    applyParams(r.p);
    if (r.legacy) history.replaceState(null, '', location.pathname + location.search + hashFor(r.name));
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
    const base = current.name === 'sources' ? 'Sources' : (state.view === 'all' ? 'All evidence' : 'Explore evidence');
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
  function evBadge(id, withDef) {
    const e = DB.evById[id];
    if (!e) return null;
    return h('span', { class: 'kind ev-' + id, text: e.label, title: withDef ? null : e.definition });
  }
  /* badges for a finding in a list: the evidence level, plus the statement type when it is not a plain "stated" */
  function badgesFor(f) {
    const ev = evBadge(f.evidence_level);
    const k = kindOf(f.kind);
    return [ev, (!ev || k !== 'stated') ? kindBadge(k) : null];
  }
  const phBadge = () => h('span', { class: 'ph', text: 'Placeholder — not real data' });
  function pageHead(title, intro) {
    return h('header', { class: 'page-head' }, h('h1', { tabindex: '-1', text: title }), intro ? h('p', { class: 'lede', text: intro }) : null);
  }
  const srcLine = (s) => [s.institution, fmtDate(s.published)].filter(Boolean).join(' · ');

  /* A finding as one row of the "All evidence" table (also used on a source page) */
  function trow(f) {
    const s = DB.srcById[f.source_id] || {};
    const v = valueText(f);
    return h('article', { class: 'trow' },
      h('div', { class: 'tr-main' },
        h('h3', { class: 'tr-title' }, h('a', { class: 'stretch', href: '#f/' + f.id, onclick: rememberScroll, text: f.headline })),
        f.summary ? h('p', { class: 'tr-sum', text: f.summary }) : null,
        v ? h('p', { class: 'tr-val' }, h('b', { text: v }), f.unit ? ' ' + f.unit : null, f.pollutant ? ' · ' + f.pollutant : null) : null,
        f.placeholder ? phBadge() : null),
      h('div', { class: 'tr-c tr-subj', text: subjLabels(f.subjects.slice(0, 2)) }),
      h('div', { class: 'tr-c tr-src' }, h('span', { class: 'src-title', text: srcName(s) }), h('span', { text: [f.year, f.locator].filter(Boolean).join(' · ') })),
      h('div', { class: 'tr-c tr-type' }, badgesFor(f)));
  }
  const thead = () => h('div', { class: 'thead', 'aria-hidden': 'true' }, h('span', { text: 'Result' }), h('span', { text: 'Subject' }), h('span', { text: 'Source' }), h('span', { text: 'Kind of evidence' }));

  function sourceCard(s) {
    const n = DB.nFindings[s.id] || 0;
    return h('article', { class: 'card has-result' },
      h('div', { class: 'card-main' },
        h('p', { class: 'card-top' }, h('span', { class: 'subject', text: typeLabel(s.type) }), h('span', { class: 'meta', text: s.year || 'n.d.' })),
        h('h3', { class: 'card-title' }, h('a', { class: 'stretch', href: '#s/' + s.id, onclick: rememberScroll, text: s.title })),
        s.summary ? h('p', { class: 'card-text', text: s.summary }) : null,
        h('p', { class: 'card-src' }, h('span', { text: [asText(s.authors), srcLine(s)].filter(Boolean).join(' — ') + (s.report_number ? ' · No. ' + s.report_number : '') })),
        s.placeholder ? phBadge() : null),
      h('div', { class: 'card-result' },
        h('span', { class: 'cr-value' }, h('span', { class: 'v', text: String(n) })),
        h('span', { class: 'cr-what', text: n === 1 ? 'finding' : 'findings' })));
  }

  /* A key result: the main point in plain words. Opens in place to show what it does not show and what backs it. */
  function keyEl(k) {
    const fs = k.support.map((id) => DB.fById[id]);
    const srcs = k.sourceIds.map((id) => DB.srcById[id]).filter(Boolean);
    const same = srcs.length > 1 && new Set(srcs.map((s) => JSON.stringify(s.authors || s.institution))).size === 1;
    const kinds = [...new Set(srcs.map((s) => typeLabel(s.type).toLowerCase()))].join(', ');
    const backed = 'Backed by ' + plural(srcs.length, 'source', 'sources') + (kinds ? ' (' + kinds + ')' : '') + (same ? ', all by the same research team' : '') + '.';
    return h('article', { class: 'kr' }, h('details', null,
      h('summary', null,
        h('span', { class: 'kr-fig' + (k.figure ? '' : ' none') }, k.figure ? [h('b', { text: k.figure }), k.unit ? h('small', { text: k.unit }) : null] : null),
        h('span', { class: 'kr-main' },
          h('span', { class: 'kr-meta' }, h('span', { class: 'subject', text: subjLabels(k.subjects.slice(0, 2)) }), evBadge(k.evidence_level)),
          h('span', { class: 'kr-head', text: k.headline }),
          h('span', { class: 'kr-open' }, h('span', { class: 'o', text: 'Show details' }), h('span', { class: 'c', text: 'Hide details' })))),
      h('div', { class: 'kr-body' },
        k.plain ? h('p', { class: 'kr-plain', text: k.plain }) : null,
        k.not_shown ? h('p', { class: 'kr-not' }, h('b', { text: 'What this does not show: ' }), k.not_shown) : null,
        h('p', { class: 'kr-back', text: backed }),
        h('ul', { class: 'kr-list' }, fs.map((f) => h('li', null,
          h('a', { href: '#f/' + f.id, onclick: rememberScroll, text: f.headline }),
          h('span', { class: 'meta', text: [srcName(DB.srcById[f.source_id] || {}), f.year, f.locator].filter(Boolean).join(' — ') })))))));
  }

  function pagedList(box, items, build, cls, head) {
    const list = h('div', { class: cls || 'cards' }, head || null);
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
    const nKey = DB.key_results.length;
    const groups = Object.keys(GROUPS).map((g) => ({ g, list: DB.taxonomy.subjects.filter((s) => (s.group || 'other') === g) })).filter((x) => x.list.length);
    const loose = DB.taxonomy.subjects.filter((s) => !GROUPS[s.group]);
    if (loose.length) groups.push({ g: 'other', list: loose });
    const evKinds = DB.taxonomy.evidence_levels || [];
    mount(
      h('header', { class: 'page-head hero' },
        h('h1', { tabindex: '-1', text: 'The Evidence' }),
        h('p', { class: 'lede', text: 'The environmental crisis in Gabès is documented in scientific analyses, institutional reports, and legal records. This archive brings those findings together, makes each one understandable, and traces every claim back to its source.' }),
        h('div', { class: 'cta' },
          h('a', { class: 'btn primary', href: '#explore', text: nKey ? 'Read the ' + nKey + ' key results' : 'Explore the evidence' }),
          h('a', { class: 'btn', href: '#explore?view=all', text: 'All ' + DB.findings.length + ' findings' }),
          h('a', { class: 'btn', href: '#sources', text: DB.sources.length + ' source documents' })),
        h('p', { class: 'meta', text: [nKey ? plural(nKey, 'key result', 'key results') : null, DB.findings.length + ' findings from ' + DB.sources.length + ' sources', DB.generated ? 'Updated ' + fmtDate(DB.generated) : null].filter(Boolean).join(' · ') })),
      nKey ? h('section', { class: 'band', 'aria-labelledby': 'ovKey' },
        h('h2', { id: 'ovKey', text: 'Key results' }),
        h('p', { class: 'prose', text: 'The main points in plain words. Open any card to see what it does not show and which sources back it.' }),
        h('div', { class: 'krs' }, DB.key_results.slice(0, 4).map(keyEl)),
        h('p', { class: 'keyfoot' }, h('a', { href: '#explore', text: nKey > 4 ? 'See all ' + nKey + ' key results →' : 'Open in Explore evidence →' }))) : null,
      h('section', { class: 'band', 'aria-labelledby': 'ovSubj' },
        h('h2', { id: 'ovSubj', text: 'Browse by subject' }),
        groups.map(({ g, list }) => h('div', { class: 'sg-block' },
          h('h3', { class: 'sg-head', text: GROUPS[g] || 'Other' }),
          h('ul', { class: 'subject-grid' }, list.map((s) => {
            const n = DB.findings.filter((f) => f.subjects.includes(s.id)).length;
            return h('li', null, h('a', { href: '#explore?subject=' + s.id },
              h('span', { class: 'sg-name', text: s.label }),
              s.question ? h('span', { class: 'sg-q', text: s.question }) : null,
              h('span', { class: 'sg-n', text: plural(n, 'finding', 'findings') })));
          }))))),
      h('section', { class: 'band how', 'aria-labelledby': 'ovHow' },
        h('h2', { id: 'ovHow', text: 'How to read a finding' }),
        h('p', { class: 'prose', text: 'Every finding has the same layout: the subject, a headline saying what was found, a short introduction, the key result, an explanation of what it means and does not mean, and the source with a link to the original document.' }),
        h('p', { class: 'prose', text: 'Not every statement carries the same weight, so each one is labelled with what kind of evidence it is:' }),
        h('dl', { class: 'legend' }, evKinds.flatMap((e) => [h('dt', null, evBadge(e.id, true)), h('dd', { text: e.definition })])),
        h('p', { class: 'prose', text: 'And how it relates to the source document:' }),
        h('dl', { class: 'legend' }, Object.keys(KINDS).flatMap((k) => [h('dt', null, kindBadge(k, true)), h('dd', { text: KINDS[k].def })])))
    );
    if (document.activeElement !== $('q')) focusHeading();
    window.scrollTo(0, 0);
  }

  /* ================= EXPLORE / SOURCES ================= */
  function drawBrowse(kind) {
    const isF = kind === 'explore';
    const u = { kind };
    u.subjLinks = {};
    // subject navigation: grouped tabs on wide screens, a drop-down on narrow ones. Same state, same links.
    const mk = (parent, id, label) => {
      const a = h('a', { href: '#', 'data-s': id }, h('span', { class: 'st-name', text: label }), h('span', { class: 'st-n' }));
      u.subjLinks[id] = a; parent.appendChild(h('li', null, a));
    };
    u.tabs = h('div', { class: 'subject-tabs' });
    const allUl = h('ul', { class: 'st-list st-all' }); mk(allUl, '', 'All subjects'); u.tabs.appendChild(allUl);
    const groupIds = Object.keys(GROUPS);
    groupIds.concat('other').forEach((g) => {
      const list = DB.taxonomy.subjects.filter((s) => (GROUPS[s.group] ? s.group : 'other') === g);
      if (!list.length) return;
      const ul = h('ul', { class: 'st-list' });
      list.forEach((s) => mk(ul, s.id, s.label));
      u.tabs.appendChild(h('div', { class: 'st-group' }, h('p', { class: 'st-title', text: GROUPS[g] || 'Other' }), ul));
    });
    u.subjSel = h('select', { id: 'subjSel', onchange: (e) => setFilters({ subject: e.target.value }) });
    u.subjSel.appendChild(h('option', { value: '', text: 'All subjects' }));
    groupIds.concat('other').forEach((g) => {
      const list = DB.taxonomy.subjects.filter((s) => (GROUPS[s.group] ? s.group : 'other') === g);
      if (!list.length) return;
      u.subjSel.appendChild(h('optgroup', { label: GROUPS[g] || 'Other' }, list.map((s) => h('option', { value: s.id, text: s.label }))));
    });
    u.about = h('div', { class: 'about' });

    u.type = h('select', { id: 'fType', onchange: (e) => setFilters({ type: e.target.value }) }, h('option', { value: '', text: 'All source types' }),
      DB.taxonomy.types.map((t) => h('option', { value: t.id, text: t.label })));
    u.year = h('select', { id: 'fYear', onchange: (e) => setFilters({ year: e.target.value }) }, h('option', { value: '', text: 'All years' }),
      DB.years.map((y) => h('option', { value: String(y), text: String(y) })));
    u.sort = h('select', { id: 'fSort', onchange: (e) => setFilters({ sort: e.target.value }) },
      h('option', { value: 'relevance', text: 'Best match' }), h('option', { value: 'newest', text: 'Newest first' }), h('option', { value: 'oldest', text: 'Oldest first' }));
    const field = (label, sel) => h('div', { class: 'field' }, h('label', { for: sel.id, text: label }), sel);
    u.sortField = field('Sort by', u.sort);
    u.moreSum = h('summary', { text: 'More filters' });
    u.more = h('details', { class: 'morefilters' }, u.moreSum, h('div', { class: 'filters' }, field('Source type', u.type), field('Year', u.year), u.sortField));

    u.active = h('div', { class: 'active', 'aria-label': 'Active filters' });
    u.toggle = isF ? h('nav', { class: 'view-toggle', 'aria-label': 'Results view' },
      h('a', { href: '#', 'data-v': 'key' }, h('span', { text: 'Key results' }), h('span', { class: 'st-n' })),
      h('a', { href: '#', 'data-v': 'all' }, h('span', { text: 'All evidence' }), h('span', { class: 'st-n' }))) : null;
    u.keynote = h('p', { class: 'keynote' }, 'The main points in plain words. Open any card to see what it does not show and which sources back it.');
    u.count = h('p', { class: 'count', role: 'status' });
    u.cross = h('p', { class: 'cross' });
    u.results = h('div', { id: 'results' });

    ui = u;
    mount(
      isF ? pageHead('Explore evidence', 'Start with the key results, or switch to all evidence to see every finding. Search above, or narrow the list by subject, source type and year.')
        : pageHead('Sources', 'The documents behind the findings: studies, audits and press investigations. Open one to see every finding taken from it and to read the original.'),
      h('section', { class: 'controls' },
        h('nav', { class: 'subjects', 'aria-label': 'Subjects' },
          h('p', { class: 'ctl-title', text: 'Subject' }), u.tabs,
          h('div', { class: 'subject-select' }, h('label', { for: 'subjSel', text: 'Subject' }), u.subjSel)),
        u.about, u.more, u.active),
      h('section', { class: 'results', 'aria-labelledby': 'resH' },
        h('h2', { class: 'vh', id: 'resH', text: 'Results' }), u.toggle, u.keynote, u.count, u.cross, u.results));
  }

  function updateBrowse() {
    const u = ui; if (!u) return;
    const isF = u.kind === 'explore';
    const view = isF ? state.view : 'sources';
    const pools = { key: DB.key_results, all: DB.findings, sources: DB.sources };
    const items = run(pools[view], null, view === 'key');
    syncSearch(state.q);
    u.type.value = state.type; u.year.value = state.year; u.sort.value = state.sort; u.subjSel.value = state.subject;
    u.sortField.hidden = view === 'key';
    const extra = (state.type ? 1 : 0) + (state.year ? 1 : 0) + (state.sort !== 'relevance' && view !== 'key' ? 1 : 0);
    u.moreSum.textContent = 'More filters' + (extra ? ' (' + extra + ' on)' : '');
    if (extra && !u.more.open) u.more.open = true;

    // subject tabs: counts show how many results each subject would give with the other filters kept
    const base = run(pools[view], 'subject', true);
    const per = {}; base.forEach((it) => it.subjects.forEach((s) => { per[s] = (per[s] || 0) + 1; }));
    for (const id in u.subjLinks) {
      const a = u.subjLinks[id];
      const n = id === '' ? base.length : (per[id] || 0);
      a.href = hashFor(u.kind, { subject: id });
      a.querySelector('.st-n').textContent = n;
      if (id === state.subject) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    }
    u.subjSel.querySelectorAll('option').forEach((o) => {
      const n = o.value === '' ? base.length : (per[o.value] || 0);
      o.textContent = (o.value === '' ? 'All subjects' : subjLabel(o.value)) + ' (' + n + ')';
    });

    // what this subject is about, and where to start reading
    u.about.replaceChildren();
    const sj = state.subject && DB.taxonomy.subjects.find((s) => s.id === state.subject);
    u.about.hidden = !sj;
    if (sj) {
      const start = (sj.start_here || []).map((id) => DB.srcById[id]).filter(Boolean);
      u.about.append(
        sj.question ? h('p', { class: 'about-q', text: sj.question }) : null,
        sj.intro ? h('p', { class: 'about-t', text: sj.intro }) : null,
        start.length ? h('p', { class: 'about-s' }, h('b', { text: 'Start with: ' }), start.map((s, i) => [i ? ' · ' : '', h('a', { href: '#s/' + s.id, text: srcName(s) })])) : null);
    }

    // key results / all evidence switch (counts follow the search and filters)
    if (u.toggle) {
      const K = run(DB.key_results, null, true).length, F = run(DB.findings).length;
      u.toggle.querySelectorAll('a').forEach((a) => {
        const v = a.getAttribute('data-v');
        a.href = hashFor('explore', { view: v });
        a.querySelector('.st-n').textContent = v === 'key' ? K : F;
        if (v === view) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      });
    }
    u.keynote.hidden = view !== 'key';

    // active filter chips: each is a button that removes that filter
    const chips = [];
    if (state.q) chips.push(['Search', '“' + state.q + '”', () => { setQuery(''); syncSearch(''); }]);
    if (state.subject) chips.push(['Subject', subjLabel(state.subject), () => setFilters({ subject: '' })]);
    if (state.type) chips.push(['Type', typeLabel(state.type), () => setFilters({ type: '' })]);
    if (state.year) chips.push(['Year', state.year, () => setFilters({ year: '' })]);
    u.active.replaceChildren();
    u.active.hidden = !chips.length;
    chips.forEach(([k, v, fn]) => u.active.appendChild(h('button', { type: 'button', class: 'chip', onclick: fn, 'aria-label': 'Remove filter ' + k + ': ' + v },
      h('span', { class: 'chip-k', text: k + ':' }), ' ', v, h('span', { class: 'chip-x', 'aria-hidden': 'true', text: ' ×' }))));
    if (chips.length > 1) u.active.appendChild(h('button', { type: 'button', class: 'linkbtn', text: 'Clear all', onclick: clearAll }));

    const noun = { key: ['key result', 'key results'], all: ['finding', 'findings'], sources: ['source', 'sources'] }[view];
    u.count.textContent = plural(items.length, noun[0], noun[1]) + (anyOn() ? ' match' + (items.length === 1 ? 'es' : '') : '');

    // search runs across everything: point to the other lists when they have matches too
    u.cross.replaceChildren();
    if (state.q) {
      const opts = [['key', 'key result', 'key results', run(DB.key_results, null, true).length, hashFor('explore', { view: 'key' })],
        ['all', 'finding', 'findings', run(DB.findings).length, hashFor('explore', { view: 'all' })],
        ['sources', 'source', 'sources', run(DB.sources).length, hashFor('sources')]].filter((o) => o[0] !== view && o[3]);
      if (opts.length) {
        u.cross.append('Also matching “' + state.q + '”: ');
        opts.forEach((o, i) => u.cross.append(i ? ' · ' : '', h('a', { href: o[4], text: plural(o[3], o[1], o[2]) })));
      }
    }
    u.cross.hidden = !u.cross.firstChild;

    u.results.replaceChildren();
    if (!items.length) { u.results.appendChild(emptyState(view)); return; }
    if (view === 'key') {
      u.results.appendChild(h('div', { class: 'krs' }, items.map(keyEl)));
      u.results.appendChild(h('p', { class: 'keyfoot' }, 'Need every finding? ', h('a', { href: hashFor('explore', { view: 'all' }), text: 'See all ' + DB.findings.length + ' findings →' })));
      return;
    }
    if (view === 'all') pagedList(u.results, items, trow, 'tbl', thead());
    else pagedList(u.results, items, sourceCard, 'cards');
  }
  function clearAll() { location.hash = hashFor(current.name, { q: '', subject: '', type: '', year: '' }); syncSearch(''); }
  function emptyState(view) {
    return h('div', { class: 'state' },
      h('h2', { text: 'Nothing matches that search.' }),
      h('p', { text: view === 'key' ? 'Key results cover the main points only. Search all evidence to see every finding, or remove a filter.' : 'Try fewer words, a different spelling, or a chemical name on its own. Filters combine, so removing one may help.' }),
      h('div', { class: 'cta' },
        view === 'key' ? h('a', { class: 'btn primary', href: hashFor('explore', { view: 'all' }), text: 'Search all evidence' }) : null,
        h('button', { type: 'button', class: 'btn', text: 'Clear search and filters', onclick: clearAll })));
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
    return [asText(src.authors) || src.institution, src.title + (src.published ? ' (' + src.published + ')' : ''), full && full.locator, safeUrl(src.url) || safeUrl(src.pdf)].filter(Boolean).join('. ');
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
  function doiLink(doi) {
    return doi && /^10\.\d{4,9}\/\S+$/.test(doi) ? h('a', { href: 'https://doi.org/' + encodeURI(doi), target: '_blank', rel: 'noopener', text: doi }) : (doi || null);
  }
  const yesNo = (b) => (b === true ? 'Yes' : b === false ? 'No' : null);
  function sourceRows(src, full) {
    // rows that only matter when present (a DOI means nothing for an audit) are left out when empty
    return [['Authors', asText(src.authors)], ['Institution or journal', src.institution], ['Published', fmtDate(src.published)],
      full ? ['Page, table or section', full.locator] : ['Document date', fmtDate(src.document_date)],
      ['DOI', doiLink(src.doi)], ['Peer reviewed', yesNo(src.peer_reviewed)], ['Report number', src.report_number]]
      .filter((r) => !['Authors', 'DOI', 'Peer reviewed', 'Report number', 'Document date'].includes(r[0]) || (r[1] != null && r[1] !== ''));
  }

  /* ================= FINDING ================= */
  const KEY_HEAD = { audit: 'What the audit recorded', press: 'What the article says' };
  async function showFinding(id, my) {
    const root = $('view');
    mount();
    const f = DB.fById[id];
    if (!f) { document.title = 'Not found — ' + SITE; finish(root, h('div', { class: 'detail' }, backLink(), notFound('finding'))); return; }
    document.title = f.headline + ' — ' + SITE;
    root.replaceChildren(h('div', { class: 'detail' }, backLink(), h('p', { class: 'state', text: 'Loading the full record…' })));
    if (cameFromList) { history.replaceState({ fromList: true }, ''); cameFromList = false; }
    let src, partial = false;
    try { src = await getSource(f.source_id); }
    catch (e) { src = { findings: [] }; partial = true; }   // the finding can still be shown from the index
    if (my !== token) return;
    src = Object.assign({}, DB.srcById[f.source_id], src);
    const full = (src.findings || []).find((x) => x.id === id) || f;
    const kind = kindOf(full.kind);
    const evId = full.evidence_level || f.evidence_level;
    const ph = !!(src.placeholder || full.placeholder);
    const sample = full.sample || {};
    const v = valueText(full);
    const intro = full.intro || f.intro || full.summary;
    const draft = DB.dev && full.status && !['verified', 'published'].includes(full.status);
    const lang = src.language && src.language !== 'en' ? src.language : null;

    /* --- main column --- */
    const main = [];
    main.push(h('header', { class: 'f-head' },
      h('p', { class: 'f-meta' }, h('span', { class: 'subject', text: subjLabels(f.subjects) || typeLabel(f.type) }), h('span', { class: 'meta', text: typeLabel(f.type) + (src.year ? ' · ' + src.year : '') })),
      h('h1', { tabindex: '-1', text: full.headline }),
      intro ? h('p', { class: 'intro', text: intro }) : null,
      evId && DB.evById[evId] ? h('p', { class: 'f-kind' }, evBadge(evId, true), h('span', { text: ' ' + DB.evById[evId].definition })) : null,
      (!evId || kind !== 'stated') ? h('p', { class: 'f-kind' }, kindBadge(kind, true), h('span', { text: ' ' + KINDS[kind].def })) : null,
      ph ? phBadge() : null,
      partial ? h('p', { class: 'warn', text: 'The full record could not be loaded, so only the summary is shown. Reload the page to try again.' }) : null,
      draft ? h('p', { class: 'warn', text: 'Draft — this finding has not been verified yet and is not yet part of the published archive.' }) : null));

    // key result: a measurement, or the source's own words, or the conclusion in one line
    const isAudit = !!full.rating;
    const keyTitle = v ? 'Key result' : (kind === 'interpretation' ? 'Interpretation added by this archive' : (KEY_HEAD[src.type] || 'Key conclusion'));
    const ctx = [];
    if (full.pollutant) ctx.push(['Substance', full.pollutant]);
    if (sample.type) ctx.push(['Sample', sample.type]);
    if (sample.location) ctx.push(['Where', sample.location]);
    if (sample.date) ctx.push(['When', fmtDate(sample.date)]);
    if (sample.basis) ctx.push(['Basis', sample.basis]);
    const quote = full.quote ? h('blockquote', null, full.quote, h('cite', { text: [src.institution, full.locator].filter(Boolean).join(' — ') })) : null;
    let keyBody = null;
    if (isAudit) {
      const refRows = [['Checked against', full.reference], ['Type of reference', REF_TYPES[full.reference_type] || full.reference_type]];
      if (full.also_in && full.also_in.length) refRows.push(['Also covered in', full.also_in.join('; ')]);
      keyBody = [quote,
        h('p', { class: 'rating' }, h('span', { class: 'r-l', text: 'Audit rating' }), h('span', { class: 'r-v', text: full.rating })),
        kv(refRows)];
    } else if (v) {
      keyBody = [h('p', { class: 'big' }, h('span', { class: 'n', text: v }), full.unit ? h('span', { class: 'u', text: ' ' + full.unit }) : null), ctx.length ? kv(ctx) : null, quote];
    } else if (full.quote) {
      keyBody = [quote, full.summary && full.summary !== intro ? h('p', { class: 'conclusion', text: full.summary }) : null];
    } else if (full.summary && intro && full.summary !== intro) {
      keyBody = [h('p', { class: 'conclusion', text: full.summary })];
    }
    if (keyBody) main.push(h('section', { class: 'key', 'aria-labelledby': 'keyH' }, h('h2', { id: 'keyH', text: keyTitle }), ...keyBody));

    if (full.explanation) main.push(block('What does this mean?', h('p', { class: 'prose', text: full.explanation }),
      h('p', { class: 'small', text: 'This explanation is written for readability by this archive. It is not a statement from the source.' })));

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

    if (full.limitations) main.push(block('What this does not show', h('p', { class: 'prose', text: full.limitations })));

    // the audit's own proposed fix, kept clearly apart from the finding
    const ca = full.corrective_action;
    if (ca && ca.action) main.push(block('Corrective action in the audit’s action plan',
      h('p', { class: 'prose', text: ca.action }),
      kv([['Responsible', ca.responsible], ['Deadline', ca.deadline], ['Budget', ca.budget_mdt ? ca.budget_mdt + ' MDT' : null], ['Where in the audit', ca.locator]]),
      h('p', { class: 'small', text: 'This is an action the audit proposes. It is not evidence that the action has been carried out.' })));

    // technical detail: open on demand, never needed to understand the finding
    const tech = [];
    if (sample.method || sample.type || sample.location || sample.date || sample.basis || (v && full.pollutant))
      tech.push(h('h3', { text: 'Sampling and measurement' }), kv([['Substance or subject', full.pollutant], ['Sample type', sample.type], ['Location', sample.location], ['Sampling date', sample.date ? fmtDate(sample.date) : null], ['Method', sample.method], ['Basis', sample.basis]]));
    if (hasCalc && kind !== 'calculation') tech.push(h('h3', { text: 'Calculation' }), calcRows(), h('p', { class: 'small', text: 'Arithmetic derived from the reported values. It is not a finding of the source.' }));
    if (tech.length) main.push(h('details', { class: 'tech' }, h('summary', { text: 'Methodology and technical details' }), h('div', { class: 'tech-body' }, tech)));

    const rel = (full.related || []).map((r) => DB.fById[r]).filter(Boolean);
    if (rel.length) main.push(block('Related findings', h('ul', { class: 'rel' }, rel.map((r) => h('li', null, h('a', { href: '#f/' + r.id, text: r.headline }), h('span', { class: 'meta', text: srcName(DB.srcById[r.source_id] || {}) }))))));
    const more = DB.findings.filter((x) => x.source_id === src.id && x.id !== id).length;
    if (more) main.push(block('More from this source', h('p', null, h('a', { href: '#s/' + src.id, text: 'See all ' + (more + 1) + ' findings from this document' }))));

    /* --- source and verification: a panel that stays beside the finding on wide screens --- */
    const side = h('aside', { class: 'source-panel', 'aria-labelledby': 'srcH' },
      h('h2', { id: 'srcH', text: 'Source and verification' }),
      h('p', { class: 'sp-title' }, h('a', { href: '#s/' + src.id, text: src.title })),
      kv(sourceRows(src, full)),
      originalLinks(src, full.page),
      h('details', { class: 'cite-box' }, h('summary', { text: 'Cite this finding' }), ...citeBlock(src, full)));

    finish(root, h('div', { class: 'detail', lang: lang }, backLink(), h('div', { class: 'f-layout' }, h('article', { class: 'f-main' }, main), side)));
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
          kv(sourceRows(s, null).concat([['Subjects', subjLabels(s.subjects) || null]])),
          originalLinks(s),
          h('details', { class: 'cite-box' }, h('summary', { text: 'Cite this document' }), ...citeBlock(s, null))))));
    if (!items.length) box.appendChild(h('p', { class: 'na', text: 'No published findings have been extracted from this document yet.' }));
    else pagedList(box, items, trow, 'tbl', thead());
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
      dev.textContent = 'Development build — this archive may contain placeholder content that is not real evidence.' + (noIntro ? ' ' + plural(noIntro, 'finding has', 'findings have') + ' no introduction yet.' : '');
      dev.hidden = false;
    }
    window.addEventListener('hashchange', route);
    route();
  }
  init();
})();
