/** Spec: kh-connector - the Knowledge Hub card on Settings -> Agents -> Connections (not configured, connect, waiting, cancel, refused, expired, disconnect). */
import { act, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeApi } from '../test/fakeApi'
import { renderAppReady } from '../test/render'

const khCard = async () => within(await screen.findByRole('article', { name: 'Knowledge Hub' }))
const callsOf = (state: ReturnType<typeof installFakeApi>, method: string, url: string) =>
  state.calls.filter((c) => c.method === method && c.url === url)

/** Lets the card's check timer fire (with fake timers) and its request settle. */
const tick = async (seconds: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(seconds * 1000)
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Knowledge Hub card', () => {
  // Scenario: Not configured
  it('says the connector is not set up and shows no Connect button', async () => {
    const state = installFakeApi()
    state.kh.available = false
    await renderAppReady('#/settings/agents/connections')
    const card = await khCard()
    expect(await card.findByText(/not set up on this server/)).toBeInTheDocument()
    expect(card.queryByRole('button', { name: 'Connect' })).toBeNull()
  })

  // Scenario: Waiting
  it('shows the code, a new-tab link and that it is waiting after Connect', async () => {
    const state = installFakeApi()
    const { user } = await renderAppReady('#/settings/agents/connections')
    const card = await khCard()
    await user.click(await card.findByRole('button', { name: 'Connect' }))
    expect(await card.findByLabelText('Sign-in code')).toHaveTextContent('ABCD-EFGH')
    const link = card.getByRole('link', { name: 'Open sign-in page' })
    expect(link).toHaveAttribute('href', 'https://idp.example.test/device?user_code=ABCD-EFGH')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(card.getByText(/Waiting for you to sign in/)).toBeInTheDocument()
    expect(callsOf(state, 'POST', '/api/kh/connect')).toHaveLength(1)
  })

  it('shows Waiting again after a reload while the sign-in is pending', async () => {
    const state = installFakeApi()
    state.kh.status = 'pending'
    state.kh.pending = {
      verification_uri: 'https://idp.example.test/device',
      verification_uri_complete: null,
      user_code: 'WXYZ-1234',
      interval: 5,
      expires_at: '2030-01-01T00:10:00Z',
    }
    await renderAppReady('#/settings/agents/connections')
    const card = await khCard()
    expect(await card.findByLabelText('Sign-in code')).toHaveTextContent('WXYZ-1234')
    expect(card.getByRole('link', { name: 'Open sign-in page' })).toHaveAttribute(
      'href',
      'https://idp.example.test/device',
    )
  })

  // Scenario: Connect
  it('checks at the interval the server gave, then shows who is connected', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = installFakeApi()
    state.kh.interval = 3
    const { user } = await renderAppReady('#/settings/agents/connections')
    const card = await khCard()
    await user.click(await card.findByRole('button', { name: 'Connect' }))
    await card.findByLabelText('Sign-in code')
    await tick(2)
    expect(state.kh.polls).toBe(0)
    await tick(1.5)
    expect(state.kh.polls).toBe(1)
    expect(card.getByText(/Waiting for you to sign in/)).toBeInTheDocument()
    state.kh.outcome = 'connected'
    await tick(3.5)
    expect(state.kh.polls).toBe(2)
    expect(card.getByText('Connected as ada@kh.example.test')).toBeInTheDocument()
    await tick(10)
    expect(state.kh.polls).toBe(2)
  })

  // Scenario: Cancel while waiting
  it('Cancel deletes the pending connection and offers Connect again', async () => {
    const state = installFakeApi()
    const { user } = await renderAppReady('#/settings/agents/connections')
    const card = await khCard()
    await user.click(await card.findByRole('button', { name: 'Connect' }))
    await user.click(await card.findByRole('button', { name: 'Cancel' }))
    expect(await card.findByRole('button', { name: 'Connect' })).toBeInTheDocument()
    expect(callsOf(state, 'DELETE', '/api/kh')).toHaveLength(1)
    expect(state.kh.status).toBe('disconnected')
  })

  // Scenario: Sign-in refused
  it('says the sign-in was refused, with the reason, and offers Connect again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = installFakeApi()
    state.kh.interval = 1
    state.kh.outcome = 'denied'
    state.kh.reason = 'You are not registered in Knowledge Hub.'
    const { user } = await renderAppReady('#/settings/agents/connections')
    const card = await khCard()
    await user.click(await card.findByRole('button', { name: 'Connect' }))
    await card.findByLabelText('Sign-in code')
    await tick(1.5)
    const alert = card.getByRole('alert')
    expect(alert).toHaveTextContent('The sign-in was refused.')
    expect(alert).toHaveTextContent('You are not registered in Knowledge Hub.')
    expect(card.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
  })

  // Scenario: Code expired
  it('says the sign-in expired and offers Connect again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = installFakeApi()
    state.kh.interval = 1
    state.kh.outcome = 'expired'
    const { user } = await renderAppReady('#/settings/agents/connections')
    const card = await khCard()
    await user.click(await card.findByRole('button', { name: 'Connect' }))
    await card.findByLabelText('Sign-in code')
    await tick(1.5)
    expect(card.getByRole('alert')).toHaveTextContent('The sign-in expired')
    expect(card.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
  })

  it('stops checking when the user leaves the page', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = installFakeApi()
    state.kh.interval = 1
    const { user, unmount } = await renderAppReady('#/settings/agents/connections')
    const card = await khCard()
    await user.click(await card.findByRole('button', { name: 'Connect' }))
    await card.findByLabelText('Sign-in code')
    await tick(1.5)
    const seen = state.kh.polls
    expect(seen).toBeGreaterThan(0)
    unmount()
    await tick(10)
    expect(state.kh.polls).toBe(seen)
  })

  describe('connected', () => {
    const connected = () => {
      const state = installFakeApi()
      state.kh.status = 'connected'
      state.kh.email = 'ada@kh.example.test'
      return state
    }

    // Scenario: Disconnect
    it('Disconnect, once confirmed, ends the connection and offers Connect again', async () => {
      const state = connected()
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
      const { user } = await renderAppReady('#/settings/agents/connections')
      const card = await khCard()
      expect(await card.findByText('Connected as ada@kh.example.test')).toBeInTheDocument()
      await user.click(card.getByRole('button', { name: 'Disconnect' }))
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(await card.findByRole('button', { name: 'Connect' })).toBeInTheDocument()
      expect(callsOf(state, 'DELETE', '/api/kh')).toHaveLength(1)
    })

    // Scenario: Disconnect is confirmed first
    it('keeps the connection when the user declines', async () => {
      const state = connected()
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      const { user } = await renderAppReady('#/settings/agents/connections')
      const card = await khCard()
      await user.click(await card.findByRole('button', { name: 'Disconnect' }))
      expect(card.getByText('Connected as ada@kh.example.test')).toBeInTheDocument()
      expect(callsOf(state, 'DELETE', '/api/kh')).toHaveLength(0)
    })
  })
})
