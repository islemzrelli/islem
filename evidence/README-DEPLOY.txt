THE EVIDENCE - deployment (new design + your data and changes)

1. Unzip this file inside your site repo so the folder lands at:  islem/evidence/
   It replaces index.html, evidence.css, evidence.js, transition.js, link.js, the data/ folder,
   and adds a new fonts/ folder inside evidence/ (the two fonts this chapter now uses).
2. Delete any old files left in evidence/data/sources/ that are not in this zip.
3. Commit and push. GitHub Pages updates in about a minute.
4. Open https://islemzrelli.github.io/islem/evidence/ and hard-refresh (Ctrl+Shift+R) once.

Not included (already on your site): the main site's ../fonts/ folder is no longer used by this chapter.
No PDFs are hosted. When you add PDFs, put them in a folder and set the "pdf" path
for that source in data/index.json and data/sources/<id>.json.

WHAT THE PAGE READS FROM YOUR DATA (data/index.json)
- taxonomy.subjects: label, question, intro, start_here (source ids), group (health / environment / accountability)
- taxonomy.evidence_levels: label and definition (shown as badges and in "How to read a finding")
- key_results: headline, figure, unit, plain, not_shown, support (finding ids), subjects, evidence_level
- sources: short_title, authors, doi, peer_reviewed ... ; findings: intro, summary, evidence_level ...
- audit findings: rating, reference, reference_type, also_in, corrective_action are shown on the finding page.
A finding's "status": "draft" is ignored on the live site. It only shows a draft notice if index.json has "dev": true.
