/** Spec: learning-views - Read a note; knowledge-import - Show the original page safely. */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
    // Enter saves too; the Save button is the visible way.
    expect(state.calls).toContainEqual({
      method: 'PATCH',
      url: `/api/notes/${note.id}`,
      body: { title: 'Redis: eviction and TTL' },
    })
  })

  it('shows Save and Cancel only after the title changes, and never saves on blur', async () => {
    const { user, article, state, note } = await openNote('Redis eviction')
    expect(within(article).queryByRole('button', { name: 'Save title' })).not.toBeInTheDocument()
    const input = within(article).getByRole('textbox', { name: 'Note title' })
    await user.type(input, ' v2')
    await user.click(within(article).getByRole('combobox', { name: 'Roadmap node' }))
    expect(state.calls.some((c) => c.method === 'PATCH' && (c.body as { title?: string }).title)).toBe(false)

    await user.click(within(article).getByRole('button', { name: 'Save title' }))
    expect(state.calls).toContainEqual({ method: 'PATCH', url: `/api/notes/${note.id}`, body: { title: 'Redis eviction v2' } })
    await waitFor(() => expect(within(article).queryByRole('button', { name: 'Save title' })).not.toBeInTheDocument())
  })

  it('cancels a title change', async () => {
    const { user, article, state } = await openNote('Redis eviction')
    const input = within(article).getByRole('textbox', { name: 'Note title' })
    await user.type(input, ' v2')
    await user.click(within(article).getByRole('button', { name: 'Cancel title change' }))
    expect(input).toHaveValue('Redis eviction')
    expect(state.calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('edits the page source and saves it', async () => {
    const { user, article, state, note } = await openNote('Redis eviction')
    await user.click(within(article).getByRole('button', { name: 'Edit page' }))
    const editor = await within(article).findByRole('region', { name: 'Edit page' })
    const source = await within(editor).findByRole('textbox', { name: 'Page HTML' })
    expect(source).toHaveValue('<title>Redis eviction</title><p>Redis eviction</p>')
    const save = within(editor).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    const preview = within(editor).getByTitle('Preview: Redis eviction')
    expect(preview).toHaveAttribute('sandbox', 'allow-scripts')

    await user.clear(source)
    await user.type(source, '<p>volatile-lru</p>')
    expect(save).toBeEnabled()
    await user.click(save)
    const put = state.calls.find((c) => c.method === 'PUT')
    expect(put?.url).toBe(`/api/notes/${note.id}/content`)
    expect(put?.body).toMatchObject({ html: '<p>volatile-lru</p>' })
    expect((put!.body as { base_sha256: string }).base_sha256).toMatch(/^sha-/)
    await waitFor(() => expect(within(article).queryByRole('region', { name: 'Edit page' })).not.toBeInTheDocument())
    expect(within(article).getByTitle('Original page: Redis eviction')).toBeInTheDocument()
    expect(state.sources[note.id]).toBe('<p>volatile-lru</p>')
  })

  it('saves the page with Ctrl+S', async () => {
    const { user, article, state } = await openNote('Redis eviction')
    await user.click(within(article).getByRole('button', { name: 'Edit page' }))
    const source = await within(article).findByRole('textbox', { name: 'Page HTML' })
    await user.type(source, '<p>more</p>')
    await user.keyboard('{Control>}s{/Control}')
    await waitFor(() => expect(state.calls.some((c) => c.method === 'PUT')).toBe(true))
  })

  it('asks before discarding unsaved page changes', async () => {
    const { user, article, state } = await openNote('Redis eviction')
    await user.click(within(article).getByRole('button', { name: 'Edit page' }))
    const source = await within(article).findByRole('textbox', { name: 'Page HTML' })
    await user.type(source, '<p>draft</p>')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    await user.click(within(article).getByRole('button', { name: 'Cancel' }))
    expect(confirm).toHaveBeenCalledWith('Discard your unsaved changes to this page?')
    expect(within(article).getByRole('region', { name: 'Edit page' })).toBeInTheDocument()

    confirm.mockReturnValueOnce(true)
    await user.click(within(article).getByRole('button', { name: 'Cancel' }))
    expect(within(article).queryByRole('region', { name: 'Edit page' })).not.toBeInTheDocument()
    expect(state.calls.some((c) => c.method === 'PUT')).toBe(false)
    confirm.mockRestore()
  })

  it('asks before leaving the note with unsaved page changes', async () => {
    const { user, article } = await openNote('Redis eviction')
    await user.click(within(article).getByRole('button', { name: 'Edit page' }))
    const source = await within(article).findByRole('textbox', { name: 'Page HTML' })
    await user.type(source, '<p>draft</p>')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    await user.click(within(article).getByRole('button', { name: '← Back' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('article', { name: 'Note: Redis eviction' })).toBeInTheDocument()

    confirm.mockReturnValueOnce(true)
    await user.click(within(article).getByRole('button', { name: '← Back' }))
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
    expect(confirm).toHaveBeenCalledTimes(2)
    confirm.mockRestore()
  })

  it('shows a conflict when the page changed since the editor opened', async () => {
    const { user, article, state, note } = await openNote('Redis eviction')
    await user.click(within(article).getByRole('button', { name: 'Edit page' }))
    const source = await within(article).findByRole('textbox', { name: 'Page HTML' })
    state.sources[note.id] = '<p>saved in another tab</p>'
    await user.type(source, '<p>mine</p>')
    await user.click(within(article).getByRole('button', { name: 'Save' }))
    expect(await within(article).findByRole('alert')).toHaveTextContent('the page changed since you opened it')
    expect(state.sources[note.id]).toBe('<p>saved in another tab</p>')
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
