# Hand-off (updated 2026-11-15 evening, written by Claude Code for the next session)

Repo: `D:\Learning-hub` on the owner's main PC, `C:\Users\Petrus\Documents\Learning-hub` on the second PC (GitHub `ViHa0509/LearningHub`, branch `main`). Read `CLAUDE.md` first.

Start Claude Code in the repo folder: the `ai-sdlc-kit` plugin (agents `implementer`, `verifier`, `qc-ui`, `scout`, `brainstormer`; hooks; commit and push gates) loads from `.claude/settings.json`. The kit build in use (0.4.0) has **no `qc-e2e` agent type** although `CLAUDE.md` names it: run the e2e pass on a `general-purpose` Sonnet agent with the qc-e2e brief (write black-box Playwright tests from the change's specs, run `npm run e2e`, report product bugs, never touch `src/`).

## Latest state (2026-11-15)

Shipped this session (each with `openspec/changes/<change>/verifier-report.md`, one verifier run for all three: 939 backend tests, 469 Vitest, 248 e2e, all green):

| Change | What |
|---|---|
| users-menu-further-reading | Settings -> Users: one More actions menu per member row; "Further reading on roadmap.sh" only for the built-in IT roles |
| practice-question-browser | Practice page = set tabs + number grid (green right / yellow wrong / red critical mark) + card with Bookmark, Shuffle, Previous, Check, Next; chosen option saved per user (migration 0018); bookmarks; backup; Practice always shown for a field area, Import questions on the empty page |
| lesson-writer-long-output | Anthropic default `max_tokens` 2048 -> 8192; a turn cut by the output limit does not run its tool calls (the model gets a clear error, the step says so); the same failing call stops the run after 3; lesson writer instructions for a topic with no notes and no references (web search on / off) |
| note-link-picker (2026-11-16) | Note page: the node picker is labelled "Linked to", a changed link waits for Save link / Cancel link change (nothing saved on change, blur or Escape), "Open lesson" link for the saved node. Came from the owner reading the bare dropdown as a "jump to" list |

Still open from before: no verifier report or archive for the changes shipped 2026-11-13/14 (agent-learned-notes, anthropic-web-search, auth-page-polish, chat-session-history, composer-plus-menu, learning-fields, lesson-template, note-actions-menu, note-page-polish, open-signup, practice-exams: the last task of each `tasks.md`). `settings-tabs` is not started (0/7). `ci-cd` and `vercel-deploy` have 1 and 4 open tasks.

## Driving (class B) bank

- The official bank (Cục CSGT 2025: 600 questions, 60 critical, 318 images) is in `D:\Learning-hub-data\driving-600` on the main PC only. The hosted app has **no bank imported yet** (that is why the owner saw no practice UI): open the area Ô tô hạng B -> Practice -> Import questions with `bank-b.json`, then Add pictures from `images\` in batches. Topics must be `chuong-1`..`chuong-6`.
- LaixeHub's terms forbid copying its data (decided earlier); the site was used only as a UI reference for the browser layout.
- Thông tư 108/2026/TT-BCA (in force 01/7/2026) moves the class B theory test to 50 questions / 33 minutes / pass 45, but only from **01/3/2027**; until 28/2/2027 the Thông tư 12/2025 rules (30 / 20 / 27, as in `bank-b.json`) apply. No source says the 600-question bank changed. KH row `learning-hub/knowledges/r_bf60998b0555463f`.

## Owner's standing rules

- Reply in English, even when the owner writes Vietnamese.
- Simple work: self-approve and run. Ask only before very important actions (the owner allowed pushes to main while away on 2026-11-15).
- Never ask for a password, token or code in chat.

## Open

1. **Agents tab in Settings** (owner request 2026-11-15, item 5): draft proposal in `openspec/changes/agent-settings-tab/proposal.md` with four open questions for the owner; no specs or tasks until answered.
2. Verifier reports and archive for the 2026-11-13/14 changes (see above).
3. Web search with a real Anthropic key has not been tried (CI has no key). Try it on the hosted app: Settings -> Agents -> Internet search on for the lesson writer, then "Draft this lesson" on a topic of Ô tô hạng B.
4. **Knowledge Hub connector for the agent**: blocked until a KH admin registers Learning Hub's own Keycloak client (public, device flow, `offline_access`). Plan: Settings -> Knowledge Hub card with Connect (device flow), refresh token encrypted per user with `SecretBox`, agent tool `kh_search`, Disconnect revokes. New OpenSpec change.
5. Unverified members can use the app at once; only the account menu asks them to verify.
6. Cloudflare Worker Git build is disconnected; Vercel serves the app.

## Environment notes

- Docker Desktop must run; `docker compose up -d` starts Postgres on port 5434.
- Full backend pytest (939 tests, ~15 min on the second PC) and full e2e (~16 min): the commit gate runs the backend and frontend suites on every commit and e2e on push, so commit in the background with a long timeout.
- `pytest -q` prints only dots with this config; add `-rf -o addopts=""` to see the summary.
- Files are LF; agents sometimes write CRLF on Windows, check `git status` warnings before committing.
- Push: on the main PC `git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin main`; on the second PC `gh` is not installed and Git Credential Manager holds the `ViHa0509` login, so a plain `git push origin main` works.
- `git stash list` on the main PC holds an old local edit of `backend/alembic/env.py`; the same fix is upstream, the stash can be dropped.
