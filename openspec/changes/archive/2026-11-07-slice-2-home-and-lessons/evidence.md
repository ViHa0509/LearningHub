# Evidence log: slice-2-home-and-lessons

Built 2026-11-07 by Claude Code (autonomous, after the owner's review of Slice 1), with `ai-sdlc-kit` 0.2.0 agents. Who did what is logged in `.sdlc/log.md`.

## Owner feedback -> where it landed

| Feedback (2026-11-07) | Result |
|---|---|
| Light or dark UI | Top-bar switch System / Light / Dark, remembered per browser (`learning-views`: Light and dark theme) |
| Home page like roadmap.sh with role cards and short descriptions | `home-page` spec; five hand-written roadmaps (Frontend, Backend, DevOps, QA, Data Engineer) with descriptions and progress |
| Clicking any node opens a lesson detail page, empty if nothing yet | `lesson-pages` spec; editable Markdown lesson per node; agent drafting follows in slice 3 |
| Learned list: no Open button, click opens the note | `learning-views`: Read a note (modified) |

## Checks

All seven CLAUDE.md checks green in the verifier run (backend 101 tests, ruff, mypy, Vitest 47 tests, oxlint, build, Playwright e2e 6 tests).

## Problems found and fixed

| What went wrong | Caught by | Fix |
|---|---|---|
| Domain `order` from YAML was overwritten by the node loop's `order` variable, so domains came out in file order | `test_shipped_roadmaps_load_in_explicit_order` | Renamed to `domain_order` |
| YAML description `Server-side code: APIs, ...` broke parsing (colon in plain scalar) | App startup in the test run (invalid roadmap stops startup) | Dash instead of colon |
| Fake API used `match` before its `let` declaration, every roadmap request failed in tests | Vitest ("Could not load the roadmap") | Separate `lesson` match variable |
| Markdown `##` headings inside a lesson took the uppercase section-label style | Main session reading the e2e screenshot `lesson-written.png` | Section style scoped to `.lesson-section > h2`; own `.markdown h1-h3` styles |
| White-on-light-blue text in dark mode (selected tabs, primary buttons) | Contrast review while writing tokens | `--on-accent` token per theme |
| React Flow zoom controls white in dark mode | qc-ui agent (minor) | Map React Flow `--xy-*` variables to app tokens; controls moved bottom-right |
| Map node labels about 6 px at the default fit zoom | qc-ui agent (minor) | Start at zoom 0.9 top-left with scroll-to-pan instead of `fitView` |
| Learned list blank while roadmaps load | qc-ui agent (minor) | "Loading your notes..." placeholder |

Kept as polish (qc-ui minor, not fixed): per-role icon or color on cards; mixed underline style of links.

## UI QC report (qc-ui, sonnet)

```
## UI QC report: pass
| e2e: cd frontend && npm run e2e | pass | exit 0, 5 of 5 tests passed in 31.5s |
| Screenshots inspected | 9 of 9 | home-light, home-dark, lesson-empty, lesson-written, lesson-dark, lesson-not-found, note-open, roadmap-backend, roadmap-dark |
Findings: 5 minor (see table above)
```

## Verifier report (verifier, sonnet)

Verdict: **pass**. All tasks 1.1-5.1 have evidence; uncovered scenarios: none.
Note from the verifier: home-page progress is unit-tested with the fake API's small roadmaps (2 of 2, 0 of 4); the e2e suite checks the real counts (`0 / 25 topics`, then `1 / 25` after an import).
