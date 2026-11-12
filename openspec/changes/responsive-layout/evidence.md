# Evidence: responsive-layout

Verifier (`ai-sdlc-kit:verifier`), 2026-11-13, working tree on top of `main` 8c45192: **pass**.

| Check | Result |
|---|---|
| `cd backend && .venv/Scripts/python -m pytest` | 751 passed |
| `cd backend && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .` | pass |
| `cd backend && .venv/Scripts/mypy app` | pass (71 files) |
| `cd frontend && npm test` | 358 passed (27 files) |
| `cd frontend && npm run lint` | pass |
| `cd frontend && npm run build` | pass |
| `cd frontend && npm run e2e` | 202 passed, 16 skipped (phone-only tests on the tablet project and the reverse) |

- Every scenario of `specs/responsive-layout` and `specs/learning-views` has a test (Vitest, `e2e/responsive.e2e.ts`, or both); none uncovered.
- Desktop unchanged: no existing assertion removed or loosened; the `app` project (1440x900) passes.
- No backend file changed. The hook and the CSS use the same limits (640 and 1100 px).
- `qc-e2e`: two product bugs found and fixed (touch rule order for the note More button; 40 px top-bar targets on touch tablets).
- `qc-ui` (63 phone and tablet screenshots, light and dark): three defects found and fixed (chat header squeezed on narrow panels; note menu clipped in the phone drawer; tablet screenshots taken at phone width). Left as minor: on a phone the roadmap's zoom controls sit over a leaf label in the bottom-right corner until the map is dragged.
- Accepted deviations from design.md: drawers are `position: absolute` inside the shell below the top bar (same placement as `fixed`); `.news-search input` keeps a 200 px basis; pinch zoom is React Flow's default and has no test.
