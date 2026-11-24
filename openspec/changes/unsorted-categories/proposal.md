## Why

Notes that fit no roadmap topic all land in one long "Unsorted" group in the Learned list, so it gets messy as the agent and imports add more. The owner asked (2026-11-24) to split Unsorted into several groups with fitting names, by an AI button, and for the agent to pick a category itself when it saves a note without a topic.

## What Changes

- A note gets an optional **category** (short name, at most 40 characters). It matters only while the note is unsorted; linking it to a topic keeps the category but the list shows the note under the topic.
- The **Unsorted** group in the Learned list shows one sub-group per category (name as heading, newest group first) and an **Other** sub-group last for unsorted notes without a category.
- A **Group with AI** button on the Unsorted heading: the new agent **Note sorter** reads the titles and the start of the text of the user's unsorted notes and gives each a category, reusing existing category names when they fit. One model call per click; it counts toward the shared daily limit like a chat request. The user can run it again at any time; it re-groups every unsorted note.
- **Rename a group**: a rename action on a category heading (Save and Cancel) renames that category on all of the user's notes.
- The **learning assistant** gives a category when it saves a note without a topic (`save_learned_note`), reusing an existing name when one fits.
- Backups carry the category; older backups restore with no category.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `learning-views`: Learned-items list groups Unsorted by category; Group with AI; rename a group.
- `agent-chat`: the assistant's saved unsorted note gets a category; the Note sorter agent.

## Impact

- Backend: migration `0027` adds `notes.category` (nullable, additive); `NoteOut.category`; `POST /api/notes/categorize`; `POST /api/notes/categories/rename`; `AgentDef` `note-sorter` (provider assignable in Settings > Agents); `save_learned_note` gets `category`; backup `NoteRow.category`.
- Frontend: `LearnedList` Unsorted sub-groups, button, rename; `grouping.ts`; `api.ts`.
- Tests: pytest (parsing of the model answer, isolation, limits, tool), Vitest, e2e with the fake LLM.
