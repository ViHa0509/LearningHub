# Evidence: a2ui-chat-agent

## E2E (task 5.2)

- `frontend/e2e/a2ui-chat.e2e.ts` covers every browser-visible scenario of a2ui-chat, agent-chat (outside Markdown image) and agent-providers (Interactive tutor listed). The phone scenario is in `responsive.e2e.ts`. Scenarios a browser cannot see (a second user, shared mode, the model-side tool result, invalid content, provider failure, claude-code) are covered by the backend tests listed in `verifier-report.md`.
- Bugs found and fixed during the e2e rounds:
  - The `fake_llm.py` "quiz me" trigger caught the `/quiz` skill's expansion ("Quiz me: …"). This was test infrastructure. It now matches only `quiz me` not followed by a colon.
  - The spec's "Wrong answer … marks the correct option" was only met in text. The correct option now gets " ✓" after grading, and each graded question shows "✓ Correct" / "✗ Not quite". The e2e tests assert both.
- Final full suite on the final tree: 379 passed, 0 failed, 34 skipped. Stamped at tree `45a7f1f82f`.

## UI check (task 5.3)

- qc-ui: pass, with minor findings. Fixed: correct-option marking and the right/wrong mark, the phone width (no avatar indent), two screenshots scrolled wrong, and an oxlint warning in `ChatSurface.tsx`.

### Remaining defects

- [minor, cosmetic] In dark theme the A2UI Check button in chat surfaces renders mid-blue, not the app's cyan accent (`a2ui-chat-quiz-partial-dark.png`). The `--a2ui-color-primary*` variables and an explicit `.a2ui-theme .a2ui-button-primary` rule both point at `--accent`, yet the screenshot is still blue. The cause needs a live browser inspection of the Custom Element's styles (likely a shadow-DOM or `:host` default). Light theme is correct.
- [minor, upstream, from a2ui-lab-playground] The basic catalog's TextField does not tie its label to its input; these templates don't use TextField.

## Follow-up ideas (not in this change)

- Cap `show_interactive` calls per chat request (today only the assistant's step budget limits how many tutor runs one request can start).
- Decide whether the composer's `/quiz` skill should ask for the interactive quiz (its text still asks for answers after the questions).
- `a2ui-lesson-blocks`: the owner's note-style lesson blocks (see `tasks.md`, Workflow follow-up).
