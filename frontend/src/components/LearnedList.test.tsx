/** Spec: learning-views - Learned-items list. */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { groupNotes } from '../lib/grouping'
import { backend, devops, installFakeApi, makeNote } from '../test/fakeApi'
import { renderApp } from '../test/render'
import { LearnedList } from './LearnedList'

const noop = () => {}

function renderList(notes = sample()) {
  return render(
    <LearnedList
      notes={notes}
      roadmaps={[backend, devops]}
      selectedNoteId={null}
      selectedNodeId={null}
      onOpenNote={noop}
      onImport={noop}
    />,
  )
}

function sample() {
  return [
    makeNote('Redis eviction', 'backend/caching'),
    makeNote('GitHub Actions', 'devops/ci-cd'),
    makeNote('Loose research'),
  ]
}

describe('LearnedList', () => {
  it('groups notes by domain and node, with an Unsorted group', () => {
    renderList()
    const caching = screen.getByRole('group', { name: 'Backend > Caching' })
    expect(within(caching).getByRole('button', { name: 'Redis eviction' })).toBeInTheDocument()
    const cicd = screen.getByRole('group', { name: 'DevOps > CI/CD' })
    expect(within(cicd).getByRole('button', { name: 'GitHub Actions' })).toBeInTheDocument()
    const unsorted = screen.getByRole('region', { name: 'Unsorted' })
    expect(within(unsorted).getByRole('button', { name: 'Loose research' })).toBeInTheDocument()
  })

  it('puts notes linked to a missing node under Unsorted', () => {
    renderList([makeNote('Old SOAP note', 'backend/soap', { node_missing: true })])
    const unsorted = screen.getByRole('region', { name: 'Unsorted' })
    expect(within(unsorted).getByText('missing node')).toBeInTheDocument()
  })

  it('filters by title, case-insensitively', async () => {
    const user = userEvent.setup()
    renderList([makeNote('Redis eviction', 'backend/caching'), makeNote('REDIS streams'), makeNote('JWT', 'backend/auth')])
    await user.type(screen.getByRole('searchbox', { name: 'Filter by title' }), 'redis')
    expect(screen.getByRole('button', { name: 'Redis eviction' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'REDIS streams' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'JWT' })).not.toBeInTheDocument()
  })

  it('shows the empty state with an import button when there are no notes', async () => {
    const onImport = vi.fn()
    render(
      <LearnedList notes={[]} roadmaps={[backend]} selectedNoteId={null} selectedNodeId={null}
        onOpenNote={noop} onImport={onImport} />,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Import HTML or PDF files' }))
    expect(onImport).toHaveBeenCalled()
  })
})

describe('groupNotes', () => {
  it('orders nodes in roadmap order (depth-first, sibling order)', () => {
    const notes = [makeNote('auth', 'backend/auth'), makeNote('redis', 'backend/redis'), makeNote('caching', 'backend/caching')]
    const grouped = groupNotes(notes, [backend])
    expect(grouped.domains[0].nodes.map((g) => g.node.id)).toEqual(['caching', 'redis', 'auth'])
  })

  // Scenario: Newest first
  it('orders by last update: notes, then nodes, then domains; Unsorted last and newest first', () => {
    const at = (day: number) => ({ updated_at: `2026-11-0${day}T00:00:00Z` })
    const notes = [
      makeNote('caching old', 'backend/caching', at(2)),
      makeNote('apis today', 'backend/apis', at(5)),
      makeNote('caching new', 'backend/caching', at(3)),
      makeNote('ci yesterday', 'devops/ci-cd', at(6)),
      makeNote('loose old', null, at(1)),
      makeNote('loose new', null, at(7)),
    ]
    const grouped = groupNotes(notes, [backend, devops])
    expect(grouped.domains.map((d) => d.domainId)).toEqual(['devops', 'backend'])
    const nodes = grouped.domains[1].nodes
    expect(nodes.map((g) => g.node.id)).toEqual(['apis', 'caching'])
    expect(nodes[1].notes.map((n) => n.title)).toEqual(['caching new', 'caching old'])
    expect(grouped.unsorted).toHaveLength(1)
    expect(grouped.unsorted[0].category).toBeNull()
    expect(grouped.unsorted[0].notes.map((n) => n.title)).toEqual(['loose new', 'loose old'])
  })

  it('shows Backend > APIs before Backend > Caching when APIs was updated more recently', () => {
    renderList([
      makeNote('caching', 'backend/caching', { updated_at: '2026-11-05T00:00:00Z' }),
      makeNote('apis', 'backend/apis', { updated_at: '2026-11-06T00:00:00Z' }),
    ])
    const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))
    expect(groups).toEqual(['Backend > APIs', 'Backend > Caching'])
  })
})

describe('agent badge', () => {
  it('marks a note the agent saved, and only that note', () => {
    renderList([
      makeNote('gRPC', 'backend/apis', { source: 'agent' }),
      makeNote('Redis eviction', 'backend/caching'),
    ])
    const saved = screen.getByRole('button', { name: /^gRPC/ })
    expect(within(saved).getByText('agent')).toBeInTheDocument()
    const imported = screen.getByRole('button', { name: 'Redis eviction' })
    expect(within(imported).queryByText('agent')).not.toBeInTheDocument()
  })
})

describe('LearnedList actions', () => {
  const when = '2026-11-07T00:00:00Z'

  async function setup(notes = sample()) {
    const state = installFakeApi(notes)
    const view = renderApp()
    const first = notes[0]
    await screen.findByRole('button', { name: first.archived_at ? /^Archived/ : first.title })
    return { ...view, state }
  }
  const more = (title: string) => screen.getByRole('button', { name: `More actions for ${title}` })
  const patches = (state: { calls: { method: string; body?: unknown }[] }) =>
    state.calls.filter((c) => c.method === 'PATCH').map((c) => c.body)

  it('opens a menu with Rename, Move to node and Archive, and Escape returns focus', async () => {
    const { user } = await setup()
    const trigger = more('Redis eviction')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    await user.click(trigger)
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Rename',
      'Move to node',
      'Archive',
    ])
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes the menu on an outside click, and a click on the title still opens the note', async () => {
    const { user } = await setup()
    await user.click(more('Redis eviction'))
    await user.click(screen.getByRole('searchbox', { name: 'Filter by title' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Redis eviction' }))
    expect(await screen.findByRole('article', { name: 'Note: Redis eviction' })).toBeInTheDocument()
  })

  it('renames from the list with Enter and cancels with Escape', async () => {
    const { user, state } = await setup()
    await user.click(more('Redis eviction'))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'New title' })
    await user.clear(input)
    await user.type(input, 'Redis TTL{Enter}')
    expect(await screen.findByRole('button', { name: 'Redis TTL' })).toBeInTheDocument()
    expect(patches(state)).toEqual([{ title: 'Redis TTL' }])

    await user.click(more('Redis TTL'))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    await user.type(screen.getByRole('textbox', { name: 'New title' }), ' extra{Escape}')
    expect(screen.queryByRole('textbox', { name: 'New title' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Redis TTL' })).toBeInTheDocument()
    expect(patches(state)).toHaveLength(1)
  })

  it('renames with the Save button and cancels with the Cancel button', async () => {
    const { user, state } = await setup()
    await user.click(more('Redis eviction'))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const form = screen.getByRole('form', { name: 'Rename Redis eviction' })
    const save = within(form).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    const input = within(form).getByRole('textbox', { name: 'New title' })
    await user.clear(input)
    expect(save).toBeDisabled()
    await user.type(input, 'Redis TTL')
    expect(save).toBeEnabled()
    await user.click(save)
    expect(await screen.findByRole('button', { name: 'Redis TTL' })).toBeInTheDocument()
    expect(patches(state)).toEqual([{ title: 'Redis TTL' }])

    await user.click(more('Redis TTL'))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    await user.type(screen.getByRole('textbox', { name: 'New title' }), ' extra')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'New title' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Redis TTL' })).toBeInTheDocument()
    expect(patches(state)).toHaveLength(1)
  })

  it('keeps the rename open when focus leaves the field', async () => {
    const { user } = await setup()
    await user.click(more('Redis eviction'))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    await user.type(screen.getByRole('textbox', { name: 'New title' }), ' v2')
    await user.click(screen.getByRole('searchbox', { name: 'Filter by title' }))
    expect(screen.getByRole('textbox', { name: 'New title' })).toHaveValue('Redis eviction v2')
  })

  it('makes no call for a blank or unchanged title', async () => {
    const { user, state } = await setup()
    await user.click(more('Redis eviction'))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    await user.type(screen.getByRole('textbox', { name: 'New title' }), '{Enter}')
    await user.click(more('Redis eviction'))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    await user.clear(screen.getByRole('textbox', { name: 'New title' }))
    await user.type(screen.getByRole('textbox', { name: 'New title' }), '   {Enter}')
    expect(patches(state)).toEqual([])
  })

  it('moves a note from Unsorted to a node', async () => {
    const { user, state } = await setup()
    await user.click(more('Loose research'))
    await user.click(screen.getByRole('menuitem', { name: 'Move to node' }))
    const dialog = screen.getByRole('dialog', { name: 'Move to node' })
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Destination node' }), 'backend/redis')
    await user.click(within(dialog).getByRole('button', { name: 'Move' }))
    const redis = await screen.findByRole('group', { name: 'Backend > Redis' })
    expect(within(redis).getByRole('button', { name: 'Loose research' })).toBeInTheDocument()
    expect(patches(state)).toEqual([{ node_id: 'backend/redis' }])
  })

  it('moves a note to Unsorted with node_id null', async () => {
    const { user, state } = await setup()
    await user.click(more('Redis eviction'))
    await user.click(screen.getByRole('menuitem', { name: 'Move to node' }))
    const dialog = screen.getByRole('dialog', { name: 'Move to node' })
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Destination node' }), 'Unsorted')
    await user.click(within(dialog).getByRole('button', { name: 'Move' }))
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Unsorted' })).getByRole('button', { name: 'Redis eviction' }),
      ).toBeInTheDocument(),
    )
    expect(patches(state)).toEqual([{ node_id: null }])
  })

  it('archives at once, counts it in Archived, lists it when expanded, and Undo restores it', async () => {
    const { user, state } = await setup()
    expect(screen.queryByRole('button', { name: /^Archived/ })).not.toBeInTheDocument()
    await user.click(more('Redis eviction'))
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }))
    expect(patches(state)).toEqual([{ archived: true }])
    expect(await screen.findByText(/^Archived ‘Redis eviction’\./)).toHaveTextContent('Archived ‘Redis eviction’. Undo')
    expect(screen.queryByRole('group', { name: 'Backend > Caching' })).not.toBeInTheDocument()

    const disclosure = await screen.findByRole('button', { name: 'Archived (1)' })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Restore Redis eviction' })).not.toBeInTheDocument()
    await user.click(disclosure)
    expect(screen.getByRole('button', { name: 'Restore Redis eviction' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByRole('group', { name: 'Backend > Caching' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Archived/ })).not.toBeInTheDocument()
    expect(patches(state)).toEqual([{ archived: true }, { archived: false }])
  })

  it('restores from the Archived section', async () => {
    const { user } = await setup([
      makeNote('Redis eviction', 'backend/caching'),
      makeNote('Old JWT', 'backend/auth', { archived_at: when }),
    ])
    await user.click(await screen.findByRole('button', { name: 'Archived (1)' }))
    expect(screen.queryByRole('group', { name: 'Backend > Auth' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Restore Old JWT' }))
    const auth = await screen.findByRole('group', { name: 'Backend > Auth' })
    expect(within(auth).getByRole('button', { name: 'Old JWT' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Archived/ })).not.toBeInTheDocument()
  })

  it('deletes from the Archived section only after confirmation', async () => {
    const { user, state } = await setup([
      makeNote('Redis eviction', 'backend/caching'),
      makeNote('Old JWT', 'backend/auth', { archived_at: when }),
    ])
    await user.click(await screen.findByRole('button', { name: 'Archived (1)' }))
    await user.click(screen.getByRole('button', { name: 'Delete Old JWT' }))
    expect(state.calls.some((c) => c.method === 'DELETE')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(state.calls.some((c) => c.method === 'DELETE')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Delete Old JWT' }))
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(state.calls.some((c) => c.method === 'DELETE')).toBe(true))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Archived/ })).not.toBeInTheDocument())
  })

  it('applies the title filter to archived notes', async () => {
    const { user } = await setup([
      makeNote('Redis eviction', 'backend/caching'),
      makeNote('Old redis notes', null, { archived_at: when }),
      makeNote('Old JWT', 'backend/auth', { archived_at: when }),
    ])
    await user.click(await screen.findByRole('button', { name: 'Archived (2)' }))
    await user.type(screen.getByRole('searchbox', { name: 'Filter by title' }), 'redis')
    expect(screen.getByRole('button', { name: 'Old redis notes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Old JWT' })).not.toBeInTheDocument()
  })

  it('opens an archived note when its title is clicked', async () => {
    const { user } = await setup([
      makeNote('Redis eviction', 'backend/caching'),
      makeNote('Old JWT', 'backend/auth', { archived_at: when }),
    ])
    await user.click(await screen.findByRole('button', { name: 'Archived (1)' }))
    await user.click(screen.getByRole('button', { name: 'Old JWT' }))
    expect(await screen.findByText('This note is archived.')).toBeInTheDocument()
  })

  it('keeps the Archived section reachable when no active note is left', async () => {
    const { user } = await setup([makeNote('Old JWT', 'backend/auth', { archived_at: when })])
    expect(await screen.findByText('Nothing learned yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Archived (1)' }))
    expect(screen.getByRole('button', { name: 'Old JWT' })).toBeInTheDocument()
  })
})

describe('LearnedList drag and drop', () => {
  const transfer = () => ({ setData: vi.fn(), getData: vi.fn(() => ''), effectAllowed: '', dropEffect: '' })
  const patches = (state: { calls: { method: string; body?: unknown }[] }) =>
    state.calls.filter((c) => c.method === 'PATCH').map((c) => c.body)
  // A prefix match: a note with a missing node carries a tag in its button's name.
  const row = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title}`) }).closest('li') as HTMLElement
  const status = () => within(screen.getByRole('complementary', { name: 'Learned items' })).queryByRole('status')
  const group = (name: string) => screen.getByRole('group', { name })
  const unsorted = () => screen.getByRole('region', { name: 'Unsorted' })

  async function setup(notes = sample()) {
    const state = installFakeApi(notes)
    const view = renderApp()
    await screen.findByRole('button', { name: new RegExp(`^${notes[0].title}`) })
    return { ...view, state }
  }

  /** Starts a drag the way the browser does and waits for the deferred state. */
  async function startDrag(title: string, dataTransfer = transfer()) {
    fireEvent.dragStart(row(title), { dataTransfer })
    await screen.findAllByText('Drop here')
    return dataTransfer
  }

  const drop = (target: HTMLElement) => {
    const dataTransfer = transfer()
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })
  }

  // Scenario: Topics without notes appear while dragging
  it('shows the topics without notes and Unsorted while dragging, and hides them when the drag ends', async () => {
    renderList([makeNote('Redis eviction', 'backend/caching'), makeNote('GitHub Actions', 'devops/ci-cd')])
    expect(screen.queryByRole('region', { name: 'Unsorted' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Backend > Redis' })).not.toBeInTheDocument()

    const data = transfer()
    fireEvent.dragStart(row('Redis eviction'), { dataTransfer: data })
    expect(data.setData).toHaveBeenCalledWith('application/x-learninghub-note', expect.any(String))
    expect(data.effectAllowed).toBe('move')
    await screen.findByRole('group', { name: 'Backend > Redis' })
    const names = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))
    expect(names.indexOf('Backend > Caching')).toBeLessThan(names.indexOf('Backend > Redis'))
    expect(within(group('Backend > Redis')).getByText('Drop here')).toBeInTheDocument()
    expect(within(unsorted()).getByText('Drop here')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Frontend' })).not.toBeInTheDocument()

    fireEvent.dragEnd(row('Redis eviction'))
    expect(screen.queryByRole('group', { name: 'Backend > Redis' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Unsorted' })).not.toBeInTheDocument()
  })

  it('does not start a drag state when the drag ends before the deferred tick', () => {
    vi.useFakeTimers()
    try {
      renderList()
      fireEvent.dragStart(row('Redis eviction'), { dataTransfer: transfer() })
      fireEvent.dragEnd(row('Redis eviction'))
      vi.runAllTimers()
      expect(screen.queryByText('Drop here')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  // Scenario: Drop a note on a topic, Undo a drop
  it('drops a note on a topic, says so with Undo, and Undo links it back', async () => {
    const { user, state } = await setup()
    await startDrag('Redis eviction')
    drop(group('Backend > Redis'))
    expect(await screen.findByText(/^Moved ‘Redis eviction’ to Redis\./)).toHaveTextContent(
      'Moved ‘Redis eviction’ to Redis. Undo',
    )
    expect(patches(state)).toEqual([{ node_id: 'backend/redis' }])
    expect(within(await screen.findByRole('group', { name: 'Backend > Redis' })).getByRole('button', { name: 'Redis eviction' })).toBeInTheDocument()
    expect(screen.queryByText('Drop here')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(within(screen.getByRole('group', { name: 'Backend > Caching' })).getByRole('button', { name: 'Redis eviction' })).toBeInTheDocument(),
    )
    expect(patches(state)).toEqual([{ node_id: 'backend/redis' }, { node_id: 'backend/caching' }])
    expect(screen.queryByText(/^Moved/)).not.toBeInTheDocument()
  })

  it('highlights the topic under the pointer and clears it when the pointer leaves', async () => {
    await setup()
    await startDrag('Redis eviction')
    const redis = group('Backend > Redis')
    fireEvent.dragOver(redis, { dataTransfer: transfer() })
    expect(redis).toHaveClass('drop-target')
    fireEvent.dragLeave(redis, { dataTransfer: transfer() })
    expect(redis).not.toHaveClass('drop-target')
  })

  // Scenario: Drop on Unsorted
  it('drops a linked note on Unsorted and sends node_id null', async () => {
    const { state } = await setup()
    await startDrag('Redis eviction')
    drop(unsorted())
    expect(await screen.findByText(/^Moved ‘Redis eviction’ to Unsorted\./)).toBeInTheDocument()
    expect(patches(state)).toEqual([{ node_id: null }])
    await waitFor(() => expect(within(unsorted()).getByRole('button', { name: 'Redis eviction' })).toBeInTheDocument())
  })

  // Scenario: Drop on the note's own topic
  it('accepts no drop on the own topic: no preventDefault, no save, no Undo line', async () => {
    const { state } = await setup()
    await startDrag('Redis eviction')
    const own = group('Backend > Caching')
    // dispatchEvent answers false when a handler called preventDefault.
    expect(fireEvent.dragOver(own, { dataTransfer: transfer() })).toBe(true)
    expect(fireEvent.dragOver(group('Backend > Redis'), { dataTransfer: transfer() })).toBe(false)
    fireEvent.drop(own, { dataTransfer: transfer() })
    expect(patches(state)).toEqual([])
    expect(status()).not.toBeInTheDocument()
  })

  it('treats Unsorted as the place of an unlinked note and of a missing-node note', async () => {
    const { state } = await setup([
      makeNote('Loose research'),
      makeNote('Old SOAP note', 'backend/soap', { node_missing: true }),
      makeNote('Redis eviction', 'backend/caching'),
    ])
    await startDrag('Loose research')
    expect(fireEvent.dragOver(unsorted(), { dataTransfer: transfer() })).toBe(true)
    drop(unsorted())
    fireEvent.dragEnd(row('Loose research'))
    expect(patches(state)).toEqual([])

    await startDrag('Old SOAP note')
    expect(fireEvent.dragOver(unsorted(), { dataTransfer: transfer() })).toBe(true)
    expect(fireEvent.dragOver(group('Backend > Caching'), { dataTransfer: transfer() })).toBe(false)
  })

  it('ignores a drop when no drag of this list is in progress', async () => {
    const { state } = await setup()
    const foreign = transfer()
    foreign.getData.mockReturnValue('some-note-id')
    const target = group('Backend > Caching')
    expect(fireEvent.dragOver(target, { dataTransfer: foreign })).toBe(true)
    fireEvent.drop(target, { dataTransfer: foreign })
    expect(patches(state)).toEqual([])
  })

  it('shows no Undo button after moving a note whose node is missing', async () => {
    const { state } = await setup([
      makeNote('Old SOAP note', 'backend/soap', { node_missing: true }),
      makeNote('Redis eviction', 'backend/caching'),
    ])
    await startDrag('Old SOAP note')
    drop(group('Backend > Redis'))
    expect(await screen.findByText(/^Moved ‘Old SOAP note’ to Redis\./)).toBeInTheDocument()
    expect(status()).not.toHaveTextContent('Undo')
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    expect(patches(state)).toEqual([{ node_id: 'backend/redis' }])
  })

  it('shows the error line and no Undo line when the link fails', async () => {
    const spy = vi.spyOn(api, 'link').mockRejectedValue(new Error('Could not link'))
    try {
      await setup()
      await startDrag('Redis eviction')
      drop(group('Backend > Redis'))
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not link')
      expect(status()).not.toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })

  it('does not make a row being renamed draggable, nor an archived row', async () => {
    const { user } = await setup([
      makeNote('Redis eviction', 'backend/caching'),
      makeNote('Old JWT', 'backend/auth', { archived_at: '2026-11-07T00:00:00Z' }),
    ])
    expect(row('Redis eviction')).toHaveAttribute('draggable', 'true')
    await user.click(screen.getByRole('button', { name: 'More actions for Redis eviction' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const renaming = screen.getByRole('textbox', { name: 'New title' }).closest('li') as HTMLElement
    expect(renaming).toHaveAttribute('draggable', 'false')
    fireEvent.dragStart(renaming, { dataTransfer: transfer() })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(screen.queryByText('Drop here')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Archived (1)' }))
    const archived = screen.getByRole('button', { name: 'Old JWT' }).closest('li') as HTMLElement
    expect(archived).not.toHaveAttribute('draggable', 'true')
    fireEvent.dragStart(archived, { dataTransfer: transfer() })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(screen.queryByText('Drop here')).not.toBeInTheDocument()
  })
})

describe('which notes the list marks', () => {
  it('marks only the open note, and all notes of a node on its lesson page', async () => {
    const { installFakeApi, makeNote } = await import('../test/fakeApi')
    const { renderAppReady } = await import('../test/render')
    const { screen, within } = await import('@testing-library/react')
    installFakeApi([makeNote('OpenSpec in the backend repo', 'backend/caching'), makeNote('OpenSpec key ideas', 'backend/caching')])
    const { user } = await renderAppReady()
    const list = await screen.findByRole('complementary', { name: 'Learned items' })
    const first = await within(list).findByRole('button', { name: 'OpenSpec in the backend repo' })
    const second = within(list).getByRole('button', { name: 'OpenSpec key ideas' })
    expect(first).toHaveAttribute('aria-pressed', 'false')

    // A note of the same node is not marked with the open one.
    await user.click(first)
    await screen.findByRole('article', { name: 'Note: OpenSpec in the backend repo' })
    expect(first).toHaveAttribute('aria-pressed', 'true')
    expect(second).toHaveAttribute('aria-pressed', 'false')

    // On the node's lesson page its notes are marked.
    window.location.hash = '#/lesson/backend/caching'
    await screen.findByRole('heading', { level: 1, name: /Caching/ })
    expect(within(list).getByRole('button', { name: 'OpenSpec in the backend repo' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(list).getByRole('button', { name: 'OpenSpec key ideas' })).toHaveAttribute('aria-pressed', 'true')

    // Back home nothing stays marked.
    window.location.hash = '#/'
    await screen.findByRole('heading', { level: 1, name: 'What do you want to learn?' })
    expect(within(list).getByRole('button', { name: 'OpenSpec in the backend repo' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('Unsorted categories', () => {
  const at = (day: number) => ({ updated_at: `2026-11-0${day}T00:00:00Z` })
  const notes = () => [
    makeNote('Pod limits', null, { category: 'Kubernetes', ...at(2) }),
    makeNote('Helm charts', null, { category: 'Kubernetes', ...at(3) }),
    makeNote('Salary talk', null, { category: 'Career', ...at(5) }),
    makeNote('Loose idea', null, at(6)),
  ]

  it('groupNotes orders named groups by newest note, Other last, notes newest first', () => {
    const { unsorted } = groupNotes(notes(), [backend])
    expect(unsorted.map((g) => g.category)).toEqual(['Career', 'Kubernetes', null])
    expect(unsorted[1].notes.map((n) => n.title)).toEqual(['Helm charts', 'Pod limits'])
  })

  it('groupNotes: a linked note leaves its category group', () => {
    const linked = notes().map((n) => (n.title === 'Pod limits' ? { ...n, node_id: 'backend/caching' } : n))
    const { unsorted, domains } = groupNotes(linked, [backend])
    expect(unsorted.find((g) => g.category === 'Kubernetes')?.notes.map((n) => n.title)).toEqual(['Helm charts'])
    expect(domains[0].nodes[0].notes.map((n) => n.title)).toEqual(['Pod limits'])
  })

  it('groupNotes: the filter applies inside the groups and drops empty ones', () => {
    const { unsorted } = groupNotes(notes(), [backend], 'helm')
    expect(unsorted.map((g) => g.category)).toEqual(['Kubernetes'])
  })

  it('shows sub-groups with plain-text headings, Other last', () => {
    renderList(notes())
    const names = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))
    expect(names).toEqual(['Unsorted > Career', 'Unsorted > Kubernetes', 'Unsorted > Other'])
    const k = screen.getByRole('group', { name: 'Unsorted > Kubernetes' })
    expect(within(k).getByRole('button', { name: 'Pod limits' })).toBeInTheDocument()
    expect(within(k).getByRole('heading', { level: 4, name: 'Kubernetes' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Unsorted' })).getByRole('button', { name: 'Loose idea' })).toBeInTheDocument()
  })

  it('shows a category with markup as text', () => {
    renderList([makeNote('x', null, { category: '<b>Bold</b>' })])
    expect(screen.getByRole('heading', { level: 4, name: '<b>Bold</b>' })).toBeInTheDocument()
  })

  it('renders no sub-group and no Other heading without categories', () => {
    renderList()
    expect(screen.queryByRole('heading', { level: 4, name: 'Other' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /^Unsorted >/ })).not.toBeInTheDocument()
  })

  it('Group with AI is busy while it runs, then refreshes', async () => {
    const user = userEvent.setup()
    let finish: (v: { grouped: number; groups: number }) => void = () => {}
    vi.spyOn(api, 'categorize').mockReturnValue(new Promise((r) => (finish = r)))
    const onChanged = vi.fn(async () => {})
    render(
      <LearnedList notes={notes()} roadmaps={[backend]} selectedNoteId={null} selectedNodeId={null}
        onOpenNote={noop} onImport={noop} onChanged={onChanged} />,
    )
    await user.click(screen.getByRole('button', { name: 'Group with AI' }))
    expect(screen.getByRole('button', { name: 'Grouping…' })).toBeDisabled()
    finish({ grouped: 3, groups: 2 })
    expect(await screen.findByRole('button', { name: 'Group with AI' })).toBeEnabled()
    expect(onChanged).toHaveBeenCalled()
  })

  it('Group with AI shows the error detail and keeps the notes', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'categorize').mockRejectedValue(new Error('Set up a provider first'))
    renderList(notes())
    await user.click(screen.getByRole('button', { name: 'Group with AI' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Set up a provider first')
    expect(screen.getByRole('button', { name: 'Group with AI' })).toBeEnabled()
  })

  describe('rename', () => {
    const open = async () => {
      const user = userEvent.setup()
      const spy = vi.spyOn(api, 'renameCategory').mockResolvedValue({ renamed: 2 })
      renderList(notes())
      await user.click(screen.getByRole('button', { name: 'Rename group Kubernetes' }))
      const form = screen.getByRole('form', { name: 'Rename group Kubernetes' })
      return { user, spy, form, input: within(form).getByRole('textbox', { name: 'New name' }), save: within(form).getByRole('button', { name: 'Save' }) }
    }

    it('keeps Save disabled while unchanged, empty or too long, then saves', async () => {
      const { user, spy, input, save } = await open()
      expect(save).toBeDisabled()
      await user.clear(input)
      expect(save).toBeDisabled()
      await user.type(input, 'x'.repeat(41))
      expect(save).toBeDisabled()
      await user.clear(input)
      await user.type(input, 'K8s')
      expect(save).toBeEnabled()
      await user.click(save)
      expect(spy).toHaveBeenCalledWith('Kubernetes', 'K8s')
      expect(screen.queryByRole('form')).not.toBeInTheDocument()
    })

    it('Enter saves', async () => {
      const { user, spy, input } = await open()
      await user.clear(input)
      await user.type(input, 'K8s{Enter}')
      expect(spy).toHaveBeenCalledWith('Kubernetes', 'K8s')
    })

    it('Cancel and Escape leave the name, and Escape does not reach the parent', async () => {
      const { user, spy, form, input } = await open()
      await user.type(input, 'x')
      await user.click(within(form).getByRole('button', { name: 'Cancel' }))
      expect(screen.getByRole('heading', { level: 4, name: 'Kubernetes' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Rename group Kubernetes' }))
      const parent = vi.fn()
      const onKey = (e: KeyboardEvent) => e.key === 'Escape' && parent()
      document.addEventListener('keydown', onKey)
      await user.type(screen.getByRole('textbox', { name: 'New name' }), 'y{Escape}')
      document.removeEventListener('keydown', onKey)
      expect(parent).not.toHaveBeenCalled()
      expect(screen.queryByRole('form')).not.toBeInTheDocument()
      expect(spy).not.toHaveBeenCalled()
    })
  })
})
