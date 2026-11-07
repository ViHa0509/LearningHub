# Evidence log: learned-list-curation

Built on 2026-11-07 from three owner requests: archive and edit for Learned items, sorting what they learned in Knowledge Hub (KH) into the Learned list (which needed an AI Engineer roadmap), and a visual identity for the app.

## Who did what

| Step | Agent (model) | Result |
|---|---|---|
| Proposal, specs, design, tasks | main session (opus) | `openspec validate --strict` pass |
| Backend 1.1-1.4, roadmap 2.1 | implementer (sonnet) | migration 0005, archive API, counts, agent search; `test_archive.py` 14 tests; six roadmaps |
| Frontend 3.1-3.4 | implementer (sonnet), in parallel against design decision 2 | list menu, rename, move dialog, archive with undo, Archived section, archived banner; 103 Vitest tests |
| Brand assets 4.1 | designer agent (opus) | `frontend/public/brand/`, `Icon.tsx` (21 icons, tested), `docs/brand/index.html` with computed WCAG ratios |
| Apply brand 4.2 | implementer (sonnet; paused for the owner's token reset, then resumed) | tokens in both themes, `#0F0F12` background with particles and glow, logo in the top bar, favicon set, icons; 129 Vitest tests, 44 e2e |
| E2E 5.1 | qc-e2e (sonnet) | new `curation.e2e.ts`; round 1 **44/44 pass**, no product bugs |
| UI QC | qc-ui (sonnet) | pass; 5 minor findings, 4 fixed (below) |
| Verify 5.2 | verifier (sonnet) | **pass**: every check green, no uncovered scenario |

## Dev -> QC -> fix loop

| Round | Result | Product bugs |
|---|---|---|
| qc-e2e 1 | 44 passed | none. Test-only fixes: exact-name locators, because the new "More actions for <title>" trigger also contains the title |
| e2e after the brand | 1 failed, then 44 passed | none. The dark-background assertion moved from `rgb(22, 22, 21)` to `rgb(15, 15, 18)`, as design decision 7 requires |

## qc-ui findings

| Finding | Action |
|---|---|
| Archived rows cramped in the 288 px sidebar | fixed: actions wrap under the title |
| Archived chevron size and alignment | fixed |
| Note toolbar left "Delete" alone on a second row | fixed: the actions wrap as a group |
| Native blue sliders and checkboxes | fixed: `accent-color: var(--accent)` |
| Chat error shown inside the user bubble | not fixed here: older chat UI, outside this change; logged for a later change |

## Verifier checks (final run)

| Check | Result |
|---|---|
| Backend tests | 271 passed |
| Backend lint and format | pass |
| Backend types | pass |
| Frontend tests | 129 passed |
| Frontend lint | pass |
| Frontend build | pass |
| Frontend e2e | 44 passed |

## Data (not code)

24 HTML notes were built from 60 KH items (personal project and smdg2) and imported through the existing import and link APIs into the dev database: 12 under AI Engineer, 9 under Backend, 1 under Frontend, 2 under DevOps. About 750 KH rows were left out on purpose because they are work records, not learning: the SMDG 2.0 architecture workbook chunks, timesheet rules, project status rows.

## Deviations

- `list_roadmap` (an agent tool) also skips archived notes, so its counts agree with the map. The spec did not name this tool.
- The Archive undo line lasts 8 s.
- The design called for a 32 px PNG favicon; the brand designer also added `apple-touch-icon.png` and light variants of the marks.
