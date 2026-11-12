/** Spec: accounts - Admin and members, Invite only, Users page, Admin-only features (as far as the UI shows them). */
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminUser } from '../api'
import { installFakeApi, OWNER, requireLogin, type FakeState } from '../test/fakeApi'
import { renderApp, renderAppReady } from '../test/render'

afterEach(() => vi.restoreAllMocks())

const ADA: AdminUser = {
  id: 'u1',
  email: OWNER.email,
  display_name: 'Ada Lovelace',
  role: 'admin',
  created_at: '2026-10-01T09:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  disabled: false,
}
const ANA: AdminUser = {
  id: 'u2',
  email: 'ana@example.test',
  display_name: 'Ana',
  role: 'member',
  created_at: '2026-10-05T09:00:00Z',
  last_seen_at: null,
  disabled: false,
}

function adminState(): FakeState {
  const state = installFakeApi()
  requireLogin(state, { signedIn: true })
  state.admin.users = [{ ...ADA }, { ...ANA }]
  return state
}

const openUsers = async () => {
  const rendered = await renderAppReady('#/settings/users')
  const page = await screen.findByRole('region', { name: 'Users' })
  return { ...rendered, page }
}
const calls = (state: FakeState, method: string, prefix: string) =>
  state.calls.filter((c) => c.method === method && c.url.startsWith(prefix))

describe('role in the account menu and the settings nav', () => {
  it('shows Admin under the email, and the Users and Sign-in links', async () => {
    adminState()
    const { user } = await renderAppReady('#/settings')
    await user.click(await screen.findByRole('button', { name: /Account menu/ }))
    expect(screen.getByText('Admin')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getByRole('link', { name: 'Users' })).toHaveAttribute('href', '#/settings/users')
    expect(within(nav).getByRole('link', { name: 'Sign-in' })).toBeInTheDocument()
  })

  it('shows Member, hides Users and Sign-in, keeps AI providers and Data & sync', async () => {
    const state = installFakeApi()
    requireLogin(state, { signedIn: true, owner: { ...OWNER, role: 'member' } })
    const { user } = await renderAppReady('#/settings')
    await user.click(await screen.findByRole('button', { name: /Account menu/ }))
    expect(screen.getByText('Member')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).queryByRole('link', { name: 'Users' })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Sign-in' })).not.toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'AI providers' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Data & sync' })).toBeInTheDocument()
  })

  it.each(['#/settings/users', '#/settings/sign-in'])('refuses a member who opens %s', async (hash) => {
    const state = installFakeApi()
    requireLogin(state, { signedIn: true, owner: { ...OWNER, role: 'member' } })
    await renderAppReady(hash)
    expect(await screen.findByText('Only the admin can open this page.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Settings' })).toHaveAttribute('href', '#/settings')
    expect(screen.queryByRole('region', { name: 'Users' })).not.toBeInTheDocument()
    expect(state.calls.some((c) => c.url.startsWith('/api/admin/'))).toBe(false)
  })
})

describe('users page', () => {
  it('lists the users with their columns and marks the admin row "You" without actions', async () => {
    adminState()
    const { page } = await openUsers()
    const table = await within(page).findByRole('table')
    for (const name of ['Email', 'Name', 'Role', 'Last seen', 'Status']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument()
    }
    const own = within(table).getByRole('row', { name: new RegExp(OWNER.email) })
    expect(within(own).getByText('You')).toBeInTheDocument()
    expect(within(own).queryByRole('button')).not.toBeInTheDocument()
    const ana = within(table).getByRole('row', { name: /ana@example.test/ })
    expect(within(ana).getByRole('button', { name: 'Disable ana@example.test' })).toBeInTheDocument()
    expect(within(ana).getByRole('button', { name: 'Delete ana@example.test' })).toBeInTheDocument()
  })

  it('keeps the table in its own scroll area so a narrow page does not scroll sideways', async () => {
    adminState()
    const { page } = await openUsers()
    const table = await within(page).findByRole('table')
    expect(table.parentElement).toHaveClass('users-table-scroll')
  })

  it('scrolls the current settings tab into view when the browser can', async () => {
    adminState()
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      await openUsers()
      expect(scrollIntoView).toHaveBeenCalledWith({ inline: 'nearest', block: 'nearest' })
      const nav = screen.getByRole('navigation', { name: 'Settings sections' })
      const current = within(nav).getByRole('link', { name: 'Users' })
      expect(scrollIntoView.mock.contexts).toContain(current)
    } finally {
      // @ts-expect-error jsdom has no scrollIntoView; restore that state
      delete Element.prototype.scrollIntoView
    }
  })

  it('keeps Send invitation disabled until the email is valid, then sends and names the outbox', async () => {
    const state = adminState()
    state.auth.mail = 'outbox'
    const { user, page } = await openUsers()
    const send = within(page).getByRole('button', { name: 'Send invitation' })
    expect(send).toBeDisabled()
    await user.type(within(page).getByLabelText('Email'), 'not-an-email')
    expect(send).toBeDisabled()
    await user.clear(within(page).getByLabelText('Email'))
    await user.type(within(page).getByLabelText('Email'), 'bo@example.test')
    expect(send).toBeEnabled()
    await user.click(send)
    expect(await within(page).findByText('Invitation sent to bo@example.test')).toBeInTheDocument()
    expect(within(page).getByText(/written to storage\/outbox/)).toBeInTheDocument()
    expect(calls(state, 'POST', '/api/admin/invitations')[0].body).toEqual({ email: 'bo@example.test' })
    // The pending list refreshes.
    const pending = within(page).getByRole('region', { name: 'Pending invitations' })
    expect(await within(pending).findByText('bo@example.test')).toBeInTheDocument()
    expect(within(page).getByLabelText('Email')).toHaveValue('')
  })

  it('shows the invitation link with Copy when the server has no SMTP, only right after creating', async () => {
    const state = adminState()
    state.admin.inviteUrl = 'https://hub.example.test/#/auth/invite?token=abc'
    const { user, page } = await openUsers()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    await user.type(within(page).getByLabelText('Email'), 'ana2@example.test')
    await user.click(within(page).getByRole('button', { name: 'Send invitation' }))
    expect(await within(page).findByText('Invitation sent to ana2@example.test')).toBeInTheDocument()
    expect(within(page).getByText('No email server is set up: send this link to ana2@example.test.')).toBeInTheDocument()
    const field = within(page).getByLabelText('Invitation link')
    expect(field).toHaveAttribute('readonly')
    expect(field).toHaveValue('https://hub.example.test/#/auth/invite?token=abc')
    await user.click(within(page).getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('https://hub.example.test/#/auth/invite?token=abc')
    expect(await within(page).findByText('Copied')).toBeInTheDocument()
    // Not in the pending list.
    const pending = within(page).getByRole('region', { name: 'Pending invitations' })
    expect(await within(pending).findByText('ana2@example.test')).toBeInTheDocument()
    expect(within(pending).queryByDisplayValue(/auth\/invite/)).not.toBeInTheDocument()
  })

  it('shows no link when the answer has no invite_url', async () => {
    adminState()
    const { user, page } = await openUsers()
    await user.type(within(page).getByLabelText('Email'), 'bo@example.test')
    await user.click(within(page).getByRole('button', { name: 'Send invitation' }))
    expect(await within(page).findByText('Invitation sent to bo@example.test')).toBeInTheDocument()
    expect(within(page).queryByLabelText('Invitation link')).not.toBeInTheDocument()
    expect(within(page).queryByText(/No email server/)).not.toBeInTheDocument()
  })

  it('shows a 409 inline', async () => {
    const state = adminState()
    const { user, page } = await openUsers()
    await user.type(within(page).getByLabelText('Email'), ANA.email)
    await user.click(within(page).getByRole('button', { name: 'Send invitation' }))
    expect(await within(page).findByRole('alert')).toHaveTextContent('That email already has an account')
    expect(within(page).queryByText(/Invitation sent/)).not.toBeInTheDocument()
    expect(state.admin.invitations).toEqual([])
  })

  it('cancels the invite form with Escape', async () => {
    adminState()
    const { user, page } = await openUsers()
    await user.type(within(page).getByLabelText('Email'), 'bo@example.test')
    await user.keyboard('{Escape}')
    expect(within(page).getByLabelText('Email')).toHaveValue('')
  })

  it('revokes a pending invitation after a confirm', async () => {
    const state = adminState()
    state.admin.invitations = [
      { id: 'inv-9', email: 'cy@example.test', created_at: '2026-11-09T09:00:00Z', expires_at: '2026-11-16T09:00:00Z' },
    ]
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user, page } = await openUsers()
    const revoke = await within(page).findByRole('button', { name: 'Revoke cy@example.test' })
    await user.click(revoke)
    expect(state.admin.invitations).toHaveLength(1)
    confirm.mockReturnValue(true)
    await user.click(revoke)
    await waitFor(() => expect(state.admin.invitations).toHaveLength(0))
    expect(await within(page).findByText('No pending invitations.')).toBeInTheDocument()
  })

  it('disables and enables a member after a confirm', async () => {
    const state = adminState()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user, page } = await openUsers()
    await user.click(await within(page).findByRole('button', { name: 'Disable ana@example.test' }))
    await waitFor(() => expect(state.admin.users[1].disabled).toBe(true))
    expect(calls(state, 'PUT', '/api/admin/users/u2/disabled')[0].body).toEqual({ disabled: true })
    const row = await within(page).findByRole('row', { name: /ana@example.test/ })
    expect(await within(row).findByText('Disabled')).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Enable ana@example.test' }))
    await waitFor(() => expect(state.admin.users[1].disabled).toBe(false))
  })

  it('does not disable when the confirm is declined', async () => {
    const state = adminState()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user, page } = await openUsers()
    await user.click(await within(page).findByRole('button', { name: 'Disable ana@example.test' }))
    expect(state.admin.users[1].disabled).toBe(false)
  })

  it('deletes a member only after their email is typed', async () => {
    const state = adminState()
    const { user, page } = await openUsers()
    await user.click(await within(page).findByRole('button', { name: 'Delete ana@example.test' }))
    const box = screen.getByRole('dialog', { name: 'Delete ana@example.test' })
    const confirmButton = within(box).getByRole('button', { name: 'Delete user' })
    expect(confirmButton).toBeDisabled()
    await user.type(within(box).getByLabelText('Type the email to confirm'), 'ana@example')
    expect(confirmButton).toBeDisabled()
    await user.type(within(box).getByLabelText('Type the email to confirm'), '.test')
    expect(confirmButton).toBeEnabled()
    await user.click(confirmButton)
    await waitFor(() => expect(state.admin.users.map((u) => u.id)).toEqual(['u1']))
    expect(calls(state, 'DELETE', '/api/admin/users/u2')[0].body).toEqual({ confirm_email: 'ana@example.test' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('cancels the delete box', async () => {
    const state = adminState()
    const { user, page } = await openUsers()
    await user.click(await within(page).findByRole('button', { name: 'Delete ana@example.test' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(state.admin.users).toHaveLength(2)
  })
})

describe('invitation page', () => {
  it('shows who was invited, creates the account, signs in and drops the token', async () => {
    const state = installFakeApi()
    requireLogin(state, { owner: { ...OWNER } })
    state.admin.inviteTokens['good-token'] = 'ana@example.test'
    const { user } = renderApp('#/auth/invite?token=good-token')
    const page = await screen.findByRole('main', { name: 'Join Learning Hub' })
    expect(await within(page).findByText('You were invited as ana@example.test')).toBeInTheDocument()
    expect(window.location.hash).toBe('#/auth/invite')
    await user.type(within(page).getByLabelText('Display name (optional)'), 'Ana')
    await user.type(within(page).getByLabelText('Password'), 'short')
    await user.type(within(page).getByLabelText('Confirm password'), 'short')
    await user.click(within(page).getByRole('button', { name: 'Create account' }))
    expect(await within(page).findByRole('alert')).toHaveTextContent('at least 10 characters')
    await user.clear(within(page).getByLabelText('Password'))
    await user.clear(within(page).getByLabelText('Confirm password'))
    await user.type(within(page).getByLabelText('Password'), 'a long enough pass')
    await user.type(within(page).getByLabelText('Confirm password'), 'another long pass')
    await user.click(within(page).getByRole('button', { name: 'Create account' }))
    expect(await within(page).findByRole('alert')).toHaveTextContent('do not match')
    await user.clear(within(page).getByLabelText('Confirm password'))
    await user.type(within(page).getByLabelText('Confirm password'), 'a long enough pass')
    await user.click(within(page).getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(state.auth.signedIn).toBe(true))
    expect(calls(state, 'POST', '/api/auth/invitation/accept')[0].body).toEqual({
      token: 'good-token',
      password: 'a long enough pass',
      display_name: 'Ana',
    })
    await waitFor(() => expect(window.location.hash).toBe('#/'))
    await user.click(await screen.findByRole('button', { name: /Account menu/ }))
    expect(screen.getByText('Member')).toBeInTheDocument()
  })

  it('offers GitHub and Google with the verified-email note when configured', async () => {
    const state = installFakeApi()
    requireLogin(state)
    state.auth.providers.github = true
    state.admin.inviteTokens['good-token'] = 'ana@example.test'
    renderApp('#/auth/invite?token=good-token')
    const page = await screen.findByRole('main', { name: 'Join Learning Hub' })
    expect(await within(page).findByRole('link', { name: 'Continue with GitHub' })).toBeInTheDocument()
    expect(within(page).getByText('Use an account whose verified email is ana@example.test.')).toBeInTheDocument()
  })

  it('refuses an invalid, expired or used link', async () => {
    const state = installFakeApi()
    requireLogin(state)
    renderApp('#/auth/invite?token=nope')
    const page = await screen.findByRole('main', { name: 'Invitation not accepted' })
    expect(within(page).getByRole('alert')).toHaveTextContent('This invitation has expired or was already used.')
    expect(within(page).getByRole('link', { name: 'Back to log in' })).toHaveAttribute('href', '#/auth/login')
    expect(window.location.hash).toBe('#/auth/invite')
    expect(state.auth.signedIn).toBe(false)
  })
})

describe('login and first visit', () => {
  it('explains the not_invited sign-in error', async () => {
    const state = installFakeApi()
    requireLogin(state)
    renderApp('#/auth/login?error=not_invited')
    const page = await screen.findByRole('main', { name: 'Log in' })
    expect(within(page).getByRole('alert')).toHaveTextContent('You need an invitation to join.')
  })

  it('titles the first-visit page "Create the admin account"', async () => {
    const state = installFakeApi()
    requireLogin(state, { owner: null })
    renderApp()
    const page = await screen.findByRole('main', { name: 'Create the admin account' })
    expect(within(page).getByRole('heading', { name: 'Create the admin account' })).toBeInTheDocument()
  })
})
