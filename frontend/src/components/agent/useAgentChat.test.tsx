/** Spec: agent-stop - Stop a running answer (client side). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, type ChatReply } from '../../api'
import { useAgentChat, type Turn } from './useAgentChat'

const reply = (over: Partial<ChatReply> = {}): ChatReply => ({
  reply: 'ok',
  steps: [],
  changed_lessons: [],
  stopped: false,
  provider: { id: 'p', name: 'P', model: 'm' },
  fallback_used: false,
  effort: 'medium',
  session: { id: 's1', title: 't' },
  user_message_id: 'u1',
  assistant_message_id: 'a1',
  ...over,
})

const turn: Turn = { display: 'hi', content: 'hi', attachments: [], agentId: 'assistant' }

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(() => useAgentChat({ effort: 'medium', page: { kind: 'home' } as never }), { wrapper })
}

afterEach(() => vi.restoreAllMocks())

describe('useAgentChat stop', () => {
  it('sends a run id, stops once, keeps waiting and marks the stopped answer', async () => {
    let finish!: (r: ChatReply) => void
    const chat = vi.spyOn(api, 'chatStream').mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const stop = vi.spyOn(api, 'stopAgentRun').mockResolvedValue(undefined)
    const { result } = setup()

    act(() => void result.current.send(turn))
    await waitFor(() => expect(result.current.busy).toBe(true))
    const runId = chat.mock.calls[0][0].run_id
    expect(runId).toMatch(/^[0-9a-f-]{36}$/)

    act(() => result.current.stop())
    act(() => result.current.stop())
    expect(stop).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledWith(runId)
    expect(result.current.stopping).toBe(true)
    expect(result.current.busy).toBe(true)

    await act(async () => finish(reply({ stopped: true, reply: 'Stopped by you.' })))
    expect(result.current.stopping).toBe(false)
    expect(result.current.busy).toBe(false)
    expect(result.current.entries.at(-1)).toMatchObject({ role: 'assistant', stopped: true, content: 'Stopped by you.' })
  })

  it('uses a new run id per send and resets stopping on an error', async () => {
    let fail!: (e: Error) => void
    const chat = vi
      .spyOn(api, 'chatStream')
      .mockReturnValueOnce(new Promise((_, reject) => (fail = reject)))
      .mockResolvedValueOnce(reply())
    vi.spyOn(api, 'stopAgentRun').mockResolvedValue(undefined)
    const { result } = setup()

    act(() => void result.current.send(turn))
    await waitFor(() => expect(result.current.busy).toBe(true))
    act(() => result.current.stop())
    await act(async () => fail(new Error('boom')))
    expect(result.current.stopping).toBe(false)
    expect(result.current.entries[0].error).toBe('boom')

    await act(() => result.current.send(turn))
    expect(chat.mock.calls[1][0].run_id).not.toBe(chat.mock.calls[0][0].run_id)
  })

  it('sends nothing when no answer is pending', () => {
    const stop = vi.spyOn(api, 'stopAgentRun').mockResolvedValue(undefined)
    const { result } = setup()
    act(() => result.current.stop())
    expect(stop).not.toHaveBeenCalled()
  })
})

/** Spec: agent-streaming - The answer is streamed while it is written (client side). */
describe('useAgentChat streaming', () => {
  type OnEvent = Parameters<typeof api.chatStream>[1]

  it('grows the answer, drops text before a step, then shows the final answer', async () => {
    let emit!: OnEvent
    let finish!: (r: ChatReply) => void
    vi.spyOn(api, 'chatStream').mockImplementation((_, onEvent) => {
      emit = onEvent
      return new Promise((resolve) => (finish = resolve))
    })
    const { result } = setup()
    act(() => void result.current.send(turn))
    await waitFor(() => expect(result.current.busy).toBe(true))

    act(() => emit({ type: 'text', text: 'Let me ' }))
    act(() => emit({ type: 'text', text: 'look.' }))
    expect(result.current.entries.at(-1)).toMatchObject({ role: 'assistant', content: 'Let me look.', streaming: true })

    const step = { tool: 'search_notes', input: { query: 'redis' }, summary: 'Searched notes' }
    act(() => emit({ type: 'step', step }))
    expect(result.current.entries.at(-1)).toMatchObject({ content: '', steps: [step], streaming: true })

    act(() => emit({ type: 'text', text: 'Redis is' }))
    expect(result.current.entries.at(-1)?.content).toBe('Redis is')

    await act(async () => finish(reply({ reply: 'Redis is a cache.', steps: [step] })))
    expect(result.current.busy).toBe(false)
    expect(result.current.entries).toHaveLength(2)
    expect(result.current.entries.at(-1)).toMatchObject({ content: 'Redis is a cache.', steps: [step], messageId: 'a1' })
    expect(result.current.entries.at(-1)?.streaming).toBeUndefined()
  })

  it('removes the partial answer when the run fails', async () => {
    let emit!: OnEvent
    let fail!: (e: Error) => void
    vi.spyOn(api, 'chatStream').mockImplementation((_, onEvent) => {
      emit = onEvent
      return new Promise((_, reject) => (fail = reject))
    })
    const { result } = setup()
    act(() => void result.current.send(turn))
    await waitFor(() => expect(result.current.busy).toBe(true))
    act(() => emit({ type: 'text', text: 'Half an ans' }))
    await act(async () => fail(new Error('provider down')))
    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0]).toMatchObject({ role: 'user', error: 'provider down' })
  })
})

describe('api.chatStream', () => {
  const ndjson = (...lines: unknown[]) =>
    new Response(lines.map((l) => JSON.stringify(l) + '\n').join(''), {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
    })
  const body = { agent_id: 'assistant', messages: [{ role: 'user' as const, content: 'hi' }], page: { kind: 'home' } as never }

  it('asks for a stream, passes events on and returns the done answer', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ndjson({ type: 'text', text: 'He' }, { type: 'text', text: 'llo' }, { type: 'done', answer: reply({ reply: 'Hello' }) }),
    )
    const events: unknown[] = []
    const answer = await api.chatStream(body, (e) => events.push(e))
    expect(answer.reply).toBe('Hello')
    expect(events).toEqual([
      { type: 'text', text: 'He' },
      { type: 'text', text: 'llo' },
    ])
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers.Accept).toBe('application/x-ndjson')
    expect(headers['X-LearningHub']).toBe('1')
  })

  it('throws the error line as an ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ndjson({ type: 'text', text: 'x' }, { type: 'error', status: 502, detail: 'P (m): unavailable' }))
    await expect(api.chatStream(body, () => {})).rejects.toMatchObject({ status: 502, message: 'P (m): unavailable' })
  })

  it('reads an HTTP error and a plain JSON answer like any request', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Too many agent requests' }), { status: 429, headers: { 'Content-Type': 'application/json' } }),
    )
    await expect(api.chatStream(body, () => {})).rejects.toMatchObject({ status: 429, message: 'Too many agent requests' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(reply({ reply: 'plain' })), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    expect((await api.chatStream(body, () => {})).reply).toBe('plain')
  })
})
