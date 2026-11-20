# Design

## Context

- The chat panel is `components/AgentPanel.tsx` with `components/agent/MessageList.tsx`, `Composer.tsx` and the hook `useAgentChat.ts`, which returns `entries`, `busy` and `loading`. A failed request adds an error entry under the question.
- `.composer` is `position: relative` (`index.css:729`); the composer card and its footer (plus button, hint, Send) are inside it.
- Per-browser choices of the panel live in `lib/agentPrefs.ts` (effort, guarded `localStorage`). The options menu is the `ActionMenu` in `Composer.tsx`, where Effort is a `menuitemradio` group that applies at once.
- `lib/useReducedMotion.ts` and `lib/useScreenClass.ts` exist. Spec `visual-polish` requires that every animation stops under reduced motion and that colors come from theme tokens.
- No route reads or writes `users.preferences`.

## Decisions

1. **Frontend only, per browser.** The choice is `learninghub.pet` in `localStorage` (`'off'` when switched off; missing means on), read and saved next to the effort helpers in `lib/agentPrefs.ts`. Reason: same kind of choice as effort and theme, and no backend work while two backend changes are open. Rejected: `users.preferences` with a new route; it can follow if the owner wants the choice on every device.
2. **The Save rule.** The Pet item applies at once, like Effort and the theme. It is a view choice in a menu, not an edit form, so there is no Save button; nothing is typed and nothing can be lost.
3. **State.** `lib/pet.ts` exports `usePetState({ busy, entries })` -> `{ pose, line }`:
   - `busy` true -> `thinking`, line "Thinking…" for as long as it lasts;
   - `busy` goes true -> false: the newest entry is an error -> `error`, "That didn't work. Try again?" for 6 s; otherwise `done`, "Done!" for 4 s; then `idle`, no line;
   - first mount with the pet on -> `idle` with "Hi! What are we learning today?" for 6 s;
   - opening a past chat (`loading`) and Clear chat do not change the pose.
   The four lines are constants in `lib/pet.ts`. The hook takes no text from entries; it reads only whether the newest entry is an error. Timers are cleared on unmount and when a new request starts.
4. **Drawing.** `components/agent/ChatPet.tsx` renders one inline `<svg viewBox="0 0 16 16" shape-rendering="crispEdges">` built from `<rect>` pixels, shown at 32 by 32 CSS pixels. Fills are theme tokens (`var(--accent)` for the leaf, `var(--text)` for outline and eyes, `var(--surface)` for the body), so light and dark work without two drawings. Each pose is a small set of pixel groups switched by a `data-pose` attribute: idle (leaf up, eyes open), thinking (eyes up, three dots), done (eyes closed in a smile, leaf up), error (leaf down, flat mouth). No image file, no sprite sheet, no library.
5. **Motion.** CSS only, with `steps()`: idle bobs one pixel every 2 s and blinks; thinking cycles the three dots; done hops once. All of it sits inside `@media (prefers-reduced-motion: no-preference)`, so under reduced motion the pose still changes but nothing moves; the bubble has no transition there.
6. **Place.** `ChatPet` is rendered by `AgentPanel` inside `.composer`, absolutely placed with its feet on the composer card's top edge, 28 px from the right. The bubble sits above it, right-aligned, at most 220 px wide, one or two lines. `pointer-events: none` on both. While the pet is shown, the message list gets 44 px more bottom padding, so the last message ends above it.
7. **Accessibility.** The pet and its bubble are `aria-hidden="true"` and not focusable. The panel's `role="status"` "working" line and the error row already tell assistive technology the same thing; a second live region would repeat it.
8. **Phone.** At the phone screen class (`useScreenClass`) the component is not rendered and the padding of decision 6 is not added. Tablet and desktop show it.
9. **Menu.** `Composer.tsx` gets one more item after Effort: `role="menuitemcheckbox"`, label "Pet", `aria-checked`, with the check icon when on. It toggles and closes the menu. The state lives in `AgentPanel` (as effort does) and is passed down.
10. **Tests.** Vitest with fake timers for the state hook (each transition and timeout), the component (pose attribute, fixed lines, `aria-hidden`, nothing rendered when off or at phone size, reduced motion) and the menu item (toggle, storage, storage blocked). E2E through the fake LLM server: greeting, thinking and done on a real send, error on a failing send, switch off and reload, a click on Send with the bubble shown, phone size, light and dark screenshots.

## Risks

- The pet covers part of the conversation at the bottom right: handled by the extra padding and `pointer-events: none`; the e2e test clicks through it.
- A motion the user finds distracting: the Pet item switches it off in two clicks, and reduced motion stops it.
- E2E screenshots of other tests gain a pet on the composer. The animation is paused by Playwright's screenshot option already used in the suite, or the existing tests switch the pet off in storage state if screenshots flicker; `qc-e2e` decides from a first run.
- Same files as `shared-providers` task 2.1 (`AgentPanel.tsx`, the chat hints): build this change after that task.
