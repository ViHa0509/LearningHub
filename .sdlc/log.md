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
