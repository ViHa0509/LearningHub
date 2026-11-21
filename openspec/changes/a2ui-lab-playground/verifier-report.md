# Verifier report: a2ui-lab-playground

Verdict: **pass** (verifier subagent, 2026-11-22, second run after the fixes for the first run's two fail reasons)

## Checks

| Command | Exit | Result |
|---|---|---|
| `cd backend && .venv/Scripts/python -m pytest` | 0 | pass (first run; `git diff HEAD -- backend` is empty) |
| `cd backend && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .` | 0 | pass (`All checks passed!`, `182 files already formatted`) |
| `cd backend && .venv/Scripts/mypy app` | 0 | pass (`no issues found in 89 source files`) |
| `cd frontend && npm test` | 0 | pass (46 files, 612 tests) |
| `cd frontend && npm run lint` | 0 | pass |
| `cd frontend && npm run build` | 0 | pass. The A2UI code is in its own lazy chunk `A2uiLabPage-*.js` (503 kB), not in `index-*.js`. |
| `cd frontend && npm run e2e` | 0 | pass, as run by qc-e2e: 324 passed, 0 failed, 33 skipped (15.8 min), stamped at tree `b71854164c` |
| `openspec validate a2ui-lab-playground --strict` | 0 | pass |

`npm ls dompurify` shows `dompurify@3.4.18 overridden`.

## Task evidence

| Task | Evidence |
|---|---|
| 1.1 | `package.json` pins `@a2ui/react` and `@a2ui/web_core` at 0.15.0 and `zod` at 3.25.76, with `overrides.dompurify` 3.4.18 |
| 1.2 | design.md Decision 6 has the spike result and the list of URL properties |
| 2.1-2.5 | `parseLabInput.test.ts`, `mediaUrl.test.ts`, `labCatalog.test.tsx`, `useA2uiLab.test.tsx`, `samples.test.ts` |
| 3.1-3.4 | `a2ui-lab.css`; `route.test.ts`, `Icon.test.tsx` and the separate build chunk; `A2uiLabPage.test.tsx`; README Features line |
| 4.1 | `frontend/e2e/a2ui-lab.e2e.ts` (including Not signed in) and the phone test in `responsive.e2e.ts` |
| 4.2 | qc-ui pass on the second pass; the remaining cosmetic defect is listed in `evidence.md` |

## Uncovered scenarios

None. Every scenario in `specs/a2ui-lab/spec.md` has a unit or e2e test.

## Notes

- First run (fail): "Not signed in" had no test, and the e2e stamp could not be matched to the tree. Fixed: a signed-out e2e test was added, and the full suite re-ran on the final code.
- The verifier's own tree hash differs from the kit's stamp hash because it computes the hash differently. The e2e result is qc-e2e's run on the final product code. Only planning documents (tasks.md, evidence.md, this report, a design note) changed after it.
