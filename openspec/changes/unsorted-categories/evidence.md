# Evidence: unsorted-categories

- qc-e2e: `frontend/e2e/unsorted-categories.e2e.ts` 9/9 pass (run twice; again after the touch-size fix together with `responsive.e2e.ts`: 62 passed, 23 skipped).
- Full e2e: 412 passed, 1 failed (`notifications.e2e.ts` Load more: the oldest notice was in the first page). That file passed 11/11 alone; same clock-ordering flake as `test_notes.py::test_list_is_newest_first` seen on 2026-11-24 (suspected WSL2/Docker clock step). Not changed in this change.
- Full backend pytest: pass.
- qc-ui: pass. Fixed: Rename and Group with AI buttons now 40 px tall on touch screens (`.group-head button` in the coarse-pointer block). Open minor notes: no screenshot of the busy state (covered by Vitest); other Rename buttons stay active while a rename form is open (by design).
- Review fixes by the main session: the note title is inside `<untrusted_note_content>` in the sorter prompt; Group with AI with no unsorted notes makes no model call and counts nothing (`test_nothing_to_sort_calls_no_model`).
