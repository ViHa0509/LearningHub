# Shared provider configurations

## Why

Every user must add a provider configuration with their own API key before any agent answers. The owner wants to mark a configuration as public so that other users can use the agents without adding a key, and keep the others private.

## Owner's decisions (2026-11-19)

1. Share the provider (key, model) and the agent configuration.
2. Public means every signed-in user.
3. Only the admin sets public or private.
4. The key never leaves the server; other users see the name and model only.
5. Each user gets 10 uses a day; after that the request is refused with a limit message.
6. When the admin stops sharing, the right to use it ends and the user falls back to their own configurations. For now the user is told by a warning icon at the provider; a notification feature is not built (changed by the owner the same day).
7. The admin has full rights and no limit; the count is for other users only, one per message sent to an agent.
8. A user sees the shared agent setup read-only.

Reading of "agent configuration" (main session, to be confirmed in review): which shared configuration each agent uses (primary and fallback) and each agent's Internet search switch, as the admin set them. Per-area tool settings are not shared: areas belong to each user.

## What changes

- A provider configuration gains a **Shared with all users** switch. Only the admin can share, and never a Claude Code configuration. A configuration is private unless shared.
- A user with no active configuration of their own runs each agent as the admin set it up, on the shared configurations: the admin's primary and fallback for that agent when they are shared, and the admin's Internet search switch. A user's own configurations always win.
- Other users never see the key, its hint, the base URL or the parameters of a shared configuration: only its name and model. In the app they are shown only the name and model; the API reference a member receives also carries the configuration id and provider type, which open nothing for a member (every route that takes the id answers 404).
- Each agent request on a shared configuration counts against that user's 10 requests a day (UTC); over the limit the request is refused with a clear message. The admin's own use is not counted.
- **Withdrawn warning**: when the shared configurations a user ran on are no longer available (unshared, switched off or deleted) and the user has none of their own, a warning icon with an explanation shows where the provider is shown (Settings -> Agents, the providers page, the chat's provider hint).
- The shared agent setup is read-only for the user.

## Not in this change

- Sharing with chosen users only, or sharing by a member.
- Letting a user who has their own configuration pick the shared one for an agent.
- Token or cost accounting; the limit counts requests.
- A limit the admin edits in the app (it is the server setting `LH_SHARED_DAILY_LIMIT`, 10 by default).
- Notifications (a bell, email, push).
- Copying the admin's agent setup into a user's own settings: a user who adds a key sets up their agents as today.

## Impact

- Specs: `ai-providers` (new requirement), `agent-providers` (resolution changed; new requirements for the shared setup, the limit and the warning).
- Backend: migration `0021` (`ai_providers.shared`, table `shared_usage`), `app/config.py`, `app/agent/resolve.py`, `app/routes/ai_providers.py`, `app/routes/agents.py`, the routes that run an agent.
- Frontend: provider form and list, Settings -> Agents, the "no provider" hints with the warning.
- Money: every signed-up user can spend the admin's key up to the daily limit, and sign-up is open on the hosted app.
