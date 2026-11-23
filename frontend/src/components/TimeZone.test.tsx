/** Spec: accounts - Each user chooses a time zone, Times are shown in the user's time zone. */
import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatSessionDetail } from '../api'
import { installFakeApi, OWNER, requireLogin, twoProviders, type FakeState } from '../test/fakeApi'
import { renderAppReady } from '../test/render'
import { browserZone } from '../lib/time'

const HCM = 'Asia/Ho_Chi_Minh'
const dialog = () => screen.findByRole('dialog', { name: 'Your time zone' })
const noDialog = () => expect(screen.queryByRole('dialog', { name: 'Your time zone' })).not.toBeInTheDocument()
const zoneForm = () => screen.getByLabelText('Time zone').closest('form') as HTMLElement
const puts = (state: FakeState) => state.calls.filter((c) => c.url === '/api/auth/timezone')

function setup(timezone: string | null | undefined) {
  const state = installFakeApi()
  requireLogin(state, { signedIn: true, owner: { ...OWNER, timezone } })
  return state
}

async function logInAgain(user: Awaited<ReturnType<typeof renderAppReady>>['user']) {
  const page = await screen.findByRole('main', { name: 'Log in' })
  await user.type(within(page).getByLabelText('Email'), OWNER.email)
  await user.type(within(page).getByLabelText('Password'), OWNER.password ?? '')
  await user.click(within(page).getByRole('button', { name: 'Log in' }))
}

beforeEach(() => window.sessionStorage.clear())

describe('the sign-in dialog', () => {
  it('proposes the browser zone and Save stores it', async () => {
    const state = setup(null)
    const { user } = await renderAppReady()
    const box = await dialog()
    expect(within(box).getByLabelText('Time zone')).toHaveValue(browserZone())
    await user.click(within(box).getByRole('button', { name: 'Save' }))
    await waitFor(() => noDialog())
    expect(puts(state)).toHaveLength(1)
    expect(puts(state)[0].body).toEqual({ timezone: browserZone() })
    // The mutating call carries the app header.
    const index = state.calls.findIndex((c) => c.url === '/api/auth/timezone')
    expect(state.headers[index]['X-LearningHub']).toBe('1')
    expect(state.auth.owner?.timezone).toBe(browserZone())
  })

  it('saves the zone the member picked', async () => {
    const state = setup(null)
    const { user } = await renderAppReady()
    const box = await dialog()
    await user.selectOptions(within(box).getByLabelText('Time zone'), 'Asia/Tokyo')
    await user.click(within(box).getByRole('button', { name: 'Save' }))
    await waitFor(() => noDialog())
    expect(puts(state)[0].body).toEqual({ timezone: 'Asia/Tokyo' })
  })

  it('asks after signing in with the login form', async () => {
    const state = installFakeApi()
    requireLogin(state, { owner: { ...OWNER, timezone: null } })
    const { user } = await renderAppReady()
    await logInAgain(user)
    expect(await dialog()).toBeInTheDocument()
  })

  it('Not now stores nothing and does not return while signed in', async () => {
    const state = setup(null)
    const { user, unmount } = await renderAppReady()
    await user.click(within(await dialog()).getByRole('button', { name: 'Not now' }))
    noDialog()
    expect(puts(state)).toHaveLength(0)
    expect(state.auth.owner?.timezone).toBeNull()
    // A reload in the same browser session does not ask again.
    unmount()
    await renderAppReady()
    await screen.findByRole('complementary', { name: 'Learned items' })
    noDialog()
  })

  it('Escape works like Not now', async () => {
    const state = setup(null)
    const { user } = await renderAppReady()
    await dialog()
    await user.keyboard('{Escape}')
    await waitFor(() => noDialog())
    expect(puts(state)).toHaveLength(0)
  })

  it('is shown again after the next sign-in', async () => {
    const state = setup(null)
    const { user } = await renderAppReady()
    await user.click(within(await dialog()).getByRole('button', { name: 'Not now' }))
    await user.click(await screen.findByRole('button', { name: /^Account menu/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }))
    await logInAgain(user)
    expect(await dialog()).toBeInTheDocument()
    expect(puts(state)).toHaveLength(0)
  })

  it('is not shown to a member who saved a time zone', async () => {
    setup(HCM)
    await renderAppReady()
    await screen.findByRole('complementary', { name: 'Learned items' })
    noDialog()
  })

  it('shows a failed save and stays open', async () => {
    const state = setup(null)
    state.auth.timezoneError = 'unknown time zone'
    const { user } = await renderAppReady()
    const box = await dialog()
    await user.click(within(box).getByRole('button', { name: 'Save' }))
    expect(await within(box).findByRole('alert')).toHaveTextContent('unknown time zone')
    expect(await dialog()).toBeInTheDocument()
    expect(state.auth.owner?.timezone).toBeNull()
  })
})

describe('Settings > Account', () => {
  it('changes the time zone, kept after a reload', async () => {
    const state = setup(HCM)
    const { user, unmount } = await renderAppReady('#/settings/account')
    const field = await screen.findByLabelText('Time zone')
    expect(field).toHaveValue(HCM)
    const save = within(zoneForm()).getByRole('button', { name: 'Save' })
    const cancel = within(zoneForm()).getByRole('button', { name: 'Cancel' })
    expect(save).toBeDisabled()
    await user.selectOptions(field, 'Asia/Tokyo')
    expect(save).toBeEnabled()
    await user.click(save)
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    expect(puts(state)[0].body).toEqual({ timezone: 'Asia/Tokyo' })
    expect(save).toBeDisabled()
    expect(cancel).toBeDisabled()
    unmount()
    await renderAppReady('#/settings/account')
    expect(await screen.findByLabelText('Time zone')).toHaveValue('Asia/Tokyo')
  })

  it('Cancel puts the stored zone back without saving', async () => {
    const state = setup(HCM)
    const { user } = await renderAppReady('#/settings/account')
    const field = await screen.findByLabelText('Time zone')
    await user.selectOptions(field, 'Asia/Tokyo')
    await user.click(within(zoneForm()).getByRole('button', { name: 'Cancel' }))
    expect(field).toHaveValue(HCM)
    expect(within(zoneForm()).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(puts(state)).toHaveLength(0)
  })

  it('shows a failed save', async () => {
    const state = setup(HCM)
    state.auth.timezoneError = 'unknown time zone'
    const { user } = await renderAppReady('#/settings/account')
    await user.selectOptions(await screen.findByLabelText('Time zone'), 'Asia/Tokyo')
    await user.click(within(zoneForm()).getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('unknown time zone')
    expect(within(zoneForm()).getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('shows the browser zone while none is chosen', async () => {
    setup(null)
    const { user } = await renderAppReady('#/settings/account')
    await user.click(within(await dialog()).getByRole('button', { name: 'Not now' }))
    await waitFor(() => noDialog())
    expect(screen.getByLabelText('Time zone')).toHaveValue(browserZone())
    expect(within(zoneForm()).getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

describe('times in the chat history', () => {
  const chat = (): ChatSessionDetail => ({
    id: 's1',
    title: 'late chat',
    created_at: '2026-11-12T23:30:00Z',
    last_message_at: '2026-11-12T23:30:00Z',
    message_count: 2,
    messages: [],
  })

  async function openHistory(state: FakeState) {
    state.providers = twoProviders()
    state.chatSessions = [chat()]
    const { user } = await renderAppReady()
    const panel = screen.getByRole('complementary', { name: 'Agent' })
    await user.click(await within(panel).findByRole('button', { name: 'History' }))
    return within(await within(panel).findByRole('region', { name: 'Chat history' }))
  }

  it('shows 23:30 UTC as 06:30 on the next day in the chosen zone', async () => {
    const history = await openHistory(setup(HCM))
    expect(await history.findByText(/Nov 13, 2026.*6:30\s?AM/)).toBeInTheDocument()
  })

  it('uses the browser zone while the user has none', async () => {
    const history = await openHistory(setup(null))
    const expected = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date('2026-11-12T23:30:00Z'),
    )
    expect(await history.findByText((text) => text.includes(expected))).toBeInTheDocument()
  })
})
