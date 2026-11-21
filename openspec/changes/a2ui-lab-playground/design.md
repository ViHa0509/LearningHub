# Design

## Context

See proposal.md (Why) and `specs/a2ui-lab/spec.md` for the behavior. Facts that shape the approach:

- The frontend is Vite + React 19 + TypeScript. Pages are picked by `parseRoute` in `frontend/src/lib/route.ts` and rendered in the center panel by `AppShell.tsx`. Top bar links are in `TopBar.tsx` (News is the model to follow).
- `@a2ui/react` 0.15.0 (Apache-2.0, published 2026-11-02) renders protocol **v0.8 and v0.9 only** (`@a2ui/react/v0_9`). `@a2ui/web_core` 0.15.0 has the `MessageProcessor` (which also parses v1.0) and the v0.9 `basicCatalog`. The renderer needs `zod` ^3.25.76 as a peer dependency. The frontend does not use zod today.
- `MessageProcessor(catalogs, actionHandler, options)`: `processMessages()` takes one message, an array, or `{messages}`. `options.errorHandler` together with `reportErrorsOnly: true` reports errors without throwing. `model.surfacesMap`, `onSurfaceCreated` and `onSurfaceDeleted` drive the list of surfaces. `actionHandler` receives each `ActionPayload`.
- `Text` renders Markdown through a renderer the app provides (`MarkdownComponentContext`). The app already renders model Markdown with `react-markdown` + `remark-gfm` and no `rehype-raw` (`agent/MessageList.tsx`), and react-markdown's default `urlTransform` drops `javascript:` URLs.
- The basic catalog components are Custom Elements styled with `--a2ui-*` CSS variables. The app's theme tokens are in `frontend/src/index.css`.
- The A2UI README's security section asks the app to treat agent UI as untrusted (phishing, XSS through property values, layout DoS).
- `frontend/src/lib/unsavedGuard.ts` already asks before unsaved text is discarded. localStorage is used guarded (`agentPrefs.ts`, `homeTab.ts`).

## Goals / Non-Goals

**Goals:**
- Learn the v0.9 protocol through the official renderer, with the same building blocks a later agent lab will reuse: the processor wrapper, the lab catalog with the media guard, the Markdown bridge and the inspector.
- Make the lab cost nothing for users who never open it: its code and dependencies load only on `#/a2ui-lab`.

**Non-Goals:**
- No backend, no agent, no persistence on the server. No custom Learning Hub catalog and no v1.0 rendering. A JSON schema editor with autocompletion is not included; the editor is a plain monospace textarea.

## Decisions

1. **Official renderer, protocol v0.9.** Use `@a2ui/react/v0_9` with `@a2ui/web_core/v0_9`. The owner chose this to reduce work. v1.0 waits until the React renderer supports it. *Alternative:* our own renderer. It would teach more but needs many more tests, and it was declined.

2. **Pin exact versions.** Add `@a2ui/react` `0.15.0`, `@a2ui/web_core` `0.15.0` and `zod` `3.25.76` without a caret. The packages are pre-1.0 and their API moves between minors. An upgrade is a deliberate change with the samples as its regression test.

3. **Lazy page.** `A2uiLabPage` is loaded with `React.lazy` from `AppShell`, so A2UI, zod and markdown-it land in their own chunk. The route is `{ page: 'a2ui-lab' }` ↔ `#/a2ui-lab`. The top bar link "A2UI Lab" sits next to News and uses a new `lab` icon in `Icon.tsx`, drawn in the house line style.

4. **One processor per lab session, wrapped in a hook.** `useA2uiLab()` (in `frontend/src/components/a2ui/`) owns a `MessageProcessor([labCatalog], onAction, { errorHandler, reportErrorsOnly: true })`. It exposes `surfaces`, `log`, `errors`, `send(payload, source)` and `reset()`. Reset disposes the processor and creates a new one; this is simpler and safer than deleting surfaces one by one. `send` processes the messages one at a time, so an error names the message index and the earlier messages stay applied (spec: Invalid input). The log stores each entry with direction (`agent→renderer` / `renderer→agent`), time and the JSON.

5. **Input parsing is ours.** A pure `parseLabInput(text)` returns either a message list or an error with line and column, computed from the `JSON.parse` error position. It refuses text over 256 KB (UTF-8 bytes) before parsing and more than 200 messages after parsing (spec: Input size limit; see the zod risk below). It accepts a single object, an array, or `{messages}`. Each message must be an object with `version: "v0.9"`; protocol validation is left to the processor. Being pure, it is unit-tested without the renderer.

6. **Lab catalog with a media guard.** `labCatalog` = a `Catalog` with the basic catalog's id and functions. Image, Video and AudioPlayer are replaced by React implementations with the same names and schemas. They render only when `isAllowedMediaUrl(url, kind)` passes: the same origin as `window.location`, or `data:image/`, `data:video/`, `data:audio/` to match the kind. Otherwise they show a "blocked" placeholder with the URL as text. Keeping the basic catalog id means samples and, later, agents use the standard `catalogId`. *Alternatives:* a page-wide CSP `img-src` would also hit the rest of the app; checking literal URLs in messages misses URLs bound through the data model. **Spike first (task 1.2):** confirm that a catalog can mix the basic Custom Element components with React implementations, and how the basic components are read from `basicCatalog.components`. If mixing does not work, the fallback is to implement Image, Video and AudioPlayer as React components in a catalog of their own placed before the basic one, and to record that in this file.

   **Spike result (2026-11-21, task 1.2): mixing works, so the fallback is not needed.** `A2uiSurface` prepares each catalog and wraps every non-Custom-Element implementation in its own host element (`toWebComponent` in `@a2ui/react`). The working shape:
   `new Catalog(basicCatalog.id, '0.9', [...basicCatalog.components.values()].map(c => c.name === 'Image' ? LabImage : c), [...basicCatalog.functions.values()])`,
   with `LabImage = createComponentImplementation({ name: 'Image', schema: A2uiImage.schema }, ...)`. The APIs `A2uiImage`, `A2uiVideo` and `A2uiAudioPlayer` are exported from `@a2ui/web_core/v0_9/basic_catalog`. The spike test rendered a Column with a basic Text and the React Image in jsdom, and no `img` with the external URL was created. It was then replaced by the real test `src/components/a2ui/labCatalog.test.tsx` (task 2.3). Pass the basic catalog's `themeSchema` too when the theme is used.
   URL-bearing properties in the v0.9 basic catalog: `Image.url`, `Video.url` and `AudioPlayer.url` are guarded. `Icon.name` is an enum of icon names, a `{svgPath}` (SVG path data, not a URL) or a binding, so it is safe. The `openUrl` function allows only http, https, mailto and tel, and opens with `noopener,noreferrer`; it runs only on a user's click, so it is safe.

7. **Markdown bridge.** Provide `MarkdownComponentContext` with a `LabMarkdown` component that uses `react-markdown` + `remark-gfm` (no `rehype-raw`) and opens links with `target="_blank" rel="noopener noreferrer"`. The chat's `REMARK` and `MARKDOWN` config moves into a small shared module so both use the same rules.

8. **Theme bridge.** A scoped stylesheet `a2ui-lab.css` maps the `--a2ui-*` variables to the app tokens (`--surface`, `--text`, `--muted`, `--accent`, `--border-strong`, `--radius`, `--font`). The app's dark-mode token switch then themes surfaces with no JavaScript. The exact variable names come from `@a2ui/web_core`'s styles during task 3.1.

9. **Samples are data.** `samples.ts` exports `{ id, title, steps: Message[][] , replies?: Record<actionName, Message[]> }`. Next step sends `steps[i]` and puts `steps[i+1]` (pretty-printed) in the editor. When an action arrives, the hook looks up `replies[action.name]` of the loaded sample and sends those messages with source `scripted agent`. Samples: hello (3 steps), form with two-way binding and a submit action, list, quiz (ChoicePicker + Check button, reply updates `/result`), and an invalid sample (an unknown component and a missing root).

10. **Draft in localStorage per user.** Key `lh.a2uiLab.draft.<userId>`, written on change with a short debounce, read on open, guarded with try/catch (storage may be blocked). The sample's loaded text or last sent text counts as "clean". Loading a sample over a changed draft calls `window.confirm` (spec: samples). Because the draft is kept, leaving the page does not use `useUnsavedGuard`, which is consistent with the app rule "unsaved changes ask before they are discarded": nothing is discarded. The editor needs no Save button because it saves nothing to the server; **Send** is its explicit commit.

11. **Layout.** On desktop and tablet: editor (with the sample picker, Send, Next step, Reset) | preview | inspector (tabs: Log, Data model, Errors). On a phone, `useScreenClass` switches to one pane with tabs Editor / Preview / Inspector. After Send on a phone, the Preview tab opens.

## Risks / Trade-offs

- [`npm audit` after installing (2026-11-21): the renderer pins `zod` ^3.25.76, and GHSA-mrhx-c7xc-m3w5 (high, memory exhaustion while validating oversized constrained collections) is fixed only in zod 4.6.6, with no 3.x fix. `@a2ui/markdown-it` brings `dompurify` 3.4.11 with XSS advisories up to 3.4.16] → `dompurify` is forced to 3.4.18 with an npm `overrides` entry (we do not use the A2UI Markdown renderer in any case; Decision 7). zod stays at 3.25.76 because the renderer needs it. The Lab only validates text the user typed, and the input size limit (Decision 5) caps what reaches zod. Revisit when `@a2ui/react` moves to zod 4, and before agent output reaches the renderer (the agent lab change must keep a server-side size limit).

- [The pre-1.0 renderer API changes] → pinned versions (Decision 2); the samples run in Vitest and e2e, so an upgrade breaks loudly.
- [Custom Elements in React 19 and jsdom: Vitest may not render basic components fully] → unit-test the pure parts (parser, media guard, sample shape, the hook's log and errors) and the page shell. Real rendering is checked in e2e (Edge).
- [The media guard can be bypassed by a basic component we did not replace (for example an `Icon` URL)] → task 1.2 lists every basic component property that takes a URL, and each one is guarded or recorded here as safe.
- [Bundle size of A2UI, zod and markdown-it] → a lazy chunk (Decision 3). The build output is checked so the main chunk does not grow beyond the route and link code.
- [Found in e2e (2026-11-22): the basic catalog's own TextField does not tie its label to its `<input>`, so the input has no accessible name] → this is upstream (`@a2ui/web_core` 0.15.0), outside this change's spec. Replace TextField in the lab catalog, like the media components, if the Lab or the agent chat starts relying on forms.
- [A playground could be mistaken for a feature that talks to an agent] → the page subtitle says it is a local playground with no agent, and scripted replies are labelled "scripted agent" in the log.

## Migration Plan

Frontend only: deploy with the normal push to `main` (CI e2e, then Vercel). Rollback is reverting the commit; there is no stored data to clean up apart from the browser draft key.
