/** Spec: learning-views - Read a note; knowledge-import - Show the original page safely. */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Note } from '../api'
import { installFakeApi, makeNote } from '../test/fakeApi'
import { renderApp } from '../test/render'

async function openNote(title: string, nodeId: string | null = 'backend/caching', extra: Partial<Note> = {}) {
  const note = makeNote(title, nodeId, extra)
  const state = installFakeApi([note])
  const view = renderApp()
  if (extra.archived_at) {
    await view.user.click(await screen.findByRole('button', { name: 'Archived (1)' }))
  }
  await view.user.click(await screen.findByRole('button', { name: title }))
  const article = await screen.findByRole('article', { name: `Note: ${title}` })
  return { ...view, state, note, article }
}

describe('note view', () => {
  it('shows the original page in a sandboxed frame without same-origin access', async () => {
    const { article, note } = await openNote('Redis eviction')
    const frame = within(article).getByTitle('Original page: Redis eviction')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame).toHaveAttribute('src', `/api/notes/${note.id}/original`)
    expect(within(article).getByRole('textbox', { name: 'Note title' })).toHaveValue('Redis eviction')
    expect(within(article).getByRole('combobox', { name: 'Roadmap node' })).toHaveValue('backend/caching')
  })

  it('renames the note', async () => {
    const { user, article, state, note } = await openNote('Redis eviction')
    const input = within(article).getByRole('textbox', { name: 'Note title' })
    await user.clear(input)
    await user.type(input, 'Redis: eviction and TTL{Enter}')
    expect(state.calls).toContainEqual({
      method: 'PATCH',
      url: `/api/notes/${note.id}`,
      body: { title: 'Redis: eviction and TTL' },
    })
  })

  it('changes and removes the link', async () => {
    const { user, article, state, note } = await openNote('Redis eviction')
    const picker = within(article).getByRole('combobox', { name: 'Roadmap node' })
    await user.selectOptions(picker, 'devops/docker')
    await user.selectOptions(picker, '')
    const patches = state.calls.filter((c) => c.method === 'PATCH' && c.url === `/api/notes/${note.id}`)
    expect(patches.map((c) => c.body)).toEqual([{ node_id: 'devops/docker' }, { node_id: null }])
  })

  it('deletes only after confirmation', async () => {
    const { user, article, state } = await openNote('Redis eviction')
    await user.click(within(article).getByRole('button', { name: 'Delete' }))
    expect(state.calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(screen.getByRole('alertdialog', { name: 'Confirm delete' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(state.calls.some((c) => c.method === 'DELETE')).toBe(false)

    await user.click(within(article).getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(state.calls.some((c) => c.method === 'DELETE')).toBe(true))
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
    expect(await screen.findByText('Nothing learned yet')).toBeInTheDocument()
  })

  it('offers Archive for an active note and keeps the page open once archived', async () => {
    const { article, state, user, note } = await openNote('Redis eviction')
    expect(within(article).queryByText('This note is archived.')).not.toBeInTheDocument()
    expect(within(article).queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument()
    await user.click(within(article).getByRole('button', { name: 'Archive' }))
    expect(state.calls).toContainEqual({ method: 'PATCH', url: `/api/notes/${note.id}`, body: { archived: true } })
    expect(await screen.findByText('This note is archived.')).toBeInTheDocument()
  })

  it('says an archived note is archived and restores it from the banner', async () => {
    const { article, state, user, note } = await openNote('Redis eviction', 'backend/caching', {
      archived_at: '2026-11-07T00:00:00Z',
    })
    expect(within(article).getByText('This note is archived.')).toBeInTheDocument()
    expect(within(article).queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
    await user.click(within(article).getByRole('button', { name: 'Restore this note' }))
    expect(state.calls).toContainEqual({ method: 'PATCH', url: `/api/notes/${note.id}`, body: { archived: false } })
    await waitFor(() => expect(screen.queryByText('This note is archived.')).not.toBeInTheDocument())
    const group = screen.getByRole('group', { name: 'Backend > Caching' })
    expect(within(group).getByRole('button', { name: 'Redis eviction' })).toBeInTheDocument()
    expect(within(article).getByRole('button', { name: 'Archive' })).toBeInTheDocument()
  })

  it('restores from the action row button too', async () => {
    const { article, user } = await openNote('Redis eviction', null, { archived_at: '2026-11-07T00:00:00Z' })
    await user.click(within(article).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(screen.queryByText('This note is archived.')).not.toBeInTheDocument())
  })
})
