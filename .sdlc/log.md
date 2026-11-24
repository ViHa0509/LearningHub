# Orchestration log

One entry per cycle, appended by `/ai-sdlc-kit:orchestrate` (or by the main session when it orchestrates by hand).

## 2026-11-07 00:10 kit-v0-2-agent-team (repo ai-sdlc-kit)
- Result: done
- Tasks: whole change (plan + build), dispatched before the kit existed
- Agents: plan and build -> general-purpose (sonnet); review of the diff -> main session (opus)
- Verdicts: `claude plugin validate .` pass, `openspec validate --strict` pass; agents not yet run live at that point
- Needs human: none (pushed and tagged v0.2.0 after review)

## 2026-11-07 00:45 slice-2-home-and-lessons
- Result: done (verification pending)
- Tasks: 1.1-4.2, 5.1
- Agents: specs, design, all tasks -> main session (opus); UI check -> qc-ui (sonnet)
- Verdicts: qc-ui pass with 5 minor findings; 3 fixed (dark map controls, unreadable start zoom, no list loading state), 2 kept as polish (card icons, link styles)
- Needs human: none

## 2026-11-07 01:40 slice-3-agent-chat
- Result: done (verification pending)
- Tasks: 1.1-3.2, 4.1
- Agents: specs, design, provider adapters, tools and prompt (security-sensitive) -> main session (opus)
- Verdicts: checks green locally; verifier run on slices 2 and 3 together -> see the changes' evidence.md
- Needs human: an LLM API key in backend/.env to use the agent and run `pytest evals -m live`

## 2026-11-07 01:45 none (ideas)
- Result: done
- Tasks: none
- Agents: brainstormer (sonnet) -> ideas/BACKLOG.md
- Verdicts: not applicable
- Needs human: pick ideas to promote with /opsx:propose

## 2026-11-12 23:55 vercel-deploy
- Result: partial (18/24; the rest needs a real Vercel deployment)
- Tasks: 1.1, 2.1-2.3, 3.1-3.2, 4.1-4.4, 5.1-5.3, 6.1-6.2, 7.1-7.2, 8.1
- Agents: specs, design, migration, sign-in store, sync uploads, jobs -> main session; 2.3, 4.4, 5.1, 7.1 -> implementer (sonnet); e2e -> qc-e2e (sonnet)
- Verdicts: backend pytest 750 pass, ruff, mypy pass; frontend 326 tests, lint, build pass; qc-e2e pass (160 tests, no product bug; one auth test flaked once)
- Needs human: Vercel import and preview deploy (1.2), production values and GitHub secrets (8.2), go-live check (8.3); decision on the visitor address behind the Worker (7.3)

## 2026-11-13 04:30 vercel-deploy (go-live) and responsive-layout
- Result: vercel-deploy 20/24 (live on Vercel behind the Worker; data synced); responsive-layout done (12/12)
- Tasks: vercel-deploy 1.2, 7.4; responsive-layout 1.1-5.4
- Agents: responsive 1.1, 2.1-2.3, 3.1, 4.1-4.3 -> implementer (sonnet); 5.2 -> qc-e2e; 5.3 -> qc-ui; 5.4 -> verifier; fixes after QC, Vercel project settings, bucket, Worker origin -> main session
- Verdicts: verifier pass (backend 751, frontend 358, e2e 202); qc-e2e 2 bugs fixed; qc-ui 3 defects fixed, 1 minor left
- Needs human: two GitHub secrets for CI deploys; provider keys and OAuth sign-in on the hosted copy; vercel-deploy 7.3, 8.2-8.4

## 2026-11-22 01:30 a2ui-lab-playground
- Result: done (14/14)
- Tasks: 1.1-1.2, 2.1-2.5, 3.1-3.4, 4.1-4.3
- Agents: 1.1, 1.2 (spike), 2.2, 2.3 (media guard, Markdown) -> main session (opus, security); 2.1, 2.4-2.5, 3.1-3.2, 3.3-3.4, UI fixes -> implementer (sonnet); 4.1 -> qc-e2e (sonnet); 4.2 -> qc-ui (sonnet); 4.3 -> verifier (sonnet)
- Verdicts: qc-e2e pass (rounds: 3; 1 product bug fixed: javascript: link rendered as an empty-href anchor; full suite 324 passed, 0 failed, 33 skipped), verifier pass (second run; first failed on an untested "Not signed in" scenario), qc-ui pass (5 minors fixed, 1 cosmetic left in evidence.md)
- Needs human: none. Accepted: zod 3.25.76 advisory GHSA-mrhx-c7xc-m3w5 (no zod 3 fix; mitigated by the input size limit)

## 2026-11-22 a2ui-chat-agent
- Result: done (18/18)
- Tasks: 1.1-1.4, 2.1-2.5, 3.1, 4.1-4.3, 5.1-5.3, 6.1-6.2
- Agents: 1.1 (migration), 2.3 (runner, nested agent run, count rule), 3.1 (grading route), interface contract -> main session (opus, security); 1.2-1.4, 2.1-2.2, 2.4-2.5, 6.1, template fixes -> implementer (sonnet); 4.1-4.3, UI fixes -> implementer (sonnet); 5.1 -> implementer (sonnet); 5.2 -> qc-e2e (sonnet); 5.3 -> qc-ui (sonnet); 6.2 -> verifier (sonnet)
- Verdicts: qc-e2e pass (rounds: 4; fixed a fake-LLM trigger catching the /quiz skill and the correct-option marking; final 379 passed, 0 failed), verifier pass, qc-ui pass (dark Check button colour left in evidence.md)
- Needs human: none. Two full runs were stopped by low memory and rerun alone with the owner's go-ahead. A conflict-retry gap (surfaces lost on store_turn rollback) was found and fixed with a test.

## 2026-11-23 partly done changes, agent-stop, settings-tabs rewrite
- Result: agent-learned-notes, learning-fields, practice-exams, chat-session-history, ci-cd done; agent-stop done (9/9); settings-tabs specs rewritten for admin + members (0/10, waits for owner review)
- Tasks: agent-learned-notes 3.1-3.2; learning-fields 4.1-4.2; practice-exams 3.1-3.2; chat-session-history 6.2-6.3; ci-cd 3.2 (workflow already in the repo, box was unticked); agent-stop 1.1-3.3
- Agents: e2e of the four changes -> qc-e2e (sonnet); chat-history dark contrast fixes, ci-cd 3.2, agent-stop 2.1-2.2 and backend tests -> implementer (sonnet); qc-ui x3; settings-tabs state -> scout (haiku); agent-stop spec, migration 0024 and stop path, settings-tabs rewrite -> main session (opus)
- Verdicts: qc-e2e pass (no product bugs), qc-ui pass (cosmetic items in evidence.md), verifier pass on the final run (pytest 1311, vitest 712, e2e 381). Two earlier verifier runs failed because agent-stop work was edited in the same tree during the run (conftest TRUNCATE list, a test stub)
- Needs human: review settings-tabs; vercel-deploy 7.3, 8.2-8.4; anthropic-web-search 3.1 (real key); kh-connector 4.1 (KH admin)

## 2026-11-23 settings-tabs done; notifications next
- State: settings-tabs code, e2e (3.1) and qc-ui (3.2) done, UNCOMMITTED in the working tree; only 3.3 (verifier) open. notifications planned and approved (committed in d935759), not started.
- Last verifier run: every check passed except full e2e (2 of 400): auth.e2e.ts stale menu expectation, and agent-chat effort not remembered (account default overrode the browser pick). Both fixed, plus avatar file left on member delete (fixed, tested). A re-verification started at ~18:00 stalled (agent watchdog, no report); no stray test processes were left. Run the verifier again.
- Resume: 1) `docker compose up -d`; `cd backend && .venv/Scripts/alembic upgrade head` (dev DB needs 0025). 2) Run `ai-sdlc-kit:verifier` on settings-tabs (all CLAUDE.md checks + `openspec validate settings-tabs --type change --strict`); paste its report into openspec/changes/settings-tabs/verifier-report.md, tick 3.3. 3) Commit and push to main. 4) Start notifications: 1.1 (migration + notify helper) is main-session work; then 1.2-1.5 backend and 2.1 frontend to implementers; 3.x QC; verifier; commit; push.
- Push note: plain `git push` gets 403 (Windows credential manager holds the petrus-ha login). Push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin main`, or run `gh auth setup-git` once.
- Lessons from today: never run the verifier while agents edit the same tree; a responsive e2e run clears the screenshot folder, so run all screenshot files in one e2e command before qc-ui.

- Update: settings-tabs verifier pass on resume (pytest 1345, vitest 750, e2e 400); committed and pushed. Next: notifications (1.1 main session).

## 2026-11-24 notifications
- Result: done (9/9); settings-tabs pushed earlier the same session (55f1460)
- Tasks: 1.1-1.5, 2.1, 3.1-3.3
- Agents: 1.1 (migration 0026, notify helper), new-sign-in gap fix, spec corrections -> main session (opus); 1.2-1.5, 2.1, phone top-bar fix, Lab link in the avatar menu -> implementer (sonnet); 3.1 -> qc-e2e; 3.2 -> qc-ui; 3.3 -> verifier
- Verdicts: qc-e2e 1 product bug (bell widened the phone top bar) fixed; qc-ui pass (cosmetics in evidence.md); verifier pass (pytest 1379, vitest 762, e2e 412)
- Spec changes during the work: provider notices follow the real error categories (auth_failed never falls back, no quota category, none for the shared provider); published field opens the home page; new requirement "Bell on a phone" (A2UI Lab moves into the avatar menu under 640 px); new sign-in after "log out everywhere" still notifies
- Needs human: none

## 2026-11-24 unsorted-categories
- Result: done (8/8)
- Tasks: 1.1-1.4, 2.1, 3.1-3.3
- Agents: 1.1 migration and review fixes (title in untrusted wrapper, no count with nothing to sort) -> main session; 1.2-1.4 -> implementer; 2.1 -> implementer; qc-e2e, qc-ui, verifier
- Verdicts: qc-e2e 9/9 (full run: 1 known clock flake in notifications, passed alone); qc-ui pass after touch-size fix; verifier pass
