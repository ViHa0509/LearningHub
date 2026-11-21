# Tasks

Contract: `design.md` and `specs/a2ui-lab/spec.md`. Frontend only; the backend checks must still pass unchanged. Code goes in `frontend/src/components/a2ui/` unless a task says otherwise.

## 1. Dependencies and spike

- [x] 1.1 Add `@a2ui/react` `0.15.0`, `@a2ui/web_core` `0.15.0` and `zod` `3.25.76` as exact versions to `frontend/package.json` (design 2), and an `overrides` entry forcing `dompurify` to `3.4.18` (design, Risks). Verify: `npm install` succeeds, `npm ls dompurify` shows 3.4.18, and `npm run build` and `npm test` still pass.
- [x] 1.2 Spike (design 6), with findings written into `design.md` Decision 6: build a lab catalog that has the basic catalog's id and functions and replaces Image with a React implementation, and render one surface with it in a throwaway Vitest test. List every basic catalog property that takes a URL (Image, Video, AudioPlayer, Icon and any other) and say whether it is guarded or safe. Verify: the spike test passes and is then removed or kept as the real test of task 2.3, and `design.md` names the approach that works (mixing, or the fallback catalog).

## 2. Core (no UI)

- [x] 2.1 `parseLabInput(text)` (design 5): a single message, an array, or `{messages}`; JSON errors with line and column; each item must be an object with `version: "v0.9"`; text over 256 KB and more than 200 messages are refused with an error naming the limit. `parseLabInput.test.ts` covers each shape, an empty text, invalid JSON with its position, a wrong version, and both limits. Verify: `npm test`, `npm run lint`.
- [x] 2.2 `isAllowedMediaUrl(url, kind)` (design 6): same origin, or `data:` of the matching media type; refuses other origins, protocol-relative `//host`, `javascript:`, `blob:` and a `data:` of another type. `mediaUrl.test.ts` covers each case, including `/brand/logo-mark.svg` allowed and `https://tracker.example/p.png?d=secret` refused. Verify: `npm test`, `npm run lint`.
- [x] 2.3 `labCatalog` with the guarded media components (blocked placeholder showing the URL as text), and `LabMarkdown` (design 7): move the chat's `REMARK` and `MARKDOWN` config into a shared module used by `agent/MessageList.tsx` and `LabMarkdown`; links get `target="_blank" rel="noopener noreferrer"`. Tests: a blocked Image renders the placeholder and no `img` with an external `src`; Markdown with `<img src=x onerror=...>` and `[x](javascript:...)` creates no `img` and no `javascript:` href. Verify: `npm test` (including the existing `MessageList.test.tsx`), `npm run lint`.
- [x] 2.4 `useA2uiLab()` (design 4): the processor with `labCatalog`, the surfaces list, a log with direction, source and time, errors with the message index, `send` one message at a time, `reset` that disposes and recreates the processor, and actions logged as renderer-to-agent `action` entries. `useA2uiLab.test.tsx` covers: three messages logged in order; an unknown component reported with its index while earlier messages stay applied; reset empties surfaces, log and errors; an action payload logged with its resolved context. Verify: `npm test`, `npm run lint`.
- [x] 2.5 `samples.ts` (design 9): hello (3 steps), form (TextField bound to `/user/name`, a Button with action `submit` and context `{"name": {"path": "/user/name"}}`), list, quiz (ChoicePicker, a Check button with action `answer`, a reply that updates `/result`), and invalid (an unknown component `Carousel` and a missing root). Scripted replies are sent after the matching action with source "scripted agent". `samples.test.ts`: every step of every valid sample processes with no error through `useA2uiLab`, the invalid sample yields the expected errors, and the quiz reply runs after `answer`. Verify: `npm test`, `npm run lint`.

## 3. Page

- [x] 3.1 Theme bridge `a2ui-lab.css` (design 8): map the `--a2ui-*` variables from `@a2ui/web_core`'s styles to the app tokens, light and dark. Verify: `npm run build`; checked visually in 4.2.
- [x] 3.2 Route `{ page: 'a2ui-lab' }` ↔ `#/a2ui-lab` in `lib/route.ts` (with a `route.test.ts` case), the lazy `A2uiLabPage` in `AppShell.tsx` (design 3), the "A2UI Lab" top bar link with a new `lab` icon in `Icon.tsx` (house line style; `Icon.test.tsx` lists it). Verify: `npm test`, `npm run lint`, and `npm run build` shows the A2UI code in its own chunk, not in the main one.
- [x] 3.3 `A2uiLabPage` (design 10, 11): the editor (monospace textarea, sample picker, Send disabled when empty, Next step with "Step n of m", Reset), the preview (every surface, and an empty state that says it is a local playground with no agent), and the inspector tabs Log (direction marked, JSON pretty-printed), Data model (per surface, live) and Errors. The draft is kept per user in localStorage (`lh.a2uiLab.draft.<userId>`, guarded); loading a sample over a changed draft asks first. The phone layout has the tabs Editor / Preview / Inspector, and Send switches to Preview. `A2uiLabPage.test.tsx` covers: Send disabled when empty; a JSON error shown with its position; Next step advances the counter and the editor; confirm on loading a sample over a changed draft, with Cancel keeping the text; the draft restored after remount; storage that throws does not break the page; phone tabs. Verify: `npm test`, `npm run lint`, `npm run build`.
- [x] 3.4 README: one line under Features for the A2UI Lab (a local playground for the A2UI v0.9 protocol, no agent yet). Verify: the line is present.

## 4. E2E and verification

- [x] 4.1 qc-e2e: a new `e2e/a2ui-lab.e2e.ts` from the spec scenarios: open from the top bar; send the hello surface, then update and delete it; not-JSON and unknown-component errors; reset; step through a sample to its last step; two-way binding shown in Data model; the button action with its resolved context in the log; the quiz scripted reply; an external Image makes no request to its host (`page.on('request')`) and shows the placeholder; HTML in a Text creates no element; the draft kept after reload. Light and dark screenshots of the lab with the form sample; `responsive.e2e.ts` gets the phone scenario with a `responsive-*` screenshot. Verify: `npm run e2e` passes.
- [x] 4.2 qc-ui: inspect the new screenshots in light and dark at desktop, tablet and phone sizes (surface readability, theme bridge, no sideways scroll). Verify: no defect left, or each remaining defect is listed in `evidence.md`.
- [x] 4.3 Every check in `CLAUDE.md` passes and `openspec validate a2ui-lab-playground --strict` passes. Verify: the verifier report is in `verifier-report.md`.

## Workflow follow-up

- Commit and push to `main` when everything is okay (CLAUDE.md, Agent team), then archive the change.
- Next change (not this one): agent lab with a `render_ui` tool, catalog validation on the server, providers side by side, and A2UI evals.
