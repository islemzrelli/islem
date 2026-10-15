# Adding findings to The Evidence

Each finding lives in `data/sources/<source-id>.json` (full record) and in `data/index.json` (the short copy used for search and lists). Keep the two in step.

## The fields readers see, in order
| Field | What to write |
|---|---|
| `headline` | A sentence saying what was found. Not just a chemical name or a number. |
| `summary` | One sentence for result lists. |
| `intro` | 2–4 plain sentences: what the source examined, what it found, why it matters for Gabès. **Optional field, but every finding should have one.** Never just restate the number. If the source can't establish significance, say what it establishes and what stays uncertain. |
| `value`, `unit`, `pollutant`, `sample{type,location,date,basis,method}` | The key result and its context. Leave out what the source doesn't give. It shows as "Not reported". |
| `quote` | The source's own words (best for audits and legal texts). |
| `explanation` | "What does this mean?" in plain language. This is marked as written by the archive, not the source. |
| `standard{...}` | Only when a real standard applies. Set `comparable: true` only if unit, averaging period and sampling basis match, and explain why in `comparable_note`. |
| `limitations` | What the result does not show. |
| `locator`, `page` | Exact table, section or page. `page` makes "Read original PDF (page N)" jump to it. |
| `kind` | `stated`, `summary`, `calculation`, `interpretation` or `allegation`. |

Never invent concentrations, limits, health effects, causes or claims about who is responsible.
A source record without `url` or `pdf` shows a "not linked yet" warning on its findings.
`status` other than `verified` / `published` shows a draft warning on the finding page.
In a development build (`"dev": true` in index.json) the banner reports how many findings still lack an `intro`.
