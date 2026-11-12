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
    const dialog = screen.getByRole('dialog', { name: 'Import HTML or PDF files' })

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
        { filename: 'notes.docx', outcome: 'rejected', reason: 'not an HTML or PDF file', note: null },
      ],
    )
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: 'Import HTML or PDF files' }))
    const dialog = screen.getByRole('dialog')
    await user.upload(within(dialog).getByLabelText('HTML or PDF files'), [html('jwt.html'), html('notes.docx')])

    expect(await within(dialog).findByText('Rejected: not an HTML or PDF file')).toBeInTheDocument()
    expect(within(dialog).getByText('Imported')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(state.calls.filter((c) => c.method === 'PATCH')).toEqual([])
    const unsorted = await screen.findByRole('region', { name: 'Unsorted' })
    expect(within(unsorted).getByRole('button', { name: 'JWT vs sessions' })).toBeInTheDocument()
  })

  /** Spec: knowledge-import - Too large file is not sent. */
  it('does not send a file over the server limit and says "larger than 4 MB"', async () => {
    const created = makeNote('Small page')
    const state = installFakeApi(
      [],
      [{ filename: 'small.html', outcome: 'created', reason: null, note: created }],
    )
    state.auth.maxUploadBytes = 4 * 1024 * 1024
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'big.html', { type: 'text/html' })
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: 'Import HTML or PDF files' }))
    const dialog = screen.getByRole('dialog')
    await user.upload(within(dialog).getByLabelText('HTML or PDF files'), [big, html('small.html')])

    expect(await within(dialog).findByText('Rejected: larger than 4 MB')).toBeInTheDocument()
    expect(within(dialog).getByText('big.html')).toBeInTheDocument()
    expect(within(dialog).getByText('Imported')).toBeInTheDocument()
    expect(state.importRequests).toEqual([['small.html']])
  })

  it('falls back to 10 MB when the server reports no limit', async () => {
    const state = installFakeApi([], [])
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.html', { type: 'text/html' })
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: 'Import HTML or PDF files' }))
    const dialog = screen.getByRole('dialog')
    await user.upload(within(dialog).getByLabelText('HTML or PDF files'), [big])

    expect(await within(dialog).findByText('Rejected: larger than 10 MB')).toBeInTheDocument()
    expect(state.importRequests).toEqual([])
  })

  /** Spec: knowledge-import - Several files, one request each. */
  it('sends one request per file and merges the outcomes in the chosen order', async () => {
    const first = makeNote('First page')
    const third = makeNote('Third page')
    const state = installFakeApi(
      [],
      [
        { filename: 'a.html', outcome: 'created', reason: null, note: first },
        { filename: 'b.docx', outcome: 'rejected', reason: 'not an HTML or PDF file', note: null },
        { filename: 'c.html', outcome: 'created', reason: null, note: third },
      ],
    )
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: 'Import HTML or PDF files' }))
    const dialog = screen.getByRole('dialog')
    await user.upload(within(dialog).getByLabelText('HTML or PDF files'), [
      html('a.html'),
      html('b.docx'),
      html('c.html'),
    ])

    expect(await within(dialog).findByText('Rejected: not an HTML or PDF file')).toBeInTheDocument()
    expect(state.importRequests).toEqual([['a.html'], ['b.docx'], ['c.html']])
    const names = within(dialog)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.filename')?.textContent)
    expect(names).toEqual(['a.html', 'b.docx', 'c.html'])
  })
})
