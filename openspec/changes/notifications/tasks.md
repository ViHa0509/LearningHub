# Tasks

Contract: `design.md` and `specs/notifications/spec.md`.

## 1. Backend

- [ ] 1.1 (main session) Migration: table `notifications` with indexes and RLS (design 1); `app/notifications.py` `notify` with dedupe, trim and savepoint (design 3). Verify: migration test up and down; pytest for dedupe, trim at 200 and 90 days, and an error inside notify not failing the caller's commit.
- [ ] 1.2 Routes: list (newest first, paged by 20), unread count, mark one read, mark all read; another user's id 404; mutating routes need `X-LearningHub`. Verify: pytest including isolation between two users.
- [ ] 1.3 Triggers: new member (sign-up, invitation accept), lesson ready (`write_lesson`), field published. Verify: pytest per spec scenario.
- [ ] 1.4 Triggers: shared limit 80% and reached (never the admin), provider problem and fallback (once per provider per day; category only), KH reconnect (one until reconnected). Verify: pytest per spec scenario with injected fake providers.
- [ ] 1.5 Triggers: new sign-in device (design 5), restore and sync upload. Verify: pytest per spec scenario.

## 2. Frontend

- [ ] 2.1 `NotificationBell` in `TopBar`: unread count poll (design 8), popover list with text per kind from params as plain text, time in the user's time zone, click marks read and opens the `#/` link only, Mark all read; phone layout. Verify: Vitest for each scenario of Bell and list, markup in a name shown as text, a link not starting with `#/` not opened; `npm run lint`, `npm run build`.

## 3. E2E and verification

- [ ] 3.1 qc-e2e: bell scenarios with triggers the e2e setup can make (open sign-up, lesson written through the fake LLM, shared limit with a low limit, field publish, new sign-in from a second browser context); screenshots light, dark and phone. Verify: `npm run e2e` passes.
- [ ] 3.2 qc-ui inspects the new screenshots. Verify: no open defect, or each is listed in `evidence.md`.
- [ ] 3.3 Every check in `CLAUDE.md` passes and `openspec validate notifications --strict` passes. Verify: verifier report in `verifier-report.md`.

## Workflow follow-up

- Commit and push to `main` when everything is okay, then archive the change.
- When `settings-tabs` ships: point the new sign-in link to Profile > Security, and add per-kind mute to Profile > Preferences.
