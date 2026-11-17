/** Spec: lesson-pages, "Import an HTML page into the lesson editor". */
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeApi, type FakeState } from '../test/fakeApi'
import { renderApp } from '../test/render'

const page = (name: string) => new File(['<h1>Kafka</h1>'], name, { type: 'text/html' })
const withLesson = (state: FakeState, body: string) => {
  state.lessons['devops/docker'] = { node_id: 'devops/docker', body, source: 'user', updated_at: '2026-11-07T00:00:00Z' }
}
const puts = (state: FakeState) => state.calls.filter((c) => c.method === 'PUT')
const editorOf = (lesson: HTMLElement) => within(lesson).queryByRole('textbox', { name: 'Lesson text (Markdown)' })
const KAFKA = '# Kafka\n\nA log of events.\n\n- topics\n- partitions\n\n| a | b |\n| --- | --- |\n| 1 | 2 |'

async function openDocker(state: FakeState) {
  const { user } = renderApp('#/lesson/devops/docker')
  const lesson = await screen.findByRole('article', { name: 'Lesson: Docker' })
  await within(lesson).findByRole('button', { name: state.lessons['devops/docker'] ? 'Edit lesson' : 'Write lesson' })
  const input = within(lesson).getByLabelText('PDF or HTML file')
  return { user, lesson, input, upload: (file: File) => user.upload(input, file) }
}

describe('lesson HTML import', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts PDF and HTML files', async () => {
    const { input } = await openDocker(installFakeApi())
    expect(input).toHaveAttribute('accept', 'application/pdf,.pdf,text/html,.html,.htm')
  })

  it('opens the page as Markdown in the editor and saves it only on Save', async () => {
    const state = installFakeApi()
    const { user, lesson, upload } = await openDocker(state)

    await upload(page('kafka.html'))
    expect(await within(lesson).findByRole('textbox', { name: 'Lesson text (Markdown)' })).toHaveValue(KAFKA)
    const call = state.calls.findIndex((c) => c.method === 'POST' && c.url === '/api/lessons/extract-file')
    expect(call).toBeGreaterThanOrEqual(0)
    expect(state.headers[call]['X-LearningHub']).toBe('1')
    expect(puts(state)).toHaveLength(0)
    expect(state.lessons['devops/docker']).toBeUndefined()

    await user.click(within(lesson).getByRole('button', { name: 'Save lesson' }))
    const body = await within(lesson).findByTestId('lesson-body')
    expect(within(body).getByRole('heading', { name: 'Kafka' })).toBeInTheDocument()
    expect(within(body).getAllByRole('listitem')).toHaveLength(2)
    expect(within(body).getByRole('table')).toBeInTheDocument()
    expect(puts(state)).toEqual([{ method: 'PUT', url: '/api/lessons/devops/docker', body: { body: KAFKA, source: 'user' } }])
  })

  it('asks before replacing and keeps the lesson when declined', async () => {
    const state = installFakeApi()
    withLesson(state, 'My own notes')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { lesson, upload } = await openDocker(state)

    await upload(page('kafka.htm'))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('Replace the lesson text with the text of kafka.htm?'))
    await waitFor(() => expect(within(lesson).getByRole('button', { name: 'Import PDF or HTML' })).toBeEnabled())
    expect(editorOf(lesson)).not.toBeInTheDocument()
    expect(within(lesson).getByTestId('lesson-body')).toHaveTextContent('My own notes')
    expect(puts(state)).toHaveLength(0)
  })

  it('shows the warning of a page without text and does not open the editor', async () => {
    const state = installFakeApi()
    state.extractFile = () => ({ markdown: '', pages: null, truncated: false, warning: 'the page has no text to import' })
    const { lesson, upload } = await openDocker(state)
    await upload(page('empty.html'))
    await waitFor(() => expect(within(lesson).getByRole('status')).toHaveTextContent('the page has no text to import'))
    expect(editorOf(lesson)).not.toBeInTheDocument()
    expect(puts(state)).toHaveLength(0)
  })

  it('falls back to a generic message when the server sends no warning', async () => {
    const state = installFakeApi()
    state.extractFile = () => ({ markdown: '  ', pages: null, truncated: false, warning: null })
    const { lesson, upload } = await openDocker(state)
    await upload(page('empty.html'))
    await waitFor(() => expect(within(lesson).getByRole('status')).toHaveTextContent('The file has no text to import.'))
    expect(editorOf(lesson)).not.toBeInTheDocument()
  })

  it('shows a refused file with its reason and keeps the lesson', async () => {
    const state = installFakeApi()
    withLesson(state, 'My own notes')
    state.extractFile = () => ({ status: 422, detail: 'not decodable as UTF-8 or as its declared charset' })
    const { lesson, upload } = await openDocker(state)
    await upload(page('bad.html'))
    expect(await within(lesson).findByRole('alert')).toHaveTextContent(
      'Could not import bad.html: not decodable as UTF-8 or as its declared charset',
    )
    expect(editorOf(lesson)).not.toBeInTheDocument()
    expect(within(lesson).getByTestId('lesson-body')).toHaveTextContent('My own notes')
    expect(puts(state)).toHaveLength(0)
  })
})
