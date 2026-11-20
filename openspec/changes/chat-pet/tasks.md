# Tasks

## 1. Frontend

- [x] 1.1 `lib/pet.ts` (fixed lines, `usePetState`), the pet choice in `lib/agentPrefs.ts`, `components/agent/ChatPet.tsx` (the 16x16 SVG with its four poses, the bubble) and its styles in `index.css` with motion only under `prefers-reduced-motion: no-preference`; Vitest for every state change and timeout, the fixed lines, `aria-hidden`, reduced motion (check: frontend tests, lint, build)
- [x] 1.2 Wiring: `AgentPanel` renders the pet inside `.composer` and adds the message list padding; the Pet item in the composer's options menu; nothing rendered when off or at phone size; Vitest for the menu item (toggle, kept after remount, storage blocked) and for the phone case (check: frontend tests, lint, build)

## 2. Quality

- [x] 2.1 `qc-e2e`: Playwright tests from `specs/agent-chat/spec.md` (greeting, thinking, done, error, switch off and reload, click on Send under the bubble, last message readable, phone size, reduced motion), light and dark screenshots; full e2e passes (check: `cd frontend && npm run e2e`)
- [x] 2.2 `qc-ui`: inspects the pet's screenshots in both themes (the drawing reads as a character, the bubble does not cover controls)
- [x] 2.3 `verifier` report for the change: pass
