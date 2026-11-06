/** Spec: learning-views - Read a note; knowledge-import - Show the original page safely. */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFakeApi, makeNote } from '../test/fakeApi'
import { renderApp } from '../test/render'

async function openNote(title: string, nodeId: string | null = 'backend/caching') {
  const note = makeNote(title, nodeId)
  const state = installFakeApi([note])
  const view = renderApp()
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
})
