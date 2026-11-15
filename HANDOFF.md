# Hand-off (updated 2026-11-14, written by Claude Code for the next session)

Repo: `D:\Learning-hub` (GitHub `ViHa0509/LearningHub`, branch `main`). Read `CLAUDE.md` first.
This file is untracked on purpose; delete it when nothing below is open any more.

Start Claude Code in `D:\Learning-hub`, not in the kit folder: the `ai-sdlc-kit` plugin (agents `verifier`, `qc-e2e`, `qc-ui`, hooks, gates) is enabled only by `D:\Learning-hub\.claude\settings.json`. Sessions started elsewhere do not have it, which is why no change below has a verifier report.

## Latest state (2026-11-15)

`main` = `ce4a4b5`, CI green and deployed. Since the table below also shipped: `3be8d48` lesson-template, `1429e9d` learning-fields + agent-learned-notes, `b4dbc76` + `ce4a4b5` practice-exams. KH row `learning-hub/knowledges/r_00b717c450b045d1` has the details. Official class B question bank (made from Cục CSGT 2025 documents) is in `D:\Learning-hub-data\driving-600` (outside the repo): import `bank-b.json`, then Add pictures from `images\`. Cloudflare Worker Git build disconnected. Open: verifier reports and archive for every change since 2026-11-13; check whether Circular 108/2026/TT-BCA changed the class B rules.

## Owner's standing rules

- Reply in English, even when the owner writes Vietnamese.
- Simple work: self-approve and run. Ask only before very important actions.
- Never ask for a password, token or code in chat.

## Shipped to `main` (2026-11-13/14)

| Commit | Change | What |
|---|---|---|
| d02ad95 | note-actions-menu | Note page actions in a More actions menu |
| b3fab31 | note-page-polish | Note header on one line; spinner while the page loads |
| 32e1135 | chat-session-history | Saved chats, History, New chat, continue, rename, delete (migration 0014) |
| 88b2215 | composer-plus-menu | Composer + menu (Attach files, Skills, Effort); list marks only the open note |
| ad34278 | open-signup | Anyone can sign up as a member (page `#/auth/signup`, GitHub/Google too) |
| 4f1a405 | anthropic-web-search | Internet search works with Anthropic providers (server web search tool) |

CI for `ad34278` failed in e2e on a phone drawer test that measured mid-animation (deploy skipped); `4f1a405` fixes that test and was pushed. Check `gh run list --limit 2`: if green, sign-up and web search are deployed together.

## Open

1. No verifier report and no archive for any of the six changes (open tasks: the last task of each `openspec/changes/<change>/tasks.md`).
2. Web search with a real Anthropic key has not been tried (CI has no key). Try it on the hosted app: Settings -> Agents -> Internet search on, then ask something recent.
3. **Knowledge Hub connector for the agent** (owner chose: a KH tool over KH's HTTP API). Findings:
   - KH server `https://knowledge-hub.cfapps.br10.hana.ondemand.com`, sign-in through Keycloak realm `knowledge-hub` at `https://kh-keycloak.cfapps.br10.hana.ondemand.com`; it supports the device flow (link + code, the person signs in with the company account and clicks Yes), which fits a web app.
   - Blocker: Learning Hub needs its **own Keycloak client** (public, device flow, `offline_access`) registered by a KH admin. Reusing the kh-helper's client would make the app act as the helper; do not do that.
   - Plan once the client exists: Settings -> Knowledge Hub card with Connect (device flow), refresh token encrypted per user with `SecretBox`, agent tool `kh_search` calling KH with a fresh access token, Disconnect revokes. New OpenSpec change.
4. Unverified members can use the app at once (as the unverified admin could); only the account menu asks them to verify.

## Environment notes

- Docker Desktop must run; `docker compose up -d` starts Postgres on port 5434.
- Full backend pytest (787 tests, ~6 min) and full e2e (~12 min): run in the background. `pytest -q` prints only dots with this config; add `-rf -o addopts=""` to see the summary.
- e2e setup now empties `users` in the e2e database before resetting it (a leftover account blocked the downgrade).
- Files are LF. Script edits with `backend/.venv/Scripts/python` and `open(..., newline='\n')`.
- Push: `git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin main` (`gh` signed in as `ViHa0509`).
- `git stash list` holds an old local edit of `backend/alembic/env.py`; the same fix is upstream, the stash can be dropped.
