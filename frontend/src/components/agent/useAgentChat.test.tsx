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
    const chat = vi.spyOn(api, 'chat').mockReturnValue(new Promise((resolve) => (finish = resolve)))
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
      .spyOn(api, 'chat')
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
