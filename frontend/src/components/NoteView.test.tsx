/** Spec: learning-views - Read a note; knowledge-import - Show the original page safely. */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  // The first render of a file is slow under a full run: wait longer than the default second.
  await view.user.click(await screen.findByRole('button', { name: title }, { timeout: 5000 }))
  const article = await screen.findByRole('article', { name: `Note: ${title}` })
  return { ...view, state, note, article }
}

type User = Awaited<ReturnType<typeof openNote>>['user']

/** Opens the More actions menu of the note header. */
async function openMenu(user: User, article: HTMLElement) {
  await user.click(within(article).getByRole('button', { name: 'More actions' }))
  return within(article).getByRole('menu', { name: 'Note actions' })
}

/** Opens the menu and chooses one of its actions. */
async function choose(user: User, article: HTMLElement, name: string) {
  const menu = await openMenu(user, article)
  await user.click(within(menu).getByRole('menuitem', { name }))
}

/** Opens the title field through the Rename button. */
async function startRename(user: User, article: HTMLElement) {
  await user.click(within(article).getByRole('button', { name: 'Rename' }))
  return within(article).getByRole('textbox', { name: 'Note title' }) as HTMLInputElement
}

const titlePatches = (state: { calls: { method: string; url: string; body?: unknown }[] }) =>
  state.calls.filter((c) => c.method === 'PATCH' && (c.body as { title?: string }).title !== undefined)

async function startEditing(user: User, article: HTMLElement) {
  await choose(user, article, 'Edit page')
  await within(article).findByRole('region', { name: 'Edit page' })
  return (await within(article).findByTitle('Editing: Redis eviction')) as HTMLIFrameElement
}

/** A message as the editor script in the frame would send it. */
function fromFrame(frame: HTMLIFrameElement, data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow }))
  })
}

/** Makes the frame answer the next collect request with these edits. */
function answerCollect(frame: HTMLIFrameElement, edits: Record<string, string>) {
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation((message: unknown) => {
    if ((message as { type?: string }).type === 'lh-collect') {
      setTimeout(() => fromFrame(frame, { type: 'lh-edits', edits }), 0)
    }
  })
}

describe('note view', () => {
  // Scenario: Export a note
  it('exports the note through its print view in a new tab', async () => {
    const { user, article, note } = await openNote('Redis eviction')
    const link = within(await openMenu(user, article)).getByRole('menuitem', { name: 'Export PDF' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', `/api/notes/${note.id}/print`)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  it('shows the original page in a sandboxed frame without same-origin access', async () => {
    const { article, note } = await openNote('Redis eviction')
    const frame = within(article).getByTitle('Original page: Redis eviction')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame).toHaveAttribute('src', `/api/notes/${note.id}/original`)
    expect(within(article).getByRole('heading', { name: 'Redis eviction' })).toBeInTheDocument()
    expect(within(article).getByRole('combobox', { name: 'Linked to' })).toHaveValue('backend/caching')
  })

  // Scenario: Rename a note
  it('shows the title as a heading with no title field until Rename', async () => {
    const { article } = await openNote('Redis eviction')
    expect(within(article).getByRole('heading', { name: 'Redis eviction' })).toHaveClass('note-title')
    expect(within(article).queryByRole('textbox', { name: 'Note title' })).not.toBeInTheDocument()
    expect(within(article).queryByRole('button', { name: 'Save title' })).not.toBeInTheDocument()
  })

  it('opens the title field focused with its text selected from the Rename button', async () => {
    const { user, article } = await openNote('Redis eviction')
    const input = await startRename(user, article)
    expect(input).toHaveValue('Redis eviction')
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('Redis eviction'.length)
    expect(within(article).queryByRole('heading', { name: 'Redis eviction' })).not.toBeInTheDocument()
  })

  it('opens the title field from the Rename item of the More actions menu, listed first', async () => {
    const { user, article } = await openNote('Redis eviction')
    const menu = await openMenu(user, article)
    expect(within(menu).getAllByRole('menuitem')[0]).toHaveTextContent('Rename')
    await user.click(within(menu).getByRole('menuitem', { name: 'Rename' }))
    const input = within(article).getByRole('textbox', { name: 'Note title' }) as HTMLInputElement
    expect(input).toHaveFocus()
    expect(input.selectionEnd).toBe('Redis eviction'.length)
  })

  it('renames the note', async () => {
    const { user, article, state, note } = await openNote('Redis eviction')
    const input = await startRename(user, article)
    await user.clear(input)
    await user.type(input, 'Redis: eviction and TTL{Enter}')
    expect(state.calls).toContainEqual({
      method: 'PATCH',
      url: `/api/notes/${note.id}`,
      body: { title: 'Redis: eviction and TTL' },
    })
    await waitFor(() => expect(within(article).queryByRole('textbox', { name: 'Note title' })).not.toBeInTheDocument())
    expect(await within(article).findByRole('heading', { name: 'Redis: eviction and TTL' })).toBeInTheDocument()
  })

  it('keeps Save title disabled until the trimmed title is non-empty and different, and never saves on blur', async () => {
    const { user, article, state, note } = await openNote('Redis eviction')
    const input = await startRename(user, article)
    const save = within(article).getByRole('button', { name: 'Save title' })
    expect(save).toBeDisabled()
    await user.type(input, '{End}  ')
    expect(save).toBeDisabled()
    await user.clear(input)
    expect(save).toBeDisabled()
    await user.type(input, 'Redis eviction v2')
    expect(save).toBeEnabled()
    await user.click(within(article).getByRole('combobox', { name: 'Linked to' }))
    expect(titlePatches(state)).toEqual([])
    expect(within(article).getByRole('textbox', { name: 'Note title' })).toBeInTheDocument()

    await user.click(save)
    expect(state.calls).toContainEqual({ method: 'PATCH', url: `/api/notes/${note.id}`, body: { title: 'Redis eviction v2' } })
    await waitFor(() => expect(within(article).queryByRole('button', { name: 'Save title' })).not.toBeInTheDocument())
  })

  it('does not save on Enter while Save title is disabled', async () => {
    const { user, article, state } = await openNote('Redis eviction')
    await startRename(user, article)
    await user.keyboard('{Enter}')
    expect(titlePatches(state)).toEqual([])
    expect(within(article).getByRole('textbox', { name: 'Note title' })).toBeInTheDocument()
  })

  it('cancels a title change with the Cancel button', async () => {
    const { user, article, state } = await openNote('Redis eviction')
    const input = await startRename(user, article)
    await user.type(input, ' v2')
    await user.click(within(article).getByRole('button', { name: 'Cancel title change' }))
    expect(within(article).queryByRole('textbox', { name: 'Note title' })).not.toBeInTheDocument()
    expect(within(article).getByRole('heading', { name: 'Redis eviction' })).toBeInTheDocument()
    expect(state.calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('cancels a title change with Escape', async () => {
    const { user, article, state } = await openNote('Redis eviction')
    const input = await startRename(user, article)
    await user.type(input, ' v2{Escape}')
    expect(within(article).queryByRole('textbox', { name: 'Note title' })).not.toBeInTheDocument()
    expect(within(article).getByRole('heading', { name: 'Redis eviction' })).toBeInTheDocument()
    expect(state.calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  // Scenario: Undo a rename
  it('offers Undo after a rename and Undo sends the previous title, with no second undo', async () => {
    const { user, article, state, note } = await openNote('Redis eviction')
    const input = await startRename(user, article)
    await user.clear(input)
    await user.type(input, 'Redis TTL{Enter}')
    const line = await within(article).findByText(/Renamed to ‘Redis TTL’\./)
    expect(line.closest('.undo-line')).toHaveAttribute('role', 'status')
    await user.click(within(article).getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(state.calls).toContainEqual({ method: 'PATCH', url: `/api/notes/${note.id}`, body: { title: 'Redis eviction' } }),
    )
    await waitFor(() => expect(within(article).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument())
    expect(await within(article).findByRole('heading', { name: 'Redis eviction' })).toBeInTheDocument()
    expect(within(article).queryByText(/Renamed to/)).not.toBeInTheDocument()
  })

  // Scenario: Undo a link change
  it('offers Undo after Save link and Undo sends the previous node', async () => {
    const { user, article, state } = await openNote('Redis eviction')
    await user.selectOptions(within(article).getByRole('combobox', { name: 'Linked to' }), 'devops/docker')
    await user.click(within(article).getByRole('button', { name: 'Save link' }))
    expect(await within(article).findByText(/Linked to Docker\./)).toBeInTheDocument()
    await user.click(within(article).getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(state.calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([
        { node_id: 'devops/docker' },
        { node_id: 'backend/caching' },
      ]),
    )
    await waitFor(() => expect(within(article).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument())
  })

  it('offers Undo after unlinking and Undo sends the previous node', async () => {
    const { user, article, state } = await openNote('Redis eviction')
    await user.selectOptions(within(article).getByRole('combobox', { name: 'Linked to' }), '')
    await user.click(within(article).getByRole('button', { name: 'Save link' }))
    expect(await within(article).findByText(/Unlinked\./)).toBeInTheDocument()
    await user.click(within(article).getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(state.calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([
        { node_id: null },
        { node_id: 'backend/caching' },
      ]),
    )
  })

  it('undoes a link on an unlinked note by sending null', async () => {
    const { user, article, state } = await openNote('Redis eviction', null)
    await user.selectOptions(within(article).getByRole('combobox', { name: 'Linked to' }), 'backend/caching')
    await user.click(within(article).getByRole('button', { name: 'Save link' }))
    expect(await within(article).findByText(/Linked to Caching\./)).toBeInTheDocument()
    await user.click(within(article).getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(state.calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([
        { node_id: 'backend/caching' },
        { node_id: null },
      ]),
    )
  })

  describe('undo line timing', () => {
    afterEach(() => vi.useRealTimers())

    it('disappears after 8 seconds', async () => {
      // Fake clock that still ticks, so user-event and the fake API keep working.
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const { user, article } = await openNote('Redis eviction')
      const input = await startRename(user, article)
      await user.type(input, ' v2{Enter}')
      expect(await within(article).findByText(/Renamed to/)).toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(7900)
      })
      expect(within(article).getByText(/Renamed to/)).toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(within(article).queryByText(/Renamed to/)).not.toBeInTheDocument()
    })

    it('is replaced by the line of the next action', async () => {
      const { user, article } = await openNote('Redis eviction')
      const input = await startRename(user, article)
      await user.type(input, ' v2{Enter}')
      expect(await within(article).findByText(/Renamed to/)).toBeInTheDocument()
      await user.selectOptions(within(article).getByRole('combobox', { name: 'Linked to' }), 'devops/docker')
      await user.click(within(article).getByRole('button', { name: 'Save link' }))
      expect(await within(article).findByText(/Linked to Docker\./)).toBeInTheDocument()
      expect(within(article).queryByText(/Renamed to/)).not.toBeInTheDocument()
      expect(within(article).getAllByRole('button', { name: 'Undo' })).toHaveLength(1)
    })
  })

  it('edits the text in place and saves only the changed block', async () => {
    const { user, article, state, note } = await openNote('Redis eviction')
    const frame = await startEditing(user, article)
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain('data-lh-edit="0"')
    expect(within(article).queryByRole('textbox', { name: 'Page HTML' })).not.toBeInTheDocument()
    const save = within(article).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    expect(within(article).getByText('Click any text on the page to edit it')).toBeInTheDocument()

    fromFrame(frame, { type: 'lh-dirty', count: 1 })
    expect(await screen.findByText('1 block changed')).toBeInTheDocument()
    answerCollect(frame, { '0': 'volatile-lru' })
    await user.click(save)
    const put = state.calls.find((c) => c.method === 'PUT')
    expect(put?.url).toBe(`/api/notes/${note.id}/content`)
    const html = (put!.body as { html: string }).html
    expect(html).toContain('<p>volatile-lru</p>')
    expect(html).toContain('<title>Redis eviction</title>')
    expect(html).not.toContain('data-lh-edit')
    expect(html).not.toContain('lh-collect')
    await waitFor(() => expect(within(article).queryByRole('region', { name: 'Edit page' })).not.toBeInTheDocument())
    expect(within(article).getByTitle('Original page: Redis eviction')).toBeInTheDocument()
  })

  it('ignores messages that do not come from its own frame', async () => {
    const { user, article } = await openNote('Redis eviction')
    await startEditing(user, article)
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'lh-dirty', count: 3 }, source: window }))
    expect(within(article).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('saves when the page forwards Ctrl+S', async () => {
    const { user, article, state } = await openNote('Redis eviction')
    const frame = await startEditing(user, article)
    fromFrame(frame, { type: 'lh-dirty', count: 1 })
    answerCollect(frame, { '0': 'more' })
    fromFrame(frame, { type: 'lh-save' })
    await waitFor(() => expect(state.calls.some((c) => c.method === 'PUT')).toBe(true))
  })

  it('asks before discarding unsaved page changes', async () => {
    const { user, article, state } = await openNote('Redis eviction')
    const frame = await startEditing(user, article)
    fromFrame(frame, { type: 'lh-dirty', count: 1 })
    await screen.findByText('1 block changed')
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
    const frame = await startEditing(user, article)
    fromFrame(frame, { type: 'lh-dirty', count: 2 })
    await screen.findByText('2 blocks changed')
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
    const frame = await startEditing(user, article)
    state.sources[note.id] = '<p>saved in another tab</p>'
    fromFrame(frame, { type: 'lh-dirty', count: 1 })
    answerCollect(frame, { '0': 'mine' })
    await user.click(await within(article).findByRole('button', { name: 'Save' }))
    expect(await within(article).findByRole('alert')).toHaveTextContent('the page changed since you opened it')
    expect(state.sources[note.id]).toBe('<p>saved in another tab</p>')
  })
  it('changes and removes the link only through Save link', async () => {
    const { user, article, state, note } = await openNote('Redis eviction')
    const patches = () => state.calls.filter((c) => c.method === 'PATCH' && c.url === `/api/notes/${note.id}`)
    const picker = within(article).getByRole('combobox', { name: 'Linked to' })
    await user.selectOptions(picker, 'devops/docker')
    expect(patches()).toEqual([])
    await user.click(within(article).getByRole('button', { name: 'Save link' }))
    await waitFor(() => expect(patches().map((c) => c.body)).toEqual([{ node_id: 'devops/docker' }]))
    await waitFor(() => expect(within(article).queryByRole('button', { name: 'Save link' })).not.toBeInTheDocument())
    await user.selectOptions(picker, '')
    await user.click(within(article).getByRole('button', { name: 'Save link' }))
    await waitFor(() => expect(patches().map((c) => c.body)).toEqual([{ node_id: 'devops/docker' }, { node_id: null }]))
  })

  it('cancels a link change', async () => {
    const { user, article, state } = await openNote('Redis eviction')
    const picker = within(article).getByRole('combobox', { name: 'Linked to' })
    await user.selectOptions(picker, 'devops/docker')
    await user.click(within(article).getByRole('button', { name: 'Cancel link change' }))
    expect(picker).toHaveValue('backend/caching')
    expect(within(article).queryByRole('button', { name: 'Save link' })).not.toBeInTheDocument()
    expect(state.calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('drops an unsaved link change when the note is left, and shows the saved node on reopening', async () => {
    const { user, article, state } = await openNote('Redis eviction')
    // If leaving ever asks first, agree to discard: the scenario is about what happens to the link.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await user.selectOptions(within(article).getByRole('combobox', { name: 'Linked to' }), 'devops/docker')
    expect(within(article).getByRole('button', { name: 'Save link' })).toBeInTheDocument()

    await user.click(within(article).getByRole('button', { name: '← Back' }))
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
    expect(state.calls.some((c) => c.method === 'PATCH')).toBe(false)

    await user.click(await screen.findByRole('button', { name: 'Redis eviction' }))
    const reopened = await screen.findByRole('article', { name: 'Note: Redis eviction' })
    expect(within(reopened).getByRole('combobox', { name: 'Linked to' })).toHaveValue('backend/caching')
    expect(within(reopened).queryByRole('button', { name: 'Save link' })).not.toBeInTheDocument()
    expect(state.calls.some((c) => c.method === 'PATCH')).toBe(false)
    confirm.mockRestore()
  })

  it('Open lesson links to the lesson of the linked node', async () => {
    const { article } = await openNote('Redis eviction')
    expect(within(article).getByRole('link', { name: 'Open lesson' })).toHaveAttribute('href', '#/lesson/backend/caching')
  })

  it('shows no Open lesson link for an unsorted note', async () => {
    const { article } = await openNote('Redis eviction', null)
    expect(within(article).queryByRole('link', { name: 'Open lesson' })).not.toBeInTheDocument()
  })

  it('shows no Open lesson link when the linked node no longer exists', async () => {
    installFakeApi([makeNote('Redis eviction', 'backend/gone', { node_missing: true })])
    const { user } = renderApp()
    // The list button also carries the "missing node" tag, so match the title loosely.
    await user.click(await screen.findByRole('button', { name: /^Redis eviction/ }, { timeout: 5000 }))
    const article = await screen.findByRole('article', { name: 'Note: Redis eviction' })
    expect(within(article).getByText(/no longer exists/)).toBeInTheDocument()
    expect(within(article).queryByRole('link', { name: 'Open lesson' })).not.toBeInTheDocument()
  })

  it('shows a loading indicator until the stored page has loaded', async () => {
    const { article } = await openNote('Redis eviction')
    const frame = within(article).getByTitle('Original page: Redis eviction')
    expect(within(article).getByRole('status')).toHaveTextContent('Loading page…')
    expect(frame.parentElement).toHaveAttribute('data-loaded', 'false')

    fireEvent.load(frame)
    expect(within(article).queryByRole('status')).not.toBeInTheDocument()
    expect(frame.parentElement).toHaveAttribute('data-loaded', 'true')
  })

  it('asks to confirm a delete under the header, not inside its row', async () => {
    const { user, article } = await openNote('Redis eviction')
    await choose(user, article, 'Delete')
    const confirm = within(article).getByRole('alertdialog', { name: 'Confirm delete' })
    expect(article.querySelector('header')).not.toContainElement(confirm)
    expect(article.querySelector('header')).toContainElement(within(article).getByRole('button', { name: 'More actions' }))
  })

  it('deletes only after confirmation', async () => {
    const { user, article, state } = await openNote('Redis eviction')
    await choose(user, article, 'Delete')
    expect(state.calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(screen.getByRole('alertdialog', { name: 'Confirm delete' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(state.calls.some((c) => c.method === 'DELETE')).toBe(false)

    await choose(user, article, 'Delete')
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(state.calls.some((c) => c.method === 'DELETE')).toBe(true))
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
    expect(await screen.findByText('Nothing learned yet')).toBeInTheDocument()
  })

  it('offers Archive for an active note and keeps the page open once archived', async () => {
    const { article, state, user, note } = await openNote('Redis eviction')
    expect(within(article).queryByText('This note is archived.')).not.toBeInTheDocument()
    expect(within(article).queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument()
    const menu = await openMenu(user, article)
    expect(within(menu).queryByRole('menuitem', { name: 'Restore' })).not.toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitem', { name: 'Archive' }))
    expect(state.calls).toContainEqual({ method: 'PATCH', url: `/api/notes/${note.id}`, body: { archived: true } })
    expect(await screen.findByText('This note is archived.')).toBeInTheDocument()
  })

  it('says an archived note is archived and restores it from the banner', async () => {
    const { article, state, user, note } = await openNote('Redis eviction', 'backend/caching', {
      archived_at: '2026-11-07T00:00:00Z',
    })
    expect(within(article).getByText('This note is archived.')).toBeInTheDocument()
    const archivedMenu = await openMenu(user, article)
    expect(within(archivedMenu).queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(within(article).getByRole('button', { name: 'Restore this note' }))
    expect(state.calls).toContainEqual({ method: 'PATCH', url: `/api/notes/${note.id}`, body: { archived: false } })
    await waitFor(() => expect(screen.queryByText('This note is archived.')).not.toBeInTheDocument())
    const group = screen.getByRole('group', { name: 'Backend > Caching' })
    expect(within(group).getByRole('button', { name: 'Redis eviction' })).toBeInTheDocument()
    expect(within(await openMenu(user, article)).getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument()
  })

  it('restores from the More actions menu too', async () => {
    const { article, user } = await openNote('Redis eviction', null, { archived_at: '2026-11-07T00:00:00Z' })
    await choose(user, article, 'Restore')
    await waitFor(() => expect(screen.queryByText('This note is archived.')).not.toBeInTheDocument())
  })

  // Scenario: More actions menu
  it('offers Rename, Edit page, Export PDF, Archive and Delete in the More actions menu', async () => {
    const { article, user } = await openNote('Redis eviction')
    const header = article.querySelector('header')!
    for (const name of ['Edit page', 'Export PDF', 'Archive', 'Delete']) {
      expect(within(header).queryByRole('button', { name })).not.toBeInTheDocument()
      expect(within(header).queryByRole('link', { name })).not.toBeInTheDocument()
    }
    const more = within(article).getByRole('button', { name: 'More actions' })
    expect(more).toHaveAttribute('aria-haspopup', 'menu')
    expect(more).toHaveAttribute('aria-expanded', 'false')
    const menu = await openMenu(user, article)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Rename',
      'Edit page',
      'Export PDF',
      'Archive',
      'Delete',
    ])
    // Still no separate buttons while the menu is open.
    expect(within(header).queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
  })

  // Scenario: Menu with the keyboard
  it('moves between the items with the arrows, and Escape closes it and returns the focus', async () => {
    const { article, user } = await openNote('Redis eviction')
    const menu = await openMenu(user, article)
    const items = within(menu).getAllByRole('menuitem')
    expect(items[0]).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(items[1]).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(within(article).queryByRole('menu')).not.toBeInTheDocument()
    expect(within(article).getByRole('button', { name: 'More actions' })).toHaveFocus()
  })

  // Scenario: Choosing an action closes the menu
  it('closes the menu when Archive is chosen, and then offers Restore instead', async () => {
    const { article, user } = await openNote('Redis eviction')
    await choose(user, article, 'Archive')
    expect(within(article).queryByRole('menu')).not.toBeInTheDocument()
    expect(await within(article).findByText('This note is archived.')).toBeInTheDocument()
    const menu = await openMenu(user, article)
    expect(within(menu).getByRole('menuitem', { name: 'Restore' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument()
  })

  it('closes the menu on a click outside it', async () => {
    const { article, user } = await openNote('Redis eviction')
    await openMenu(user, article)
    await user.click(within(article).getByRole('heading', { name: 'Redis eviction' }))
    expect(within(article).queryByRole('menu')).not.toBeInTheDocument()
  })

  // Scenario: Menu while editing the page
  it('offers only Rename, Archive and Delete while the page editor is open', async () => {
    const { article, user } = await openNote('Redis eviction')
    await startEditing(user, article)
    const menu = await openMenu(user, article)
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Rename', 'Archive', 'Delete'])
  })
})
