/** Spec: agent-chat - Chat pet shows the agent's state; Pet text is fixed. */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DONE_MS, ERROR_MS, GREETING_MS, PET_LINES, usePetState } from './pet'

type Entries = { error?: string }[]
const props = (busy: boolean, entries: Entries = []) => ({ busy, entries })
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('usePetState', () => {
  // Scenario: Greeting
  it('greets at first mount and goes idle with no line after 6 s', () => {
    const { result } = renderHook((p) => usePetState(p), { initialProps: props(false) })
    expect(result.current).toEqual({ pose: 'idle', line: PET_LINES.greeting })
    wait(GREETING_MS - 1)
    expect(result.current.line).toBe(PET_LINES.greeting)
    wait(1)
    expect(result.current).toEqual({ pose: 'idle', line: null })
  })

  // Scenario: Thinking
  it('thinks for as long as the request runs, past the greeting time', () => {
    const { result, rerender } = renderHook((p) => usePetState(p), { initialProps: props(false) })
    rerender(props(true))
    expect(result.current).toEqual({ pose: 'thinking', line: PET_LINES.thinking })
    wait(60_000)
    expect(result.current).toEqual({ pose: 'thinking', line: PET_LINES.thinking })
  })

  it('starts as thinking when it mounts during a request', () => {
    const { result } = renderHook((p) => usePetState(p), { initialProps: props(true) })
    expect(result.current.pose).toBe('thinking')
    wait(GREETING_MS)
    expect(result.current.pose).toBe('thinking')
  })

  // Scenario: Done
  it('shows done for 4 s when the answer arrives, then idle with no bubble', () => {
    const { result, rerender } = renderHook((p) => usePetState(p), { initialProps: props(false) })
    rerender(props(true))
    rerender(props(false, [{}, {}]))
    expect(result.current).toEqual({ pose: 'done', line: PET_LINES.done })
    wait(DONE_MS - 1)
    expect(result.current.pose).toBe('done')
    wait(1)
    expect(result.current).toEqual({ pose: 'idle', line: null })
  })

  // Scenario: Error
  it('shows error for 6 s when the newest entry failed, then idle', () => {
    const { result, rerender } = renderHook((p) => usePetState(p), { initialProps: props(false) })
    rerender(props(true, [{}]))
    rerender(props(false, [{ error: 'Claude main: auth_failed' }]))
    expect(result.current).toEqual({ pose: 'error', line: PET_LINES.error })
    wait(ERROR_MS - 1)
    expect(result.current.pose).toBe('error')
    wait(1)
    expect(result.current).toEqual({ pose: 'idle', line: null })
  })

  // Scenario: Answer text stays out of the bubble
  it('never puts entry or error text in the line', () => {
    const { result, rerender } = renderHook((p) => usePetState(p), { initialProps: props(false) })
    rerender(props(true, [{}]))
    rerender(props(false, [{ error: 'SECRET-ERROR-TEXT' }]))
    expect(result.current.line).toBe(PET_LINES.error)
    rerender(props(true, [{}]))
    rerender(props(false, [{}]))
    expect(result.current.line).toBe(PET_LINES.done)
    expect(Object.values(PET_LINES)).toEqual([
      'Hi! What are we learning today?',
      'Thinking…',
      'Done!',
      "That didn't work. Try again?",
    ])
  })

  it('starts a new request over a running done timeout', () => {
    const { result, rerender } = renderHook((p) => usePetState(p), { initialProps: props(true) })
    rerender(props(false, [{}]))
    wait(DONE_MS - 100)
    rerender(props(true, [{}]))
    wait(1000)
    expect(result.current.pose).toBe('thinking')
  })

  it('does not change the pose when the entries change without a request (history, Clear chat)', () => {
    const { result, rerender } = renderHook((p) => usePetState(p), { initialProps: props(false) })
    wait(GREETING_MS)
    rerender(props(false, [{ error: 'x' }, {}]))
    expect(result.current).toEqual({ pose: 'idle', line: null })
    rerender(props(false, []))
    expect(result.current).toEqual({ pose: 'idle', line: null })
  })

  it('clears its timer on unmount', () => {
    const { rerender, unmount } = renderHook((p) => usePetState(p), { initialProps: props(true) })
    rerender(props(false, [{}]))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
