/** Spec: learning-views - Import from the UI. */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFakeApi, makeNote } from '../test/fakeApi'
import { renderApp } from '../test/render'

const html = (name: string) => new File([`<title>${name}</title>`], name, { type: 'text/html' })

describe('import from the UI', () => {
  it('imports a dropped file and links it to the chosen node', async () => {
    const created = makeNote('Redis eviction policies')
    const state = installFakeApi(
      [makeNote('Existing', 'backend/caching')],
      [{ filename: 'redis-eviction.html', outcome: 'created', reason: null, note: created }],
    )
    const { user } = renderApp('#/roadmap/backend')
    await user.click(await screen.findByRole('button', { name: 'Import' }))
    const dialog = screen.getByRole('dialog', { name: 'Import HTML files' })

    fireEvent.drop(within(dialog).getByTestId('drop-zone'), {
      dataTransfer: { files: [html('redis-eviction.html')] },
    })
    const picker = await within(dialog).findByRole('combobox', {
      name: 'Roadmap node for redis-eviction.html',
    })
    await user.selectOptions(picker, 'backend/caching')
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(state.calls).toContainEqual({
      method: 'PATCH',
      url: `/api/notes/${created.id}`,
      body: { node_id: 'backend/caching' },
    })
    const caching = await screen.findByRole('group', { name: 'Backend > Caching' })
    expect(await within(caching).findByRole('button', { name: 'Redis eviction policies' })).toBeInTheDocument()
    const node = screen.getByTestId('node-backend/caching')
    expect(await within(node).findByLabelText('2 notes')).toBeInTheDocument()
  })

  it('leaves the note unsorted when linking is skipped, and shows per-file outcomes', async () => {
    const created = makeNote('JWT vs sessions')
    const state = installFakeApi(
      [],
      [
        { filename: 'jwt.html', outcome: 'created', reason: null, note: created },
        { filename: 'notes.pdf', outcome: 'rejected', reason: 'not an HTML file', note: null },
      ],
    )
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: 'Import HTML files' }))
    const dialog = screen.getByRole('dialog')
    await user.upload(within(dialog).getByLabelText('HTML files'), [html('jwt.html')])

    expect(await within(dialog).findByText('Rejected: not an HTML file')).toBeInTheDocument()
    expect(within(dialog).getByText('Imported')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(state.calls.filter((c) => c.method === 'PATCH')).toEqual([])
    const unsorted = await screen.findByRole('region', { name: 'Unsorted' })
    expect(within(unsorted).getByRole('button', { name: 'JWT vs sessions' })).toBeInTheDocument()
  })
})
