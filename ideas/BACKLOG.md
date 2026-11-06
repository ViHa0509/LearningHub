# Idea backlog

## 2026-11-07

### Learning journal timeline
- Problem: Nothing shows what was learned and when; notes and lesson edits have dates in the database but no view over time.
- Proposal: Record journal events (note imported, note linked to a node, lesson written or edited by user or agent) in an events table, and add a `#/journal` page that lists them by day with links to the note or lesson. Filter by domain.
- Serves: Goal 3 (learning journal that shows what was learned and when)
- Size: M
- Risks: Events must be written at every mutation point; backfill for existing notes is approximate (use created_at).

### Next-topic suggestion tool for the agent
- Problem: The agent can list a roadmap with progress but has no notion of what to learn next; the user must ask and reason it out by hand.
- Proposal: Add a read-only `suggest_next` tool that, for a domain, returns unlearned nodes whose parent node has notes or a lesson, ranked by roadmap order, plus the last journal or note activity. The panel offers a "What next?" button on a roadmap page that asks the agent with this tool. Add two golden questions to the evals.
- Serves: Goal 2 (know what to learn next) and Goal 4 (agent suggests next topics)
- Size: S
- Risks: Ranking rule is simple and may feel arbitrary; keep it deterministic so evals can check it.

### Streaming agent replies
- Problem: The answer arrives whole after the full tool loop, so the panel looks frozen for several seconds with slow or local models.
- Proposal: Add `POST /api/agent/chat/stream` (Server-Sent Events) that emits tool-step events as they happen and text deltas as the provider produces them, behind the existing provider interface with a `stream` method. The panel renders steps and text incrementally and can cancel the request.
- Serves: Goal 4 (agent chat usable in daily learning) and Goal 5 (agent engineering depth)
- Size: M
- Risks: Each provider streams tool calls differently; the fake provider must script deltas for deterministic tests; cancel must stop the loop server-side.

### Provider comparison report for evals
- Problem: Evals check one provider at a time, so there is no evidence of which model does best on the golden questions or at what cost.
- Proposal: Add a script that runs the golden set across every configured provider and model and writes a Markdown report with pass rate per question, tool-call count, latency and token usage per model. Store reports in `backend/evals/reports/` so runs can be compared over time.
- Serves: Goal 5 (showcase of evals for an Agentic Engineer career)
- Size: M
- Risks: Costs money and needs keys; token usage fields differ per provider; non-deterministic answers need repeated runs or a pass-rate view.

### Review queue for past lessons
- Problem: Learning is kept but never revisited, so older topics fade even though the notes exist.
- Proposal: Track a last-reviewed date per node that has a lesson or notes, and add a `#/review` page listing nodes due on a simple expanding interval (1, 3, 7, 21, 60 days). A "Reviewed" button reschedules, and the agent gets a `quiz_me` request that asks questions from the node's lesson and notes. Reviews appear in the journal once it exists.
- Serves: Goal 1 (never lose past learning) and Goal 3 (journal of what was learned and when)
- Size: M
- Risks: Scheduling is easy to over-engineer; start with fixed intervals and no per-item ease factor. The quiz depends on the agent chat being live.

## Parking lot
