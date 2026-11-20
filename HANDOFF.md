# Hand-off (updated 2026-11-20, main PC, written by Claude Code for the next session)

Repo: `D:\Learning-hub` on the owner's main PC, `C:\Users\Petrus\Documents\Learning-hub` on the second PC (GitHub `ViHa0509/LearningHub`, branch `main`). Read `CLAUDE.md` first.

Start Claude Code in the repo folder: the `ai-sdlc-kit` plugin (agents `implementer`, `verifier`, `qc-ui`, `qc-e2e`, `scout`, `brainstormer`; hooks; commit and push gates) loads from `.claude/settings.json`. On the main PC (2026-11-16) the `ai-sdlc-kit:qc-e2e` agent type exists and was used; if a session does not list it, run the e2e pass on a `general-purpose` Sonnet agent with the qc-e2e brief (write black-box Playwright tests from the change's specs, run `npm run e2e`, report product bugs, never touch `src/`).

## Latest state (2026-11-20)

`main` = `26de31d`, CI green (frontend 620, backend 1219, e2e 346), deployed to Vercel; production database at migration `0022`.

Shipped this session (one verifier run for all four, a `verifier-report.md` in each change folder, every task checked):

| Change | What |
|---|---|
| user-timezone | `users.timezone` (migration 0022), `PUT /api/auth/timezone`, the "Your time zone" dialog after sign-in ("Not now" lasts for the browser session), Settings -> Account, every time shown in the user's zone |
| shared-providers | The admin marks a provider "Shared with all users" (migration 0021); a member with no usable provider of their own runs on it, 10 requests a day (UTC, `LH_SHARED_DAILY_LIMIT`), the admin is never counted; when sharing is withdrawn the member sees a warning. Read-only for members; copying is out of scope |
| chat-pet | A 32 px pixel pet on the chat composer with four fixed lines (greeting, thinking, done, error); "Pet" in the composer's options menu switches it off (`localStorage` key `learninghub.pet`); hidden on phones; still under reduced motion |
| global-search | `GET /api/search?q=` and a top-bar search box over the user's own topics, lessons and notes (limits 5/5/8); a search button and row on phones |

Also: `mail-send-inline` and the README diagrams came in from the second PC (`6782a0c`).

Incident (fixed): local `backend/.env` and `.env` pointed `LH_DATABASE_URL` at the production Supabase database, so a local `alembic upgrade head` put the uncommitted migrations 0021 and 0022 on production and the CI deploy failed with "Can't locate revision identified by '0022'". Production was downgraded to 0020 (no data in the new columns), the deploy was rerun, and both `.env` files now leave `LH_DATABASE_URL` commented out, so local work uses the Docker Postgres (`localhost:5434/learninghub`, empty, at 0022). Production changes only through CI.

Open from this session:

- Owner's wish, not planned yet: a member sees the admin's shared provider as an extra entry with a "Public" status in their provider list (today it is one line of text). Waiting for the owner to confirm the reading, and whether the admin's tag changes from "Shared" to "Public". Needs its own OpenSpec change.
- Pet size stays 32 px on trial; a setting for the pet (size) may follow.
- The shared reference a member gets from the API carries the provider's `id` and type besides name and model (harmless: every route with that id answers 404 for a member; noted in the proposal).
- FPT AI (`https://token-api.fpt.ai/v1`) needs no code: add it in Settings as "Custom (OpenAI-compatible)". Not tested against the real endpoint.
- The hosted app was not clicked through after the deploy (only `/api/health` 200 and `/api/search` 401 without a session).
- This PC: the full e2e in one background run gets killed for low memory; run it in foreground batches of files. `git push` uses the work account from the Windows credential manager and is refused; push with `git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin main` (gh is signed in as the repo owner).
- The kit's agents did not load in the `.claude-pet` profile; general-purpose agents read the definitions under `plugins/cache/petrus-sdlc/ai-sdlc-kit/0.4.0/agents/`.

## Latest state (2026-11-17)

Shipped this session (each with `openspec/changes/<change>/verifier-report.md`, one verifier run for all three: 939 backend tests, 469 Vitest, 248 e2e, all green):

| Change | What |
|---|---|
| users-menu-further-reading | Settings -> Users: one More actions menu per member row; "Further reading on roadmap.sh" only for the built-in IT roles |
| practice-question-browser | Practice page = set tabs + number grid (green right / yellow wrong / red critical mark) + card with Bookmark, Shuffle, Previous, Check, Next; chosen option saved per user (migration 0018); bookmarks; backup; Practice always shown for a field area, Import questions on the empty page |
| lesson-writer-long-output | Anthropic default `max_tokens` 2048 -> 8192; a turn cut by the output limit does not run its tool calls (the model gets a clear error, the step says so); the same failing call stops the run after 3; lesson writer instructions for a topic with no notes and no references (web search on / off) |
| note-link-picker (2026-11-16, archived) | Note page: the node picker is labelled "Linked to", a changed link waits for Save link / Cancel link change (nothing saved on change, blur or Escape), "Open lesson" link for the saved node. Came from the owner reading the bare dropdown as a "jump to" list |
| map-lesson-markers (2026-11-16) | `GET /api/domains/{d}/counts` also lists `lessons` (node ids with a lesson); the map marks such nodes with a lesson icon ("Has a lesson") next to the note count; the mark follows a lesson saved or cleared |
| chat-new-on-load (2026-11-16) | The agent panel no longer remembers the open chat in the browser: every page load starts an empty chat; old chats stay in History |
| note-header-safe-edits (2026-11-16) | Note title is a heading; Rename is an explicit button / menu item opening the field with Save title / Cancel title change; an Undo line (8 s) after a rename and after Save link. Came from a note renamed to "chuong 1" and re-linked to `o-to-hang-b/chuong-1` by accident |
| agent-settings-page (2026-11-16) | Settings -> Agents (`#/settings/agents`, nav tab for every member): the agent cards moved there; Areas section with per-area Extra instructions (4000 chars) and a Tools checklist, Save/Cancel per card; migration 0019 `area_agent_settings`; the chat adds the area's instructions to the system prompt on that area's pages and offers only the ticked tools (API loop and the Claude Code MCP server via `LH_AGENT_TOOLS`); backup/restore; fake LLM gained `[[echo-system]] <marker>` and `[[echo-tools]]` |
| learned-list-drag-drop (2026-11-16, main PC) | Learned list: drag a note onto a topic to link it, or onto Unsorted to remove the link; while dragging, every listed domain also shows its topics without notes; "Moved … to …. Undo" line for 8 s. Frontend only. Owner's choice: targets are the topics of domains already in the list. Not tried by hand: dropping on a topic below the visible part of the list |
| app-loading-indicator (2026-11-16, main PC) | A spinner with "Loading…" while the app starts: a static copy inside `#root` of `index.html` (shows before the JavaScript loads) and the same element in `AppShell` while the sign-in status or the session is pending (`.app-loading` in `index.css`, reuses `.spinner`). Came from the owner seeing an empty background on the hosted app. Verifier: 966 backend, 518 Vitest, 275 e2e |
| phone-import-closes-drawer (2026-11-17) | On a phone, Import in the learned-list drawer closes the drawer, so the import dialog shows over the page alone. Came from the owner's report on the hosted app |
| lesson-import-html (2026-11-17) | Lesson page button is **Import PDF or HTML**: `POST /api/lessons/extract-file` converts an HTML page to Markdown (`app/lesson_html.py`: headings, lists, tables, code, links to http/https/mailto only; scripts, styles, nav, forms, images dropped; page text escaped) and opens it in the editor, saved only on Save. Came from the owner's HTML file being refused by the PDF-only import. Cosmetic limits: inline chips join without a space, card titles become bold paragraphs |
| kh-connector (2026-11-17, code done; not usable until task 4.1) | Settings -> Agents has a Connections section with a Knowledge Hub card (Connect by device sign-in, Waiting, Cancel, Disconnect with confirm); table `kh_connections` (migration 0020); read-only agent tool `kh_search` (result inside `<untrusted_kh_content>`), offered only to a connected user and listed in the per-area tools; off unless `LH_KH_URL`, `LH_KH_ISSUER`, `LH_KH_CLIENT_ID` are set. Verifier: 1152 backend, 538 Vitest, 304 e2e. `agent-settings-page` was archived first |

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

1. **Agents** (owner request 2026-11-15, item 5): `agent-settings-page` shipped (see above). Umbrella `openspec/changes/agent-settings-tab/proposal.md` records the owner's decisions (2026-11-16: app tools + MCP tools per area; MCP remote HTTP/SSE on the hosted app, admin-only; Agents page as its own Settings page) and the owner's direction: the assistant as **orchestrator** picking specialist agents per area, and agent **memory** from a knowledge store (own embeddings, or KH over MCP; `kh mcp` is stdio only, so KH over MCP works only for a backend run on the owner's PC; the hosted copy needs KH's HTTP API with an app token or the app's embeddings). Next changes, not written: `mcp-servers`, `agent-orchestration`, `agent-memory`, `agent-plugins`. The owner wants to study embeddings vs KH first.
2. Verifier reports and archive for the 2026-11-13/14 changes (see above).
3. Web search with a real Anthropic key has not been tried (CI has no key). Try it on the hosted app: Settings -> Agents -> Internet search on for the lesson writer, then "Draft this lesson" on a topic of Ô tô hạng B.
4. **Knowledge Hub connector for the agent**: change `kh-connector` is built and verified (2026-11-17), all tasks done but 4.1, which is the owner's: ask a KH admin to register a Keycloak client for Learning Hub (public, device grant, PKCE, `offline_access`) and to confirm KH's API accepts tokens issued to it (not checked; if not, every search is refused until an audience mapper is added); then set `LH_KH_URL`, `LH_KH_ISSUER`, `LH_KH_CLIENT_ID` on Vercel, connect once in Settings -> Agents and run one search. Until then the card says the connector is not set up on this server. The owner's "apply" (2026-11-17) was taken as accepting: every member may connect, and the card sits in a Connections section of the Agents page. Known limit: with the Claude Code provider on a server that keeps its key in `LH_SECRET_KEY`, `kh_search` answers "connect again". KH over MCP for a backend on the owner's PC is still the unwritten change `mcp-servers`.
5. Unverified members can use the app at once; only the account menu asks them to verify.
6. Cloudflare Worker Git build is disconnected; Vercel serves the app. The old address `https://learninghub.vihc0509.workers.dev` still answers `/api/health`.
7. **Google sign-in on the hosted app** (2026-11-16): not working yet. Fixed by the owner: the client ID was saved with `http://` in front (Google: `401 invalid_client`), and `LH_PUBLIC_URL` on Vercel pointed at the workers.dev address. Left: the Google project `learninghub-514116` has two OAuth clients; the app uses **Learning Hub Web** (`…u9d3kck0…`), but the callback `https://learning-hub-petrus.vercel.app/api/auth/oauth/google/callback` is registered on **Learning Hub (Deploy)** (`…q3u50e6k…`), so Google answers `400 redirect_uri_mismatch`. Fix: add that callback to Learning Hub Web, or save the Deploy client's ID and secret in Settings -> Sign-in. Check without a browser: request Google's authorize URL with the client id and redirect URI and read the error page. Also unchecked: the consent screen must be External and In production for any Google user. Idea, not specified: Settings -> Sign-in should refuse or strip a client ID that starts with `http://`.
8. The Learned-list drag-and-drop is live, but the owner's "Agentic Engineer" note (`f16e4237…`) is still titled "chuong 1" and linked to `o-to-hang-b/chuong-1` unless the owner moved it: drag it to the right AI Engineer topic, then Rename.

## Environment notes

- Docker Desktop must run; `docker compose up -d` starts Postgres on port 5434.
- Full backend pytest (~1000 tests, ~18 min on the second PC) and full e2e (~15 min): the commit gate runs the backend and frontend suites on every commit and e2e on push, so commit in the background with a long timeout.
- **Never run two backend pytest runs at once** (two implementers, or an implementer beside the verifier): they share `learninghub_test` and deadlock on the per-test TRUNCATE (2026-11-16, KH lesson `r_01fc6d070a0c4c99`). Serialize backend tasks; Vitest runs may overlap; two Playwright runs cannot (ports 8001/8002/5174, DB `learninghub_e2e`).
- Working several OpenSpec changes in one tree at once worked (2026-11-16, four changes) with one combined verifier run at the end and one commit per change (`git add` by path); the commit gate still runs the suites on the whole tree.
- `pytest -q` prints only dots with this config; add `-rf -o addopts=""` to see the summary.
- Files are LF; agents sometimes write CRLF on Windows, check `git status` warnings before committing.
- Push: on the main PC `git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin main`; on the second PC `gh` is not installed and Git Credential Manager holds the `ViHa0509` login, so a plain `git push origin main` works.
- Unit-test flake under CPU load (2026-11-16): `Auth.test.tsx > first account is the admin > checks the form, then signs up…` types a lot and can pass the 5000 ms limit; it fails the same way without any change. Rerun before judging.
- Docker Desktop stopped by itself once on the main PC (2026-11-16): e2e then hangs at "Waiting for application startup" and Playwright times out on `config.webServer`. Check `docker info` first.
- `git stash list` on the main PC holds an old local edit of `backend/alembic/env.py`; the same fix is upstream, the stash can be dropped.
- E2E flake seen once (2026-11-17): `vercel-deploy.e2e.ts:203` (a backup larger than 4 MB) failed with `read ECONNRESET` at `:33` in one of five full runs that day; cause not found. Rerun before judging.
- A subagent resumed from its transcript view can start its own e2e or pytest run beside the main session's. Two Playwright runs fail at once on port 8001; two pytest runs give false failures. Tell agents to run checks in the foreground and never to rerun unasked.
