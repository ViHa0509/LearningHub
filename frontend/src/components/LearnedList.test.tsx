/** Spec: learning-views - Learned-items list. */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { groupNotes } from '../lib/grouping'
import { backend, devops, makeNote } from '../test/fakeApi'
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
    await userEvent.setup().click(screen.getByRole('button', { name: 'Import HTML files' }))
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
