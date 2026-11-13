/** Spec: learning-views - Learned-items list. */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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
