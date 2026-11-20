# Design

## Context

- `SettingsPage.tsx` lists the user's own configurations as `ProviderCard` articles. For a member in shared mode with no configuration it renders `sharedLine(p)` paragraphs and `usageLine(shared)`.
- `sharedProviders(useAgents().data)` in `lib/shared.ts` gives the distinct shared `ProviderRef`s the member's agents run on; `useSharedStatus()` gives `mode`, `used_today`, `daily_limit`, `withdrawn`.
- The admin's card shows `<span className="tag shared">Shared</span>`.

## Decisions

1. **Frontend only.** Everything the card needs is already in `ProviderRef` (name, model_name) and `SharedStatus`. No route, no field.
2. **`SharedProviderCard`** in `SettingsPage.tsx`: `<article className="provider-card shared-card" aria-label={name}>` inside the same `.provider-cards` list, before the user's own cards. Header: `<h2>` with the name as plain text (no `<a>`), then `<span className="tag shared">Public</span>`. Body: the model name, "Shared by the admin", and `usageLine(shared)`. It never renders `id`, `provider_type`, a status badge or any control.
3. **When.** Rendered for every entry of `sharedProviders(...)` while `shared.mode === 'shared'`, whatever the number of own configurations (a member can have only inactive ones and still run shared). The old paragraphs with `sharedLine` on this page go; `sharedLine` stays for the Agents page.
4. **Tag text.** The admin's tag becomes "Public"; the class name `tag shared` stays. The checkbox label "Shared with all users" stays.
5. **Tests.** Vitest in `SharedProviders.test.tsx`: admin tag is "Public"; member in shared mode sees the article with name, model, Public, "Shared by the admin", usage, and no link/button inside; a member with an own active configuration sees no Public entry; withdrawn shows the warning and no entry. Existing assertions on the text "Shared" badge change to "Public" (the word changed in the spec; nothing else is loosened). E2E the same in `shared-providers.e2e.ts`.

## Risks

- A test or e2e step that finds the shared provider by the old text line breaks: it is updated to the card, keeping what it proves (the member sees name and model, and nothing secret).
