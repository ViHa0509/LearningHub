## Why

The chat composer has a provider dropdown ("Agent default (LH_ASSISTANT · …)"). The header already has the agent menu, so the dropdown reads as a second agent picker and confuses the user. The provider of each agent is configured under Settings → Agents.

## What Changes

- The provider dropdown is removed from the chat panel. Chat messages no longer send `provider_id`, so the agent's assigned provider (or its fallback) always answers.
- The saved per-browser provider choice (`learninghub.agent` in localStorage) is no longer read or written.
- The API still accepts `provider_id` on `POST /api/agent/chat` (other clients and tests can still name a provider for one request); only the UI control goes away.

## Capabilities

### New Capabilities

### Modified Capabilities
- `agent-chat`: the chat panel has no provider picker. The per-conversation override becomes an API-only feature.

## Impact

- Frontend: `components/agent/Composer.tsx` (or wherever the select lives), `useAgentChat.ts`, `lib/agentPrefs.ts`, tests.
- E2E: tests that used the "Provider" select change to the API or to Settings → Agents assignments.
- No backend change.
