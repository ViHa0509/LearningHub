# Chat pet

## Why

The owner wants a small pet character in the chat panel, like the one that sits on the composer of other chat tools (2026-11-19: "can we make a pet like this in Learning Hub", then "plan this pet"). It makes the panel friendlier and shows at a glance what the agent is doing.

## What changes

- A small pixel-art pet sits on the top edge of the chat composer, at its right end. It is an original character drawn for this app.
- The pet has four states, taken from the chat state the panel already has: idle, thinking (a request is running), done (an answer just arrived) and error (the request just failed).
- A speech bubble above the pet shows a short fixed line: a greeting when the app opens, and one line each for thinking, done and error. The bubble goes away by itself.
- The composer's options menu (the plus button) gets a **Pet** item that switches the pet on or off. The choice is kept in the browser, like the effort choice. The pet is on by default.
- The pet is decoration: it never takes a click, never covers a control, and screen readers skip it (the panel already announces "working" and errors).
- It does not animate when the system asks for reduced motion, and it is not shown at phone size.

## Assumptions to confirm in review

1. **The character.** A sprout: a round body with two eyes and one leaf on top, 16 by 16 pixels, drawn in the theme's colors. Working name "Pip". The owner may replace the drawing; behavior does not depend on it.
2. **Chat state only.** The pet reacts to the chat and says only its fixed lines. It does not comment on the user's learning (unlinked notes, streaks and the like).
3. **On by default**, per browser, without a server setting.

## Not in this change

- Storing the choice per user on the server (`users.preferences` has no route today).
- Lines about the user's data, lines written by a model, or any text from notes, lessons or answers in the bubble.
- Clicking, dragging or feeding the pet; several characters to choose from; sounds.
- A line for the shared provider's daily limit (change `shared-providers`): that request fails like any other, so the pet shows its error line.

## Impact

- Capability: `agent-chat` (four new requirements). No new capability.
- Frontend only: a new `ChatPet` component and `lib/pet.ts`, a menu item in `components/agent/Composer.tsx`, wiring in `components/AgentPanel.tsx`, styles in `index.css`. No backend, no migration, no new dependency.
- Order: build after the frontend task of `shared-providers`, which edits the same panel files.
