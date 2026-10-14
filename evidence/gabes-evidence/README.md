# The Evidence chapter

## What goes on your site (GitHub Pages)
Upload the `evidence/` folder to the repo root, next to `index.html` and `fonts/`.
It uses your existing `fonts/` files (`../fonts/...`) and shares no code with `index.html`.
Add one link in your main page: `<a href="evidence/">The Evidence</a>`.
It will be live at `islemzrelli.github.io/islem/evidence/`.

## What stays private
`evidence-src/` is where you write and review sources. **Do not upload it** — it will hold drafts.
`build-evidence.mjs` reads it and writes only verified content into `evidence/data/`.

## Adding evidence
1. Copy `evidence-src/sources/src-ph-001.json` as a template; one file per source document.
2. Fill it in. Findings start as `"status": "draft"`. Change to `"verified"` only after you
   have checked each one against the original PDF.
3. Run `node build-evidence.mjs` (needs Node 18+). It checks the files and refuses to publish
   mistakes (e.g. comparing values with different units, or a calculation without its method).
4. Upload the updated `evidence/data/` folder.

## Placeholders
The five `src-ph-*` files are fake test content. `node build-evidence.mjs --dev` includes them
(the page then shows a "development build" banner). A normal build skips them. Delete them
once you have real sources, then run a normal build and re-upload `evidence/data/`.
