/** Spec: notifications - Bell and list, Notifications are private and safe, New notifications appear without reload. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../api'
import { installFakeApi, makeNotification, type FakeState } from '../test/fakeApi'
import { NotificationBell } from './NotificationBell'

let state: FakeState
let client: QueryClient

function show() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <NotificationBell />
    </QueryClientProvider>,
  )
}
const bell = () => screen.getByRole('button', { name: 'Notifications' })

beforeEach(() => {
  state = installFakeApi()
  window.location.hash = ''
})
afterEach(() => vi.unstubAllGlobals())

describe('NotificationBell', () => {
  it('shows the unread count, hidden at zero', async () => {
    state.notifications = [1, 2, 3].map((n) => makeNotification('kh_reconnect', {}, { read_at: n === 3 ? '2026-11-20T13:00:00Z' : null }))
    show()
    expect(await screen.findByText('2')).toBeInTheDocument()
    state.notifications.forEach((n) => (n.read_at = 'x'))
    await client.invalidateQueries({ queryKey: queryKeys.unreadCount })
    await waitFor(() => expect(screen.queryByText('2')).not.toBeInTheDocument())
  })

  it('shows 99+ above 99', async () => {
    state.notifications = Array.from({ length: 100 }, () => makeNotification('kh_reconnect', {}))
    show()
    expect(await screen.findByText('99+')).toBeInTheDocument()
  })

  it('polls every minute while visible and on focus, and loads the list only when opened', async () => {
    show()
    await waitFor(() => expect(client.getQueryCache().find({ queryKey: queryKeys.unreadCount })).toBeDefined())
    const options = client.getQueryCache().find({ queryKey: queryKeys.unreadCount })!.options as {
      refetchInterval?: number
      refetchIntervalInBackground?: boolean
      refetchOnWindowFocus?: boolean
    }
    expect(options.refetchInterval).toBe(60_000)
    expect(options.refetchIntervalInBackground).toBe(false)
    expect(options.refetchOnWindowFocus).toBe(true)
    expect(bell()).toHaveAttribute('aria-expanded', 'false')
    expect(state.calls.some((c) => c.url === '/api/notifications')).toBe(false)
  })

  it('opens a notification: marks it read, goes to its page', async () => {
    state.notifications = [makeNotification('lesson_ready', { node: 'backend/graphql', title: 'backend/graphql' }, { link: '#/lesson/backend/graphql' })]
    const user = userEvent.setup()
    show()
    await screen.findByText('1')
    await user.click(bell())
    expect(bell()).toHaveAttribute('aria-expanded', 'true')
    await user.click(await screen.findByRole('button', { name: /Lesson ready: backend\/graphql/ }))
    expect(window.location.hash).toBe('#/lesson/backend/graphql')
    expect(state.notifications[0].read_at).not.toBeNull()
    expect(state.calls.some((c) => c.url === `/api/notifications/${state.notifications[0].id}/read` && c.method === 'POST')).toBe(true)
    expect(state.headers.at(-1)?.['X-LearningHub']).toBe('1')
    await waitFor(() => expect(screen.queryByText('1')).not.toBeInTheDocument())
  })

  it('does not follow a link that does not start with #/', async () => {
    state.notifications = [
      makeNotification('kh_reconnect', {}, { link: 'https://evil.example/x' }),
      makeNotification('restored', { notes: 2, lessons: 1 }, { link: '//evil.example' }),
    ]
    const user = userEvent.setup()
    show()
    await user.click(bell())
    await user.click(await screen.findByRole('button', { name: /Knowledge Hub needs reconnecting/ }))
    await waitFor(() => expect(state.notifications.some((n) => n.kind === 'kh_reconnect' && n.read_at)).toBe(true))
    expect(window.location.hash).toBe('')
    await user.click(bell())
    await user.click(await screen.findByRole('button', { name: /Data restored from a backup: 2 notes, 1 lessons/ }))
    expect(window.location.hash).toBe('')
  })

  it('Mark all read clears the count and the unread marks', async () => {
    state.notifications = [makeNotification('kh_reconnect', {}), makeNotification('field_published', { title: 'Finance' })]
    const user = userEvent.setup()
    show()
    await screen.findByText('2')
    await user.click(bell())
    await screen.findByText(/New field published: Finance/)
    expect(screen.getAllByText('Unread:', { exact: false })).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(screen.queryByText('Unread:', { exact: false })).not.toBeInTheDocument())
    expect(screen.queryByText('2')).not.toBeInTheDocument()
  })

  it('shows markup in a name literally', async () => {
    const name = '<img src=x onerror=alert(1)>'
    state.notifications = [makeNotification('new_member', { name, email: 'a@b.test' })]
    const user = userEvent.setup()
    const { container } = show()
    await user.click(bell())
    expect(await screen.findByText(`New member: ${name} (a@b.test) joined`)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('writes one text per kind and a generic one for an unknown kind', async () => {
    state.notifications = [
      makeNotification('shared_limit', { used: 16, limit: 20, resets_at: '2026-11-21T00:00:00Z' }),
      makeNotification('shared_limit', { used: 20, limit: 20, resets_at: '2026-11-21T00:00:00Z' }),
      makeNotification('provider_problem', { name: 'Main', category: 'invalid_key', fallback: true }),
      makeNotification('new_sign_in', { browser: 'Firefox', system: 'Linux', address: '10.0.0.1' }),
      makeNotification('from_the_future', { x: 1 }),
    ]
    const user = userEvent.setup()
    show()
    await user.click(bell())
    expect(await screen.findByText(/You used 16 of 20 shared requests today; resets /)).toBeInTheDocument()
    expect(screen.getByText(/You reached the shared limit of 20 requests; resets /)).toBeInTheDocument()
    expect(screen.getByText("Provider 'Main' failed (invalid key); the fallback answered")).toBeInTheDocument()
    expect(screen.getByText('New sign-in: Firefox on Linux, 10.0.0.1')).toBeInTheDocument()
    expect(screen.getByText('Notification')).toBeInTheDocument()
  })

  it('shows an empty state and closes on Escape with focus back on the bell', async () => {
    const user = userEvent.setup()
    show()
    await user.click(bell())
    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(bell()).toHaveAttribute('aria-expanded', 'false')
    expect(bell()).toHaveFocus()
  })

  it('loads the next page of 20', async () => {
    state.notifications = Array.from({ length: 25 }, (_, i) => makeNotification('field_published', { title: `F${i}` }))
    const user = userEvent.setup()
    show()
    await user.click(bell())
    await screen.findByText(/New field published: F24/)
    expect(screen.queryByText(/New field published: F0$/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText(/New field published: F0$/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })
})
