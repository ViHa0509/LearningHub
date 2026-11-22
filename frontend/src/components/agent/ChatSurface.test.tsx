/** Spec: a2ui-chat - surfaces in the chat panel; stored chats keep their surfaces. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, type SurfaceOut } from '../../api'
import { MessageList } from './MessageList'
import ChatSurface from './ChatSurface'
import type { Entry } from './useAgentChat'

const SID = 'a2ui-11111111-1111-1111-1111-111111111111'
const CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'

function quiz(extra: Record<string, unknown>[] = []): SurfaceOut {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    kind: 'quiz',
    title: 'Quick quiz',
    messages: [
      { version: 'v0.9', createSurface: { surfaceId: SID, catalogId: CATALOG } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: SID,
          components: [
            { id: 'root', component: 'Column', children: ['q', 'check', 'feedback'] },
            { id: 'q', component: 'Text', text: 'What is 2 + 2?' },
            { id: 'check-label', component: 'Text', text: 'Check' },
            {
              id: 'check',
              component: 'Button',
              variant: 'primary',
              child: 'check-label',
              action: { event: { name: 'check_answer', context: { question: 'q1' } } },
            },
            { id: 'feedback', component: 'Text', text: { path: '/questions/q1/feedback' } },
          ],
        },
      },
      { version: 'v0.9', updateDataModel: { surfaceId: SID, path: '/questions/q1', value: { feedback: '' } } },
      ...extra,
    ],
  }
}

function show(surface: SurfaceOut) {
  return render(
    <Suspense fallback={null}>
      <ChatSurface surface={surface} />
    </Suspense>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('ChatSurface', () => {
  it('renders a surface from the messages', async () => {
    show(quiz())
    expect(await screen.findByText('What is 2 + 2?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check' })).toBeTruthy()
  })

  it('posts the expected body and applies the returned messages', async () => {
    const spy = vi.spyOn(api, 'a2uiAction').mockResolvedValue({
      messages: [
        {
          version: 'v0.9',
          updateDataModel: { surfaceId: SID, path: '/questions/q1/feedback', value: 'Correct. Four.' },
        },
      ],
    })
    show(quiz())
    fireEvent.click(await screen.findByRole('button', { name: 'Check' }))
    expect(await screen.findByText('Correct. Four.')).toBeTruthy()
    expect(spy).toHaveBeenCalledTimes(1)
    const [id, body] = spy.mock.calls[0] as [string, { version: string; action: Record<string, unknown> }]
    expect(id).toBe('11111111-1111-1111-1111-111111111111')
    expect(body.version).toBe('v0.9')
    expect(body.action).toMatchObject({ name: 'check_answer', surfaceId: SID, sourceComponentId: 'check' })
    expect(body.action.context).toEqual({ question: 'q1' })
    expect(typeof body.action.timestamp).toBe('string')
  })

  it('shows a failed action as an error under the surface', async () => {
    vi.spyOn(api, 'a2uiAction').mockRejectedValue(new Error('Surface not found'))
    show(quiz())
    fireEvent.click(await screen.findByRole('button', { name: 'Check' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Surface not found')
    expect(screen.getByText('What is 2 + 2?')).toBeTruthy()
  })

  it('shows a note for a surface that fails to process, and the answer text still shows', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    const bad: SurfaceOut = {
      id: '22222222-2222-2222-2222-222222222222',
      kind: 'quiz',
      title: 'Broken',
      messages: [{ version: 'v0.9', updateComponents: { surfaceId: 'nope', components: [] } }],
    }
    const entries: Entry[] = [{ id: 1, role: 'assistant', content: 'Here is your quiz.', surfaces: [bad] }]
    render(<MessageList entries={entries} busy={false} onRetry={() => {}} onStarter={() => {}} />)
    expect(await screen.findByText('This interactive part could not be shown.')).toBeTruthy()
    expect(screen.getByText('Here is your quiz.')).toBeTruthy()
  })

  it('replays the answered state of a stored chat', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    const answered = quiz([
      {
        version: 'v0.9',
        updateDataModel: { surfaceId: SID, path: '/questions/q1/feedback', value: 'Correct. Four.' },
      },
    ])
    const entries: Entry[] = [{ id: 1, role: 'assistant', content: 'Quiz below.', surfaces: [answered] }]
    render(<MessageList entries={entries} busy={false} onRetry={() => {}} onStarter={() => {}} />)
    await waitFor(() => expect(screen.getByText('Correct. Four.')).toBeTruthy())
  })
})
