/** Spec: lesson-pages, "Import a PDF into the lesson editor" and "Export a lesson as PDF". */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtractedPdf } from '../api'
import { installFakeApi, type FakeState } from '../test/fakeApi'
import { renderApp } from '../test/render'

const openLesson = (title: string) => screen.findByRole('article', { name: `Lesson: ${title}` })
const pdf = (name: string) => new File(['%PDF-1.7 synthetic'], name, { type: 'application/pdf' })
const withLesson = (state: FakeState, body: string) => {
  state.lessons['devops/docker'] = { node_id: 'devops/docker', body, source: 'user', updated_at: '2026-11-07T00:00:00Z' }
}
const puts = (state: FakeState) => state.calls.filter((c) => c.method === 'PUT')
const editorOf = (lesson: HTMLElement) => within(lesson).queryByRole('textbox', { name: 'Lesson text (Markdown)' })

/** Opens the Docker lesson and waits until its lesson section has loaded. */
async function openDocker(state: FakeState) {
  const { user } = renderApp('#/lesson/devops/docker')
  const lesson = await openLesson('Docker')
  const loaded = state.lessons['devops/docker'] ? 'Edit lesson' : 'Write lesson'
  await within(lesson).findByRole('button', { name: loaded })
  const upload = (file: File) => user.upload(within(lesson).getByLabelText('PDF file'), file)
  return { user, lesson, upload }
}

describe('lesson PDF import', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refuses a PDF over the server limit before sending it', async () => {
    const state = installFakeApi()
    state.auth.maxUploadBytes = 4 * 1024 * 1024
    const { lesson, upload } = await openDocker(state)

    await upload(new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'huge.pdf', { type: 'application/pdf' }))

    expect(await within(lesson).findByRole('alert')).toHaveTextContent('Could not import huge.pdf: larger than 4 MB')
    expect(state.calls.some((c) => c.url === '/api/lessons/extract-pdf')).toBe(false)
  })

  it('opens the PDF text in the editor and saves it only on Save', async () => {
    const state = installFakeApi()
    state.extractPdf = () => ({ markdown: 'Docker images\n\n- layers', pages: 1, truncated: false, warning: null })
    const { user, lesson, upload } = await openDocker(state)

    await upload(pdf('docker.pdf'))
    const editor = await within(lesson).findByRole('textbox', { name: 'Lesson text (Markdown)' })
    expect(editor).toHaveValue('Docker images\n\n- layers')
    const call = state.calls.findIndex((c) => c.method === 'POST' && c.url === '/api/lessons/extract-pdf')
    expect(call).toBeGreaterThanOrEqual(0)
    expect(state.headers[call]['X-LearningHub']).toBe('1')
    expect(puts(state)).toHaveLength(0)
    expect(state.lessons['devops/docker']).toBeUndefined()

    await user.click(within(lesson).getByRole('button', { name: 'Save lesson' }))
    const body = await within(lesson).findByTestId('lesson-body')
    expect(within(body).getByRole('listitem')).toHaveTextContent('layers')
    expect(puts(state)).toEqual([
      { method: 'PUT', url: '/api/lessons/devops/docker', body: { body: 'Docker images\n\n- layers', source: 'user' } },
    ])
  })

  it('discards the imported text on Cancel', async () => {
    const state = installFakeApi()
    const { user, lesson, upload } = await openDocker(state)
    await upload(pdf('docker.pdf'))
    await within(lesson).findByRole('textbox', { name: 'Lesson text (Markdown)' })
    await user.click(within(lesson).getByRole('button', { name: 'Cancel' }))
    expect(editorOf(lesson)).not.toBeInTheDocument()
    expect(puts(state)).toHaveLength(0)
    expect(state.lessons['devops/docker']).toBeUndefined()
  })

  it('says it is reading the PDF and disables Import meanwhile', async () => {
    const state = installFakeApi()
    let finish: (answer: ExtractedPdf) => void = () => {}
    state.extractPdf = () => new Promise<ExtractedPdf>((resolve) => (finish = resolve))
    const { lesson, upload } = await openDocker(state)

    await upload(pdf('docker.pdf'))
    expect(await within(lesson).findByRole('status')).toHaveTextContent('Reading PDF…')
    expect(within(lesson).getByRole('button', { name: 'Import PDF' })).toBeDisabled()

    finish({ markdown: 'Read', pages: 1, truncated: false, warning: null })
    expect(await within(lesson).findByRole('textbox', { name: 'Lesson text (Markdown)' })).toHaveValue('Read')
    expect(within(lesson).getByRole('button', { name: 'Import PDF' })).toBeEnabled()
    expect(within(lesson).queryByRole('status')).not.toBeInTheDocument()
  })

  it('asks before replacing the lesson text and keeps it when declined', async () => {
    const state = installFakeApi()
    withLesson(state, 'My own notes')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { lesson, upload } = await openDocker(state)

    await upload(pdf('docker.pdf'))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('Replace the lesson text with the text of docker.pdf?'))
    await waitFor(() => expect(within(lesson).getByRole('button', { name: 'Import PDF' })).toBeEnabled())
    expect(editorOf(lesson)).not.toBeInTheDocument()
    expect(within(lesson).getByTestId('lesson-body')).toHaveTextContent('My own notes')
    expect(puts(state)).toHaveLength(0)
  })

  it('keeps the open editor text when declined', async () => {
    const state = installFakeApi()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user, lesson, upload } = await openDocker(state)
    await user.click(within(lesson).getByRole('button', { name: 'Write lesson' }))
    const editor = within(lesson).getByRole('textbox', { name: 'Lesson text (Markdown)' })
    await user.type(editor, 'Draft in progress')

    await upload(pdf('docker.pdf'))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(within(lesson).getByRole('button', { name: 'Import PDF' })).toBeEnabled())
    expect(editor).toHaveValue('Draft in progress')
    expect(puts(state)).toHaveLength(0)
  })

  it('replaces the editor text when accepted, still without saving', async () => {
    const state = installFakeApi()
    withLesson(state, 'My own notes')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user, lesson, upload } = await openDocker(state)
    await user.click(within(lesson).getByRole('button', { name: 'Edit lesson' }))
    const editor = within(lesson).getByRole('textbox', { name: 'Lesson text (Markdown)' })
    await user.type(editor, ' and more')

    await upload(pdf('docker.pdf'))
    await waitFor(() => expect(editor).toHaveValue('Text of docker.pdf'))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(puts(state)).toHaveLength(0)
    expect(state.lessons['devops/docker'].body).toBe('My own notes')
  })

  it('does not ask when the lesson is empty', async () => {
    const state = installFakeApi()
    const confirm = vi.spyOn(window, 'confirm')
    const { lesson, upload } = await openDocker(state)
    await upload(pdf('docker.pdf'))
    await within(lesson).findByRole('textbox', { name: 'Lesson text (Markdown)' })
    expect(confirm).not.toHaveBeenCalled()
  })

  it('refuses a file that is not a readable PDF with the reason and keeps the lesson', async () => {
    const state = installFakeApi()
    withLesson(state, 'My own notes')
    state.extractPdf = () => ({ status: 422, detail: 'the PDF is password-protected' })
    const confirm = vi.spyOn(window, 'confirm')
    const { lesson, upload } = await openDocker(state)

    await upload(pdf('locked.pdf'))
    expect(await within(lesson).findByRole('alert')).toHaveTextContent(
      'Could not import locked.pdf: the PDF is password-protected',
    )
    expect(confirm).not.toHaveBeenCalled()
    expect(editorOf(lesson)).not.toBeInTheDocument()
    expect(within(lesson).getByTestId('lesson-body')).toHaveTextContent('My own notes')
    expect(puts(state)).toHaveLength(0)
  })

  it('refuses a file that is not a PDF at all', async () => {
    const state = installFakeApi()
    const { lesson } = await openDocker(state)
    // The picker filters on PDFs, but a file can still be dropped or forced past it.
    fireEvent.change(within(lesson).getByLabelText('PDF file'), {
      target: { files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })] },
    })
    expect(await within(lesson).findByRole('alert')).toHaveTextContent('Could not import notes.txt: the file is not a PDF')
    expect(editorOf(lesson)).not.toBeInTheDocument()
  })

  it('says a scanned PDF has no text and does not open the editor', async () => {
    const state = installFakeApi()
    state.extractPdf = () => ({
      markdown: '',
      pages: 3,
      truncated: false,
      warning: 'the PDF has no text to import (it may be scanned images)',
    })
    const { lesson, upload } = await openDocker(state)
    await upload(pdf('scan.pdf'))
    await waitFor(() =>
      expect(within(lesson).getByRole('status')).toHaveTextContent(
        'the PDF has no text to import (it may be scanned images)',
      ),
    )
    expect(editorOf(lesson)).not.toBeInTheDocument()
    expect(puts(state)).toHaveLength(0)
  })

  it('shows the warning of a cut text next to the editor', async () => {
    const state = installFakeApi()
    state.extractPdf = () => ({
      markdown: 'Long text',
      pages: 200,
      truncated: true,
      warning: 'the text was cut at 100000 characters',
    })
    const { lesson, upload } = await openDocker(state)
    await upload(pdf('long.pdf'))
    expect(await within(lesson).findByRole('textbox', { name: 'Lesson text (Markdown)' })).toHaveValue('Long text')
    expect(within(lesson).getByRole('status')).toHaveTextContent('the text was cut at 100000 characters')
  })
})

describe('lesson PDF export', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.title = ''
  })

  it('is disabled while the lesson is empty', async () => {
    const state = installFakeApi()
    const { lesson } = await openDocker(state)
    const exportButton = within(lesson).getByRole('button', { name: 'Export PDF' })
    expect(exportButton).toBeDisabled()
    expect(exportButton).toHaveAttribute('title', expect.stringMatching(/empty/))
  })

  it('prints with the lesson title as the document title, then restores it', async () => {
    const state = installFakeApi()
    withLesson(state, '# Docker\n\nImages and containers')
    document.title = 'Learning Hub'
    const seen: { title: string; printing: boolean }[] = []
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      seen.push({ title: document.title, printing: document.documentElement.classList.contains('printing-lesson') })
    })
    const { user, lesson } = await openDocker(state)

    const exportButton = within(lesson).getByRole('button', { name: 'Export PDF' })
    expect(exportButton).toBeEnabled()
    await user.click(exportButton)
    expect(print).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([{ title: 'Docker', printing: true }])
    expect(document.title).toBe('Learning Hub')
    expect(document.documentElement).not.toHaveClass('printing-lesson')
  })
})
