# Evidence: a2ui-lab-playground

## E2E (task 4.1)

- `frontend/e2e/a2ui-lab.e2e.ts` (20 tests) covers every spec scenario, including "Not signed in". The phone scenario is in `frontend/e2e/responsive.e2e.ts`.
- One product bug was found and fixed: a `[x](javascript:...)` link rendered as an anchor with an empty href, which opened the app in a new tab. `LabMarkdown` now renders it as text.
- Full suite on the final tree: 324 passed, 0 failed, 33 skipped (15.8 min). Stamped at tree `b71854164c`.

## UI check (task 4.2)

- First pass: 5 minor findings. These were fixed: panes about 200 px wide at 1440 px with JSON wrapping mid-token, the sample select being cut off, Text Markdown too large, and the "1 steps" plural.
- Second pass: pass.

### Remaining defects

- [minor, cosmetic] `responsive-a2ui-lab-phone.png` and `responsive-a2ui-lab-inspector-phone.png`: in light mode the active outer phone tab can keep a grey fill (hover or focus after the tap) on Editor and Inspector, but not on Preview. The dark twins are fine. Likely fix: no hover fill on `[aria-selected="true"]` tabs in `frontend/src/components/a2ui/a2ui-lab.css`. Left for a later change, because fixing it now would need another full e2e run for a cosmetic difference.
- [minor, upstream] The A2UI basic catalog's TextField does not tie its label to its `<input>` (see design.md, Risks).

## Dependencies

- `@a2ui/react` 0.15.0, `@a2ui/web_core` 0.15.0, `zod` 3.25.76 (exact). `dompurify` is forced to 3.4.18 with `overrides`.
- `npm audit` still reports zod GHSA-mrhx-c7xc-m3w5 (high, memory exhaustion while validating oversized collections, fixed only in zod 4.6.6). The renderer requires zod 3, so this is accepted. It is mitigated by the 256 KB / 200-message input limit (design.md, Risks).
