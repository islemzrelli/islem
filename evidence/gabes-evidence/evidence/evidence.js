/* The Evidence — search, filters, hash routing and rendering.
   Data: data/index.json (search index) + data/sources/<id>.json (full records, loaded on demand).
   All text is inserted with textContent, never innerHTML. */
(function () {
  'use strict';

  const DATA = 'data/';
  const PAGE = 20;
  const KINDS = {
    stated: 'Stated in the source',
    summary: 'Summary of the source',
    calculation: 'Calculated from source data',
    interpretation: 'Interpretation',
    allegation: 'Allegation — unresolved'
  };
  const state = { q: '', subject: [], type: '', year: '', view: 'findings', shown: PAGE };
  const srcCache = {};
  let DB = null;
  let token = 0;
  let saved = null;
  let lastList = '#';
  let onList = false;

  const $ = (id) => document.getElementById(id);
  const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

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

  /* ---------- labels and formatting ---------- */
  const lab = (list, id) => { const x = list.find((t) => t.id === id); return x ? x.label : id; };
  const subjLabels = (ids) => (ids || []).map((s) => lab(DB.taxonomy.subjects, s)).join(', ');
  const typeLabel = (id) => lab(DB.taxonomy.types, id);
  function fmtDate(s) {
    if (!s) return null;
    const o = { timeZone: 'UTC', year: 'numeric' };
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { ...o, day: 'numeric', month: 'long' });
    if (/^\d{4}-\d{2}$/.test(s)) return new Date(s + '-01T00:00:00Z').toLocaleDateString('en-GB', { ...o, month: 'long' });
    return s;
  }
  const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
  const valueText = (f) => (f.value == null ? null : String(f.value));

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
      s._b = fold([s.title, s.institution, s.summary, s.keywords.join(' '), typeLabel(s.type), subjLabels(s.subjects), s.year, s.report_number].join(' '));
      s._h = fold(s.title + ' ' + (s.institution || ''));
      DB.srcById[s.id] = s;
    });
    DB.findings.forEach((f) => {
      const s = DB.srcById[f.source_id] || {};
      if (!f.subjects || !f.subjects.length) f.subjects = s.subjects || [];
      f.type = s.type; f.year = s.year; f.placeholder = !!(f.placeholder || s.placeholder);
      f._b = fold([f.headline, f.summary, f.pollutant, f.value, f.unit, f.locator, (f.keywords || []).join(' '), typeLabel(f.type), subjLabels(f.subjects), s.title, s.institution, s.year].join(' '));
      f._h = fold(f.headline + ' ' + (f.pollutant || ''));
      DB.fById[f.id] = f;
    });
    DB.years = [...new Set(DB.sources.map((s) => s.year).filter(Boolean))].sort((a, b) => b - a);
  }

  /* ---------- search ---------- */
  function parseQuery(q) {
    const toks = []; const re = /"([^"]+)"|(\S+)/g; let m;
    while ((m = re.exec(q))) { const t = fold(m[1] || m[2]).trim(); if (t) toks.push(t); }
    return toks;
  }
  function run(list) {
    const toks = parseQuery(state.q);
    const out = [];
    for (const it of list) {
      if (state.subject.length && !it.subjects.some((s) => state.subject.includes(s))) continue;
      if (state.type && it.type !== state.type) continue;
      if (state.year && String(it.year) !== state.year) continue;
      let score = 0, ok = true;
      for (const t of toks) {
        if (!it._b.includes(t)) { ok = false; break; }
        score += it._h.includes(t) ? 3 : 1;
      }
      if (ok) out.push({ it, score });
    }
    out.sort((a, b) => b.score - a.score || (b.it.year || 0) - (a.it.year || 0) || (a.it.id < b.it.id ? -1 : 1));
    return out.map((x) => x.it);
  }
  const isActive = () => !!(state.q || state.subject.length || state.type || state.year);

  /* ---------- routing ---------- */
  function parseHash() {
    const hash = location.hash.slice(1);
    let m;
    if ((m = /^f\/([\w-]+)$/.exec(hash))) return { name: 'finding', id: m[1] };
    if ((m = /^s\/([\w-]+)$/.exec(hash))) return { name: 'source', id: m[1] };
    return { name: 'list', p: new URLSearchParams(hash.startsWith('?') ? hash.slice(1) : '') };
  }
  function applyParams(p) {
    state.q = p.get('q') || '';
    state.subject = (p.get('subject') || '').split(',').filter((s) => DB.taxonomy.subjects.some((t) => t.id === s));
    state.type = p.get('type') || '';
    state.year = p.get('year') || '';
    state.view = p.get('view') === 'sources' ? 'sources' : 'findings';
    state.shown = PAGE;
  }
  function writeUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.subject.length) p.set('subject', state.subject.join(','));
    if (state.type) p.set('type', state.type);
    if (state.year) p.set('year', state.year);
    if (state.view !== 'findings') p.set('view', state.view);
    const s = p.toString();
    history.replaceState(null, '', location.pathname + location.search + (s ? '#?' + s : ''));
    lastList = s ? '#?' + s : '#';
  }
  function rememberScroll() { if (onList) saved = { y: window.scrollY, shown: state.shown }; }

  function route() {
    const r = parseHash();
    token++;
    if (r.name === 'finding') return showFinding(r.id);
    if (r.name === 'source') return showSource(r.id);
    applyParams(r.p);
    lastList = location.hash || '#';
    if (saved) state.shown = Math.max(state.shown, saved.shown);
    enter('list');
    syncControls();
    renderList();
    if (saved) { window.scrollTo(0, saved.y); saved = null; } else window.scrollTo(0, 0);
  }
  function enter(which) {
    onList = which === 'list';
    $('listView').hidden = !onList;
    $('detailView').hidden = onList;
    if (!onList) window.scrollTo(0, 0);
    document.title = onList ? 'The Evidence — Stories from Gabès' : document.title;
  }

  /* ---------- controls ---------- */
  function buildControls() {
    const chips = $('subjects');
    DB.taxonomy.subjects.forEach((s) => chips.appendChild(h('button', { type: 'button', class: 'chip', 'data-s': s.id, 'aria-pressed': 'false', text: s.label })));
    const type = $('type');
    type.appendChild(h('option', { value: '', text: 'All source types' }));
    DB.taxonomy.types.forEach((t) => type.appendChild(h('option', { value: t.id, text: t.label })));
    const year = $('year');
    year.appendChild(h('option', { value: '', text: 'All years' }));
    DB.years.forEach((y) => year.appendChild(h('option', { value: String(y), text: String(y) })));

    let timer;
    $('q').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.q = e.target.value.trim(); changed(); }, 120);
    });
    chips.addEventListener('click', (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      const id = b.getAttribute('data-s');
      state.subject = state.subject.includes(id) ? state.subject.filter((s) => s !== id) : state.subject.concat(id);
      changed();
    });
    type.addEventListener('change', () => { state.type = type.value; changed(); });
    year.addEventListener('change', () => { state.year = year.value; changed(); });
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { state.view = t.getAttribute('data-view'); changed(); }));
  }
  function changed() { state.shown = PAGE; writeUrl(); syncControls(); renderList(); }
  function syncControls() {
    if (document.activeElement !== $('q')) $('q').value = state.q;
    document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(state.subject.includes(c.getAttribute('data-s')))));
    $('type').value = state.type; $('year').value = state.year;
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-pressed', String(t.getAttribute('data-view') === state.view)));
  }
  function clearAll() { state.q = ''; state.subject = []; state.type = ''; state.year = ''; $('q').value = ''; changed(); }

  /* ---------- list rendering ---------- */
  const phBadge = () => h('span', { class: 'ph', text: 'Placeholder — not real data' });

  function findingRow(f) {
    const s = DB.srcById[f.source_id] || {};
    const v = valueText(f);
    return h('article', { class: 'row' },
      h('div', { class: 'row-meta' }, h('span', { text: subjLabels(f.subjects) }), h('span', { text: typeLabel(f.type) }), h('span', { text: f.year || 'n.d.' })),
      h('div', null,
        h('h3', null, h('a', { class: 'stretch', href: '#f/' + f.id, onclick: rememberScroll, text: f.headline })),
        f.summary ? h('p', { class: 'row-sum', text: f.summary }) : null,
        h('p', { class: 'srcline', text: (f.locator ? f.locator + ' — ' : '') + (s.title || f.source_id) }),
        h('div', null, h('span', { class: 'tag', text: KINDS[f.kind] || KINDS.stated }), f.placeholder ? phBadge() : null)),
      v ? h('div', { class: 'row-val' }, h('span', { class: 'v', text: v }), h('span', { class: 'u', text: f.unit || '' })) : h('div'));
  }
  function sourceRow(s) {
    const n = DB.findings.filter((f) => f.source_id === s.id).length;
    return h('article', { class: 'row' },
      h('div', { class: 'row-meta' }, h('span', { text: typeLabel(s.type) }), h('span', { text: s.year || 'n.d.' })),
      h('div', null,
        h('h3', null, h('a', { class: 'stretch', href: '#s/' + s.id, onclick: rememberScroll, text: s.title })),
        h('p', { class: 'srcline', text: [s.institution, fmtDate(s.published)].filter(Boolean).join(' · ') }),
        s.summary ? h('p', { class: 'row-sum', text: s.summary }) : null,
        s.placeholder ? phBadge() : null),
      h('div', { class: 'row-val' }, h('span', { class: 'u', text: n + (n === 1 ? ' finding' : ' findings') })));
  }
  function featEl(f) {
    const s = DB.srcById[f.source_id] || {};
    const v = valueText(f);
    return h('article', { class: 'feat' + (v ? ' hasnum' : '') },
      v ? h('p', { class: 'n-wrap' }, h('span', { class: 'n', text: v }), h('span', { class: 'u', text: f.unit || '' })) : null,
      h('div', null,
        h('p', { class: 'tagline', text: [subjLabels(f.subjects), typeLabel(f.type), f.year].filter(Boolean).join(' · ') }),
        h('h3', null, h('a', { class: 'stretch', href: '#f/' + f.id, onclick: rememberScroll, text: f.headline })),
        f.summary ? h('p', { text: f.summary }) : null,
        h('p', { class: 'srcline', text: [s.institution, s.title, f.locator, fmtDate(s.published)].filter(Boolean).join(' — ') }),
        f.placeholder ? phBadge() : null));
  }
  function paged(box, items, build, getShown, setShown) {
    const list = h('div', { class: 'rows' });
    const more = h('div');
    box.append(list, more);
    let n = 0;
    const draw = () => {
      const upto = Math.min(getShown(), items.length);
      for (; n < upto; n++) list.appendChild(build(items[n]));
      more.replaceChildren();
      if (n < items.length) {
        more.className = 'more';
        more.append(h('span', { class: 'count', text: 'Showing ' + n + ' of ' + items.length }),
          h('button', { type: 'button', class: 'btn', text: 'Show ' + Math.min(PAGE, items.length - n) + ' more', onclick: () => { setShown(n + PAGE); draw(); } }));
      } else more.className = '';
    };
    draw();
  }
  function emptyState() {
    const what = state.view === 'findings' ? 'findings' : 'sources';
    return h('div', { class: 'state' },
      h('h2', { text: 'No ' + what + ' match your search.' }),
      h('p', { text: 'Try fewer words, a different spelling, or a chemical name on its own. Filters combine, so removing one may help.' }),
      h('button', { type: 'button', class: 'btn', text: 'Clear search and filters', onclick: clearAll }));
  }
  function renderList() {
    const F = run(DB.findings), S = run(DB.sources);
    $('tabFindings').textContent = 'Findings (' + F.length + ')';
    $('tabSources').textContent = 'Source library (' + S.length + ')';
    const feat = DB.findings.filter((f) => f.featured).slice(0, 4);
    $('featuredWrap').hidden = isActive() || state.view !== 'findings' || !feat.length;
    $('featured').replaceChildren(...feat.map(featEl));
    const items = state.view === 'findings' ? F : S;
    const count = $('count');
    count.replaceChildren(items.length + (state.view === 'findings' ? (items.length === 1 ? ' finding' : ' findings') : (items.length === 1 ? ' source' : ' sources')));
    if (isActive()) count.appendChild(h('button', { type: 'button', class: 'linkbtn', text: 'Clear search and filters', onclick: clearAll }));
    const box = $('results');
    box.replaceChildren();
    if (!items.length) { box.appendChild(emptyState()); return; }
    paged(box, items, state.view === 'findings' ? findingRow : sourceRow, () => state.shown, (n) => { state.shown = n; });
  }

  /* ---------- detail helpers ---------- */
  const backLink = () => h('a', { class: 'back-link', href: lastList, text: '← Back to results' });
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
    return h('div', { class: 'state' }, h('h2', { text: 'This ' + what + ' could not be found.' }),
      h('p', { text: 'It may have been renamed, or it has not been published.' }), backLink());
  }
  function openLinks(src, page) {
    const links = [];
    const url = safeUrl(src.url), pdf = safeUrl(src.pdf);
    if (url) links.push(h('a', { href: url, target: '_blank', rel: 'noopener', text: 'Open original document ↗' }));
    if (pdf) links.push(h('a', { href: pdf + (page ? '#page=' + page : ''), target: '_blank', rel: 'noopener', text: 'Open PDF' + (page ? ' at page ' + page : '') + ' ↗' }));
    return links.length ? h('div', { class: 'links' }, links) : h('p', { class: 'na', text: 'The original document is not linked yet.' });
  }
  function finish(root, ...kids) {
    root.replaceChildren(...kids);
    const t = $('dh'); if (t) t.focus({ preventScroll: true });
  }
  function barRow(label, value, unit, share, cls) {
    const fill = h('div', { class: 'fill ' + cls });
    fill.style.width = Math.max(share * 100, 0.8) + '%';
    return h('div', { class: 'bar' }, h('div', { class: 'bar-top' }, h('span', { text: label }), h('b', { text: value + ' ' + unit })), h('div', { class: 'track' }, fill));
  }
  function comparison(full, src) {
    const st = full.standard, sample = full.sample || {};
    const stSrc = st.source_id && DB.srcById[st.source_id];
    const v = num(full.value), l = num(st.limit);
    const comparable = st.comparable === true && v != null && l != null && full.unit === st.unit;
    const kids = [kv([
      ['Measured value', valueText(full) ? valueText(full) + ' ' + (full.unit || '') : null],
      ['Measurement basis', sample.basis],
      ['Standard', st.name],
      ['Standard value', st.limit != null ? st.limit + ' ' + (st.unit || '') : null],
      ['Standard basis', st.basis],
      ['Standard source', stSrc ? h('a', { href: '#s/' + stSrc.id, text: stSrc.title + (st.locator ? ', ' + st.locator : '') }) : (st.source_label || null)]
    ])];
    if (comparable) {
      const max = Math.max(v, l);
      const label = 'Measured value compared with ' + st.name + ': ' + v + ' and ' + l + ' ' + full.unit;
      kids.push(h('figure', { class: 'bars', role: 'img', 'aria-label': label },
        barRow('Measured value', v, full.unit, v / max, ''),
        barRow(st.name || 'Standard', l, full.unit, l / max, 'lim'),
        h('figcaption', { text: 'Bars start at zero · ' + full.unit + ' · Source: ' + (src.title || '') + (full.locator ? ', ' + full.locator : '') + (sample.date ? ' · Sampled ' + fmtDate(sample.date) : '') })));
      kids.push(h('p', { class: 'small', text: 'Why these are compared: ' + st.comparable_note }));
    } else {
      kids.push(h('p', { class: 'small', text: 'Shown side by side without a calculated comparison. The measurement and the standard may not use the same basis (units, averaging period or sampling method), so check the source before comparing them.' }));
    }
    return { el: block('Comparison standard', kids), ratio: comparable ? v / l : null };
  }
  const ratioText = (r) => (r >= 10 ? String(Math.round(r)) : r.toPrecision(2));
  function citation(src, full) {
    return [src.institution, src.title + (src.published ? ' (' + src.published + ')' : ''), full && full.locator, safeUrl(src.url) || safeUrl(src.pdf)].filter(Boolean).join('. ');
  }
  function citeBlock(src, full) {
    const text = citation(src, full);
    const btn = h('button', { type: 'button', class: 'btn', text: 'Copy citation' });
    btn.addEventListener('click', () => {
      const done = (m) => { btn.textContent = m; setTimeout(() => { btn.textContent = 'Copy citation'; }, 1800); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => done('Copied'), () => done('Select the text above'));
      else done('Select the text above');
    });
    return [h('p', { class: 'cite', text: text }), btn];
  }

  /* ---------- finding detail ---------- */
  async function showFinding(id) {
    const my = ++token;
    const root = $('detail');
    enter('detail');
    const f = DB.fById[id];
    if (!f) { document.title = 'Not found — The Evidence'; finish(root, notFound('finding')); return; }
    document.title = f.headline + ' — The Evidence';
    root.replaceChildren(backLink(), h('p', { class: 'state', text: 'Loading the full record…' }));
    let src;
    try { src = await getSource(f.source_id); } catch (e) { if (my === token) finish(root, backLink(), errorBox(() => showFinding(id))); return; }
    if (my !== token) return;
    const full = (src.findings || []).find((x) => x.id === id) || f;
    const ph = !!(src.placeholder || full.placeholder);
    const sample = full.sample;
    const hasMeasure = full.value != null || sample;
    const parts = [backLink(),
      h('header', { class: 'd-head' },
        h('p', { class: 'kicker', text: [subjLabels(f.subjects), typeLabel(f.type)].filter(Boolean).join(' · ') }),
        h('h1', { id: 'dh', tabindex: '-1', text: full.headline }),
        h('div', null, h('span', { class: 'tag', text: KINDS[full.kind] || KINDS.stated }), ph ? phBadge() : null)),
      full.value != null ? h('p', { class: 'd-big' }, h('span', { class: 'n', text: String(full.value) }), h('span', { class: 'u', text: full.unit || '' })) : null];

    if (full.summary || full.quote) {
      parts.push(block('What the source says',
        full.summary ? h('p', { text: full.summary }) : null,
        full.quote ? h('blockquote', null, full.quote, h('cite', { text: [src.institution, full.locator].filter(Boolean).join(' — ') })) : null));
    }
    if (full.explanation) parts.push(block('In plain English', h('p', { text: full.explanation }), h('p', { class: 'small', text: 'This explanation is an interpretation added for readability. It is not a statement from the source.' })));
    if (hasMeasure) {
      parts.push(block('Measurement details', kv([
        ['Pollutant or subject', full.pollutant],
        ['Sample type', sample && sample.type],
        ['Location', sample && sample.location],
        ['Sampling date', sample && sample.date ? fmtDate(sample.date) : null],
        ['Method', sample && sample.method]
      ])));
    }
    let ratio = null;
    if (full.standard) { const c = comparison(full, src); parts.push(c.el); ratio = c.ratio; }
    if (full.calculation || ratio != null) {
      const c = full.calculation || {};
      const rows = [['Method', c.method], ['Inputs', c.inputs], ['Result', c.result]];
      if (ratio != null) rows.push(['Ratio to standard', valueText(full) + ' ÷ ' + full.standard.limit + ' = ' + ratioText(ratio)]);
      parts.push(block('Calculation', kv(rows), h('p', { class: 'small', text: 'Arithmetic derived from the reported values above. It is not a finding of the source.' })));
    }
    if (full.limitations) parts.push(block('Context and limitations', h('p', { text: full.limitations })));
    parts.push(block('Original source',
      h('p', null, h('a', { href: '#s/' + src.id, text: src.title })),
      kv([['Institution', src.institution], ['Published', fmtDate(src.published)], ['Location in document', full.locator], ['Report number', src.report_number]]),
      openLinks(src, full.page), citeBlock(src, full)));
    const rel = (full.related || []).map((r) => DB.fById[r]).filter(Boolean);
    if (rel.length) parts.push(block('Related findings', h('ul', { class: 'rel' }, rel.map((r) => h('li', null, h('a', { href: '#f/' + r.id, text: r.headline }), h('div', { class: 'srcline', text: (DB.srcById[r.source_id] || {}).title || '' }))))));
    const more = DB.findings.filter((x) => x.source_id === src.id && x.id !== id).length;
    if (more) parts.push(block('More from this source', h('p', null, h('a', { href: '#s/' + src.id, text: 'See all ' + (more + 1) + ' findings from this document' }))));
    finish(root, ...parts);
  }

  /* ---------- source detail ---------- */
  function showSource(id) {
    const root = $('detail');
    enter('detail');
    const s = DB.srcById[id];
    if (!s) { document.title = 'Not found — The Evidence'; finish(root, notFound('source')); return; }
    document.title = s.title + ' — The Evidence';
    const items = DB.findings.filter((f) => f.source_id === id);
    let shown = PAGE;
    const box = h('div');
    root.replaceChildren();
    finish(root, backLink(),
      h('header', { class: 'd-head' },
        h('p', { class: 'kicker', text: [typeLabel(s.type), subjLabels(s.subjects)].filter(Boolean).join(' · ') }),
        h('h1', { id: 'dh', tabindex: '-1', text: s.title }),
        s.placeholder ? phBadge() : null),
      block('About this document',
        s.summary ? h('p', { text: s.summary }) : null,
        kv([['Institution', s.institution], ['Published', fmtDate(s.published)], ['Document date', fmtDate(s.document_date)], ['Report number', s.report_number], ['Subjects', subjLabels(s.subjects) || null]]),
        openLinks(s), citeBlock(s, null)),
      block('Findings from this document (' + items.length + ')', box));
    if (!items.length) box.appendChild(h('p', { class: 'na', text: 'No published findings have been extracted from this document yet.' }));
    else paged(box, items, findingRow, () => shown, (n) => { shown = n; });
  }

  /* ---------- start ---------- */
  async function init() {
    const st = $('status');
    st.replaceChildren(h('p', { class: 'state', text: 'Loading the archive…' }));
    try { DB = await getJSON(DATA + 'index.json'); }
    catch (e) { st.replaceChildren(h('div', { class: 'state' }, h('h2', { text: 'The archive could not be loaded.' }), h('p', { text: 'Check your connection and try again.' }), h('button', { type: 'button', class: 'btn', text: 'Try again', onclick: init }))); return; }
    prepare();
    buildControls();
    st.replaceChildren();
    $('app').hidden = false;
    $('devbanner').hidden = !DB.dev;
    $('stats').textContent = DB.findings.length + ' findings from ' + DB.sources.length + ' sources' + (DB.generated ? ' · Updated ' + fmtDate(DB.generated) : '');
    window.addEventListener('hashchange', route);
    route();
  }
  init();
})();
