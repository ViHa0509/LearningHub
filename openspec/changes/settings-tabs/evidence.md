# Evidence: settings-tabs

qc-ui (2026-11-23), three rounds:
1. Only phone screenshots present (a responsive run had cleared the folder); "← Back" link unstyled -> fixed in `index.css`.
2. Full set: four minors (cramped spacing on General and Security, unstructured session rows, Preferences hint not following the choice) and cosmetics -> fixed (stacked cards, danger card for Delete account, two-line session rows, hint per value, textarea style, Delete button in the screenshot).
3. One major: the Revoke button wrapped mid-word -> `.session-row > button { white-space: nowrap }`; checked by the main session on the refreshed `profile-sessions.png` (single-line "Revoke"), after `settings-profile.e2e.ts` passed again.

Also fixed during QC: on a phone the Settings/Profile drawer now closes when a section is picked (`responsive.e2e.ts` asserts it).

## Accepted cosmetic

- Tall gap under the "General" and "Security" headings before the first card.
- In Sign-in methods, the row with a Link/Unlink button is slightly taller than rows without one.
- The drawer close "×" is small.
- The email card has no "Email" label before the address.
