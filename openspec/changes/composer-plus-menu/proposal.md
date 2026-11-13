# Proposal

## Why

The chat composer shows a row of controls above the input: Attach, Skills and a three-button effort switch. In the narrow agent panel that row takes a line of its own and makes the composer look busy. The owner asked for one "+" button, as in other chat apps, and for the effort switch to become one "Effort" entry.

## What Changes

- The row above the input goes away. A **+** button at the left of the composer's footer opens a menu with **Attach files**, **Skills** and **Effort**.
- **Effort** shows the current choice and, when pressed, lists Low, Medium and High in the same menu; choosing one closes the menu. Medium stays the default and the choice is still remembered by the browser and sent with each message.
- When the effort is not Medium, the footer says so ("Low effort", "High effort"), so a non-default choice is not hidden.
- Learned list (reported by the owner in the same session): opening a note marked every note of its node, so two rows looked selected. Now only the open note is marked; a node's notes are marked on its lesson page only; a row under the pointer gets a light hover background.
- Nothing else changes: `/` autocomplete, dropping files on the panel, attachment chips, the request.

## Capabilities

### New Capabilities

### Modified Capabilities
- `learning-views`: "Two-way selection between list and map" - only the open note is marked.
- `agent-chat`: new requirement "Composer options menu"; "Skills in the composer" and "Text attachments" name the menu instead of the Skills and Attach buttons.

## Impact

- Frontend only: `components/agent/Composer.tsx`, `components/ActionMenu.tsx` (arrow keys also reach radio items), `index.css`.
- Learned list: `components/AppShell.tsx` (the list gets the selected node on lesson pages only), `index.css` (hover).
- Tests: `AgentPanel.test.tsx`, `LearnedList.test.tsx`, `e2e/agent-chat.e2e.ts`.
