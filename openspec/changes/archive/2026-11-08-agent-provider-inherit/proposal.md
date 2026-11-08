## Why

The user set a Primary provider for the Learning assistant and expected "Draft with agent" (the Lesson writer) to use it. The Lesson writer had no assignment of its own, so it silently used the oldest active configuration instead, a different provider than the one the user just chose.

## What Changes

- An agent with no assignment of its own (neither Primary nor Fallback) uses the Learning assistant's Primary and Fallback. An agent with its own assignment keeps it, exactly as before.
- If the assistant's Primary is also missing or switched off, the first active configuration is used, as today.
- `GET /api/agents` reports the new reason `assistant` for such an agent. Settings → Agents shows "Uses <provider> (same as the Learning assistant)" so the user can see it.

## Capabilities

### New Capabilities

### Modified Capabilities
- `agent-providers`: provider resolution inherits the Learning assistant's assignment for agents without their own.

## Impact

- Backend: `app/agent/resolve.py` (resolution and fallback source), `app/routes/agents.py` (reason literal), tests.
- Frontend: `api.ts` (reason type), `SettingsPage.tsx` (the "same as" note), tests.
