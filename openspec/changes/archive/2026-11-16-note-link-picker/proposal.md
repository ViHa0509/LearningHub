# Change: Note link picker with a label, Save and Cancel, and an Open lesson link

## Why

On the note page the roadmap node picker is a bare dropdown next to the title. The owner read it as a "jump to another note or lesson" list (2026-11-15), picked an entry, and the note was silently re-linked to that node: nothing said what the control does, and the change was saved at once, against the rule that every edit has Save and Cancel and never saves silently.

## What changes

- The picker gets a visible label, **Linked to**, so it reads as the note's link, not as navigation.
- Changing the picked node shows **Save link** and **Cancel link change**, like the title: the link is saved only on Save; Cancel restores the saved node. Nothing is saved on change, blur or leaving.
- When the note is linked to an existing node, an **Open lesson** link beside the picker opens that node's lesson page, so the user can jump from the note to its place in the roadmap.
- The Import dialog and the Move dialog keep their pickers as they are (each already has its own confirming button).

## Impact

- Spec: `learning-views` (Read a note).
- Frontend: `NoteView.tsx`, `NoteView.test.tsx`, `index.css`; e2e `note-edit.e2e.ts`, `curation.e2e.ts` (accessible name of the picker changes from "Roadmap node" to "Linked to").
- No backend change.
