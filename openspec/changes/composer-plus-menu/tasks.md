# Tasks

## 1. Composer

- [x] 1.1 `Composer.tsx`: remove the tools row; an options button (`aria-label="Message options"`, plus icon, `aria-haspopup="menu"`, `aria-expanded`) in the footer opens the shared `ActionMenu` with Attach files, Skills and Effort; Effort (`aria-expanded`) lists Low, Medium, High as `menuitemradio` with the current one checked; choosing closes the menu and returns the focus; a "Low effort" / "High effort" note in the footer when not Medium; `ActionMenu` moves with the arrow keys over radio items too; verify with Vitest in `AgentPanel.test.tsx` for the four scenarios of "Composer options menu", with the existing Skills and effort cases changed to go through the menu, none removed or weakened
- [x] 1.2 Styles in `index.css`: the menu opens above the button inside the panel, light and dark, 40 px items under `pointer: coarse`; verify `npm run lint`, `npm run build` and the screenshots of 3.1

## 2. Learned list

- [x] 2.1 Only the open note is marked; a node's notes on its lesson page; hover background; verify with a Vitest case in `LearnedList.test.tsx`

## 3. E2E and integration

- [x] 3.1 `e2e/agent-chat.e2e.ts`: Skills, effort and Attach go through the menu; screenshots of the open menu, light and dark; rerun until `npm run e2e` passes
- [ ] 3.2 Every check in `CLAUDE.md` passes and `openspec validate composer-plus-menu --strict` passes; verifier report (`ai-sdlc-kit:verifier`) on the change
