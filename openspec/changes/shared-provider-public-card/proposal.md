# Proposal

## Why

A member who runs on the admin's shared provider sees it only as one line of text on Settings > AI providers ("Uses Claude main (…), shared by the admin"). The owner wants it to look like what it is: one more provider in the list, with the status Public. The admin's own list says "Shared" for the same thing, so the two words are made one.

## What Changes

- Settings > AI providers, for a member in shared mode: each shared provider the member's agents run on is a card in the provider list, with the name, the model, a **Public** tag, "Shared by the admin" and today's usage ("3 of 10 requests used today"). The card is read-only: no link, no Test, no edit, no key hint, no type, no base URL.
- The admin's provider list shows the tag **Public** (was "Shared") on a shared configuration. The checkbox "Shared with all users" keeps its label.
- The text line that showed the shared provider is replaced by the card. The hint "You have no provider of your own yet. Add one to use your own key instead of the shared one." stays.
- A member who has a usable provider of their own does not run on the shared one and sees no Public card (unchanged: the app tells a member about a shared provider only while they run on it).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `ai-providers`: how a shared configuration is shown to the admin (Public tag) and to a member in shared mode (a read-only Public card).

## Impact

- Frontend only: `src/components/SettingsPage.tsx`, `src/lib/shared.ts`, styles in `src/index.css`, tests in `src/components/SharedProviders.test.tsx`; e2e `e2e/shared-providers.e2e.ts` (the badge name and the member's card).
- `openspec/changes/shared-providers/specs/ai-providers/spec.md` (not archived yet): the scenario "Admin shares" says "Public badge".
- No backend change, no migration, no new API field.
