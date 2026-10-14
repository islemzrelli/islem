#!/usr/bin/env node
/* Validates the source files in --src and writes the PUBLIC data into --out.
   Only sources and findings with status "verified" are published. Drafts never leave --src.
   Placeholder sources ("placeholder": true) are skipped unless --dev is passed.

   node build-evidence.mjs                      -> evidence-src/  ->  evidence/data/
   node build-evidence.mjs --dev                -> includes placeholder content
   node build-evidence.mjs --src X --out Y      -> custom folders                          */
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i > -1 ? args[i + 1] : d; };
const DEV = args.includes('--dev');
const SRC = path.resolve(opt('src', 'evidence-src'));
const OUT = path.resolve(opt('out', 'evidence/data'));

const TAXONOMY = {
  subjects: [
    { id: 'air', label: 'Air' }, { id: 'water', label: 'Water' },
    { id: 'sea-sediment', label: 'Sea and sediment' }, { id: 'groundwater', label: 'Groundwater' },
    { id: 'law', label: 'Law and standards' }, { id: 'audits', label: 'Audits and reports' },
    { id: 'other', label: 'Other research' }
  ],
  types: [
    { id: 'scientific-study', label: 'Scientific study' }, { id: 'lab-analysis', label: 'Laboratory analysis' },
    { id: 'audit', label: 'Institutional audit' }, { id: 'official-report', label: 'Official report' },
    { id: 'legislation', label: 'Legislation' }, { id: 'technical-report', label: 'Technical report' },
    { id: 'other', label: 'Other' }
  ]
};
const KINDS = ['stated', 'summary', 'calculation', 'interpretation', 'allegation'];
const STATUSES = ['draft', 'verified'];
const ID = /^[A-Za-z0-9_-]+$/;
const okUrl = (u) => /^https?:\/\//i.test(u) || (/^[\w./-]+$/.test(u) && u[0] !== '/' && !u.includes('..'));
const isNum = (v) => v !== '' && v != null && !isNaN(Number(v));

const errors = [], warnings = [];
const err = (w, m) => errors.push(`${w}: ${m}`);
const warn = (w, m) => warnings.push(`${w}: ${m}`);

const strip = (o) => Array.isArray(o) ? o.map(strip)
  : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([k]) => k[0] !== '_').map(([k, v]) => [k, strip(v)]))
  : o;
const trim = (s, n = 220) => !s || s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…';
const yearOf = (p) => { const m = /^(\d{4})/.exec(p || ''); return m ? Number(m[1]) : null; };

let files = [];
try { files = (await readdir(path.join(SRC, 'sources'))).filter((f) => f.endsWith('.json')).sort(); }
catch { console.error(`Cannot read ${path.join(SRC, 'sources')}`); process.exit(1); }

let taxonomy = TAXONOMY;
try { taxonomy = JSON.parse(await readFile(path.join(SRC, 'taxonomy.json'), 'utf8')); } catch { /* default */ }
const subj = new Set(taxonomy.subjects.map((s) => s.id)), types = new Set(taxonomy.types.map((t) => t.id));

const sources = [];
let skipped = { placeholder: 0, draft: 0 }, draftFindings = 0;
for (const file of files) {
  let s;
  try { s = JSON.parse(await readFile(path.join(SRC, 'sources', file), 'utf8')); }
  catch (e) { err(file, 'invalid JSON — ' + e.message); continue; }
  if (s.placeholder && !DEV) { skipped.placeholder++; continue; }
  if (s.status !== 'verified') { skipped.draft++; continue; }
  const w = `${file}`;
  if (!s.id || !ID.test(s.id)) err(w, 'source "id" missing or contains characters other than letters, digits, - and _');
  if (!s.title) err(w, 'source "title" is required');
  if (!types.has(s.type)) err(w, `unknown source type "${s.type}"`);
  (s.subjects || []).forEach((x) => { if (!subj.has(x)) err(w, `unknown subject "${x}"`); });
  if (!s.subjects || !s.subjects.length) err(w, 'at least one subject is required');
  if (!s.published) warn(w, 'no publication date (will be shown as "Not reported")');
  for (const k of ['url', 'pdf']) if (s[k] && !okUrl(s[k])) err(w, `"${k}" must be an http(s) URL or a relative path`);
  if (!s.url && !s.pdf) warn(w, 'no url or pdf (the page will say the original is not linked)');
  sources.push({ s, file });
}

const seen = new Set();
sources.forEach(({ s }) => { if (seen.has(s.id)) err(s.id, 'duplicate source id'); seen.add(s.id); });
const published = [];
const fIds = new Set();
for (const { s } of sources) {
  const list = [];
  for (const f of s.findings || []) {
    const w = f.id || `${s.id} (finding without id)`;
    if (!STATUSES.includes(f.status)) err(w, `status must be one of ${STATUSES.join(', ')}`);
    if (f.status !== 'verified') { draftFindings++; continue; }
    if (!f.id || !ID.test(f.id)) err(w, 'finding "id" missing or invalid');
    if (fIds.has(f.id)) err(w, 'duplicate finding id'); fIds.add(f.id);
    if (!f.headline) err(w, '"headline" is required');
    if (!f.summary && !f.quote) err(w, 'provide a "summary" or a "quote"');
    if (!KINDS.includes(f.kind)) err(w, `"kind" must be one of ${KINDS.join(', ')}`);
    if (!f.locator) warn(w, 'no "locator" (page, table or section) — traceability is weaker');
    (f.subjects || []).forEach((x) => { if (!subj.has(x)) err(w, `unknown subject "${x}"`); });
    if (f.value != null && !f.unit) err(w, '"value" needs a "unit" (use "none" if it is dimensionless)');
    if (f.kind === 'calculation' && !(f.calculation && f.calculation.method)) err(w, 'a calculation needs "calculation.method" (plus inputs and result)');
    if (f.standard) {
      const st = f.standard;
      if (!st.source_id && !st.source_label) warn(w, 'standard has no "source_id" or "source_label"');
      if (st.comparable === true) {
        if (!isNum(f.value) || !isNum(st.limit)) err(w, 'comparable=true needs numeric "value" and "standard.limit"');
        if (f.unit !== st.unit) err(w, `comparable=true but units differ ("${f.unit}" vs "${st.unit}")`);
        if (!(f.sample && f.sample.basis) || !st.basis) err(w, 'comparable=true needs "sample.basis" and "standard.basis" (e.g. averaging period)');
        if (!st.comparable_note) err(w, 'comparable=true needs a "comparable_note" explaining why the comparison is valid');
      } else if (st.comparable == null) warn(w, 'standard.comparable not set — shown without a comparison');
    }
    list.push(f);
  }
  published.push({ s, list });
}
const sourceIds = new Set(published.map((p) => p.s.id));
for (const { list } of published) for (const f of list) {
  (f.related || []).forEach((r) => { if (!fIds.has(r)) err(f.id, `related finding "${r}" is not published`); });
  if (f.standard && f.standard.source_id && !sourceIds.has(f.standard.source_id)) err(f.id, `standard.source_id "${f.standard.source_id}" is not a published source`);
}

if (errors.length) {
  console.error(`\n${errors.length} error(s) — nothing was written:\n` + errors.map((e) => '  ✗ ' + e).join('\n'));
  if (warnings.length) console.error(`\n${warnings.length} warning(s):\n` + warnings.map((e) => '  ! ' + e).join('\n'));
  process.exit(1);
}

const index = {
  generated: new Date().toISOString().slice(0, 10),
  dev: DEV && published.some((p) => p.s.placeholder),
  taxonomy,
  sources: published.map(({ s }) => ({
    id: s.id, title: s.title, institution: s.institution || null, type: s.type, subjects: s.subjects,
    published: s.published || null, document_date: s.document_date || null, year: yearOf(s.published),
    report_number: s.report_number || null, keywords: s.keywords || [], summary: s.summary || null,
    url: s.url || null, pdf: s.pdf || null, placeholder: !!s.placeholder
  })),
  findings: published.flatMap(({ s, list }) => list.map((f) => ({
    id: f.id, source_id: s.id, headline: f.headline, summary: trim(f.summary), kind: f.kind,
    value: f.value ?? null, unit: f.unit ?? null, pollutant: f.pollutant || null,
    subjects: f.subjects || null, keywords: f.keywords || [], locator: f.locator || null,
    featured: !!f.featured, placeholder: !!s.placeholder
  })))
};

await rm(path.join(OUT, 'sources'), { recursive: true, force: true });
await mkdir(path.join(OUT, 'sources'), { recursive: true });
await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index));
for (const { s, list } of published) {
  await writeFile(path.join(OUT, 'sources', s.id + '.json'), JSON.stringify(strip({ ...s, year: yearOf(s.published), findings: list })));
}
console.log(`Published ${index.sources.length} sources and ${index.findings.length} findings to ${OUT}`);
console.log(`Skipped: ${skipped.draft} draft source(s), ${draftFindings} draft finding(s)` + (skipped.placeholder ? `, ${skipped.placeholder} placeholder source(s) (use --dev to include)` : ''));
if (warnings.length) console.log(`\n${warnings.length} warning(s):\n` + warnings.map((e) => '  ! ' + e).join('\n'));
