# Proposal

## Why

The owner wants to learn A2UI (https://a2ui.org), the protocol for agents that answer with a declarative UI instead of text, and later use it in the agent chat and in real projects. A playground with no LLM is the cheapest way to learn the protocol hands-on: surfaces, the flat component list, data binding, and actions. It also lays the base (renderer, catalog, media guard, inspector) that a later agent lab reuses.

## What Changes

- New page **A2UI Lab** at `#/a2ui-lab`, opened from a top bar link, for every signed-in user.
- A JSON editor where the user writes A2UI messages of protocol v0.9 (one message, an array, or `{"messages": [...]}`) and sends them with an explicit **Send** button; **Reset** removes every surface and clears the logs.
- Built-in samples, loaded from a picker, that run step by step (**Next step**) so each message's effect is visible on its own. Samples include a hello surface, a form with two-way binding, a list, a quiz card that answers an action, and an invalid payload that shows errors.
- A preview that renders every surface with the official React renderer (`@a2ui/react` 0.15.0, `@a2ui/web_core` 0.15.0) and its basic catalog, themed with the app's light and dark tokens.
- An inspector with the message log (agent -> renderer and renderer -> agent, in order), each surface's live data model, and validation errors.
- User actions (button clicks) are shown as the `action` message the renderer would send to an agent. A sample may script canned agent replies to an action name, so the request/response loop can be learned without an LLM.
- Image, Video and AudioPlayer load only same-origin and `data:` media; other URLs show a "blocked" placeholder with the URL as text. Markdown in `Text` goes through the app's own Markdown component, so no raw HTML is rendered.
- The editor draft is kept in the browser (local storage) per user, so leaving the page loses nothing; the lab sends nothing to the server.
- Out of scope (later changes): an agent that writes A2UI (`render_ui` tool, providers, evals), A2UI in the agent chat panel, a Learning Hub custom catalog, protocol v1.0 (the React renderer 0.15.0 supports v0.8 and v0.9 only), and streaming.

## Capabilities

### New Capabilities
- `a2ui-lab`: the A2UI Lab page: sending A2UI messages, step-by-step samples, rendering surfaces, the inspector (message log, data model, errors), actions and scripted replies, and the media and Markdown safety rules for rendered surfaces.

### Modified Capabilities
- none

## Impact

- Frontend only: a new lazy-loaded page under `frontend/src/components/a2ui/`, a route in `frontend/src/lib/route.ts`, a case in `AppShell.tsx`, and a link in `TopBar.tsx`.
- New dependencies: `@a2ui/react` 0.15.0 and `@a2ui/web_core` 0.15.0 (Apache-2.0), plus `zod` ^3.25.76, which the renderer needs as a peer dependency. They load only with the lab page, not in the main bundle.
- No backend, database, migration or API change.
- Tests: Vitest for the parser, the media guard and the page; a new e2e file `frontend/e2e/a2ui-lab.e2e.ts` with light, dark and phone screenshots.
