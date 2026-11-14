/** Spec: auth - One Owner account, Email and password, Sign in with GitHub or Google, Magic link and email verification, Sessions protect the app, Avatar menu. */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFakeApi, OWNER, requireLogin, type FakeState } from '../test/fakeApi'
import { renderApp } from '../test/render'

const OUTBOX_NOTE = 'Email is not configured: the link was written to storage/outbox on the server.'
const FORGOT_SENT = 'If that email belongs to the owner, a reset link is on its way.'
const MAGIC_SENT = 'If that email belongs to the owner, a sign-in link is on its way.'
const USED_LINK = 'This link has expired or was already used.'

const appShows = () => screen.findByRole('complementary', { name: 'Learned items' })
const loginPage = () => screen.findByRole('main', { name: 'Log in' })
const calls = (state: FakeState, url: string) => state.calls.filter((c) => c.url === url)
const seed = (state: FakeState, purpose: 'reset_password' | 'magic_link' | 'verify_email', token: string) =>
  state.auth.tokens.push({ purpose, token, used: false })

async function logIn(user: ReturnType<typeof renderApp>['user'], email = OWNER.email, password = OWNER.password ?? '') {
  const page = await loginPage()
  await user.type(within(page).getByLabelText('Email'), email)
  await user.type(within(page).getByLabelText('Password'), password)
  await user.click(within(page).getByRole('button', { name: 'Log in' }))
}

describe('auth not required', () => {
  it('shows the app with no login screen, no account menu and the Settings link', async () => {
    const state = installFakeApi()
    renderApp()
    await appShows()
    expect(screen.queryByRole('main', { name: 'Log in' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Account menu/ })).not.toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'App' })).getByRole('link', { name: 'Settings' })).toBeInTheDocument()
    await waitFor(() => expect(calls(state, '/api/auth/status')).toHaveLength(1))
    expect(calls(state, '/api/auth/me')).toHaveLength(0)
  })
})

describe('first visit in a new browser', () => {
  it('shows nothing of the app and asks for no data before the session is known', async () => {
    const state = installFakeApi()
    requireLogin(state, { signedIn: true })
    renderApp()
    expect(screen.queryByRole('complementary', { name: 'Learned items' })).not.toBeInTheDocument()
    await appShows()
    const urls = state.calls.map((c) => c.url)
    const me = urls.indexOf('/api/auth/me')
    expect(me).toBeGreaterThan(-1)
    expect(urls.slice(0, me).filter((u) => !u.startsWith('/api/auth/') && u !== '/api/health')).toEqual([])
  })
})

describe('first account is the admin', () => {
  it('offers to create the admin account on the first visit, with GitHub and Google', async () => {
    const state = installFakeApi()
    requireLogin(state, { owner: null })
    renderApp()
    const page = await screen.findByRole('main', { name: 'Create the admin account' })
    expect(within(page).getByLabelText('Display name (optional)')).toBeInTheDocument()
    expect(within(page).getByLabelText('Email')).toBeInTheDocument()
    expect(within(page).getByLabelText('Password')).toBeInTheDocument()
    expect(within(page).getByLabelText('Confirm password')).toBeInTheDocument()
    // Scenario: First visit without providers.
    expect(within(page).queryByRole('link', { name: /Continue with/ })).not.toBeInTheDocument()
    expect(within(page).queryByRole('button', { name: /Continue with/ })).not.toBeInTheDocument()
    expect(within(page).getByText('GitHub and Google sign-in can be added later in Settings → Sign-in.')).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Learned items' })).not.toBeInTheDocument()
  })

  it('checks the form, then signs up and opens the app with the avatar menu', async () => {
    const state = installFakeApi()
    requireLogin(state, { owner: null })
    const { user } = renderApp('#/news')
    const page = await screen.findByRole('main', { name: 'Create the admin account' })
    const create = within(page).getByRole('button', { name: 'Create account' })

    await user.type(within(page).getByLabelText('Email'), 'not-an-email')
    await user.click(create)
    expect(within(page).getByRole('alert')).toHaveTextContent('Enter a valid email address.')

    await user.clear(within(page).getByLabelText('Email'))
    await user.type(within(page).getByLabelText('Email'), 'me@example.test')
    await user.type(within(page).getByLabelText('Password'), 'short')
    await user.click(create)
    expect(within(page).getByRole('alert')).toHaveTextContent('Use at least 10 characters for the password.')

    await user.clear(within(page).getByLabelText('Password'))
    await user.type(within(page).getByLabelText('Password'), 'long enough pass')
    await user.type(within(page).getByLabelText('Confirm password'), 'long enough pasS')
    await user.click(create)
    expect(within(page).getByRole('alert')).toHaveTextContent('The passwords do not match.')
    expect(calls(state, '/api/auth/signup')).toHaveLength(0)

    await user.clear(within(page).getByLabelText('Confirm password'))
    await user.type(within(page).getByLabelText('Confirm password'), 'long enough pass')
    await user.type(within(page).getByLabelText('Display name (optional)'), 'Grace Hopper')
    await user.click(create)

    // Back on the page the visit started at.
    expect(await screen.findByRole('heading', { name: 'AI news' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/news')
    expect(calls(state, '/api/auth/signup')[0].body).toEqual({
      email: 'me@example.test',
      password: 'long enough pass',
      display_name: 'Grace Hopper',
    })
    expect(state.auth.owner?.email).toBe('me@example.test')
    expect(screen.getByRole('button', { name: 'Account menu: Grace Hopper' })).toHaveTextContent('GH')
  })

  it('shows the server refusal of a sign-up', async () => {
    const state = installFakeApi()
    requireLogin(state, { owner: null })
    const { user } = renderApp()
    const page = await screen.findByRole('main', { name: 'Create the admin account' })
    // Someone else created an account with this email meanwhile.
    state.auth.owner = { ...OWNER }
    await user.type(within(page).getByLabelText('Email'), OWNER.email)
    await user.type(within(page).getByLabelText('Password'), 'long enough pass')
    await user.type(within(page).getByLabelText('Confirm password'), 'long enough pass')
    await user.click(within(page).getByRole('button', { name: 'Create account' }))
    expect(await within(page).findByRole('alert')).toHaveTextContent('An account with this email already exists')
    expect(state.auth.signedIn).toBe(false)
  })
})

describe('open sign-up', () => {
  it('links the login page to Sign up and back', async () => {
    const state = installFakeApi()
    requireLogin(state)
    const { user } = renderApp()
    const login = await screen.findByRole('main', { name: 'Log in' })
    await user.click(within(login).getByRole('link', { name: 'Create an account' }))
    const page = await screen.findByRole('main', { name: 'Sign up' })
    expect(window.location.hash).toBe('#/auth/signup')
    for (const label of ['Display name (optional)', 'Email', 'Password', 'Confirm password']) {
      expect(within(page).getByLabelText(label)).toBeInTheDocument()
    }
    expect(within(page).getByText(/yours only/)).toBeInTheDocument()
    // The link under the form (the page also has Log in at the top).
    await user.click(within(page).getAllByRole('link', { name: 'Log in' }).find((a) => !a.classList.contains('auth-corner'))!)
    expect(await screen.findByRole('main', { name: 'Log in' })).toBeInTheDocument()
  })

  it('signs up a member after the admin exists and opens the app', async () => {
    const state = installFakeApi()
    requireLogin(state)
    const { user } = renderApp('#/auth/signup')
    const page = await screen.findByRole('main', { name: 'Sign up' })
    await user.type(within(page).getByLabelText('Display name (optional)'), 'Ana Member')
    await user.type(within(page).getByLabelText('Email'), 'ana@example.test')
    await user.type(within(page).getByLabelText('Password'), 'long enough pass')
    await user.type(within(page).getByLabelText('Confirm password'), 'long enough pass')
    await user.click(within(page).getByRole('button', { name: 'Create account' }))
    await appShows()
    expect(state.auth.owner).toMatchObject({ email: 'ana@example.test', role: 'member' })
    expect(screen.getByRole('button', { name: 'Account menu: Ana Member' })).toBeInTheDocument()
  })

  it('refuses a used email on the Sign up page', async () => {
    const state = installFakeApi()
    requireLogin(state)
    const { user } = renderApp('#/auth/signup')
    const page = await screen.findByRole('main', { name: 'Sign up' })
    await user.type(within(page).getByLabelText('Email'), OWNER.email)
    await user.type(within(page).getByLabelText('Password'), 'long enough pass')
    await user.type(within(page).getByLabelText('Confirm password'), 'long enough pass')
    await user.click(within(page).getByRole('button', { name: 'Create account' }))
    expect(await within(page).findByRole('alert')).toHaveTextContent('An account with this email already exists')
    expect(state.auth.signedIn).toBe(false)
  })

  it('explains that an unverified account cannot be joined with GitHub', async () => {
    const state = installFakeApi()
    requireLogin(state)
    renderApp('#/auth/login?error=account_unverified')
    const page = await screen.findByRole('main', { name: 'Log in' })
    expect(within(page).getByRole('alert')).toHaveTextContent('its email is not verified yet')
  })
})

describe('email and password', () => {
  it('logs in, opens the app, and logs out from the avatar menu to the login page', async () => {
    const state = installFakeApi()
    requireLogin(state)
    const { user } = renderApp()
    await logIn(user)
    await appShows()
    expect(state.auth.signedIn).toBe(true)

    const account = screen.getByRole('button', { name: 'Account menu: Ada Lovelace' })
    expect(account).toHaveTextContent('AL')
    await user.click(account)
    const menu = screen.getByRole('menu', { name: 'Account' })
    expect(screen.getByText(OWNER.email)).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '#/settings')
    await user.click(within(menu).getByRole('menuitem', { name: 'Log out' }))

    await loginPage()
    expect(window.location.hash).toBe('#/auth/login')
    expect(state.auth.signedIn).toBe(false)
    expect(calls(state, '/api/auth/logout')).toHaveLength(1)
    expect(screen.queryByRole('complementary', { name: 'Learned items' })).not.toBeInTheDocument()
  })

  it.each([
    ['a wrong password', OWNER.email, 'wrong password!'],
    ['an unknown email', 'someone@example.test', OWNER.password ?? ''],
  ])('answers %s with "Wrong email or password"', async (_case, email, password) => {
    const state = installFakeApi()
    requireLogin(state)
    const { user } = renderApp()
    await logIn(user, email, password)
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Wrong email or password$/)
    expect(state.auth.signedIn).toBe(false)
    expect(screen.queryByRole('complementary', { name: 'Learned items' })).not.toBeInTheDocument()
  })

  it('shows the too-many-attempts message of the server', async () => {
    const state = installFakeApi()
    requireLogin(state)
    state.auth.limited = 'Too many attempts. Try again in 42 seconds.'
    const { user } = renderApp()
    await logIn(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again in 42 seconds.')
  })

  it.each([
    ['smtp', false],
    ['outbox', true],
  ] as const)('answers a reset request the same for any email (mail %s)', async (mode, note) => {
    const state = installFakeApi()
    requireLogin(state)
    state.auth.mail = mode
    for (const email of [OWNER.email, 'nobody@example.test']) {
      const { user, unmount } = renderApp()
      await user.click(within(await loginPage()).getByRole('link', { name: 'Forgot password?' }))
      const page = await screen.findByRole('main', { name: 'Reset your password' })
      await user.type(within(page).getByLabelText('Email'), email)
      await user.click(within(page).getByRole('button', { name: 'Send reset link' }))
      expect(await within(page).findByRole('status')).toHaveTextContent(FORGOT_SENT)
      if (note) expect(within(page).getByText(OUTBOX_NOTE)).toBeInTheDocument()
      else expect(within(page).queryByText(OUTBOX_NOTE)).not.toBeInTheDocument()
      unmount()
    }
    expect(state.auth.tokens.filter((t) => t.purpose === 'reset_password')).toHaveLength(1)
  })

  it('sets a new password from a reset link, signs in, and drops the token from the address', async () => {
    const state = installFakeApi()
    requireLogin(state)
    seed(state, 'reset_password', 'reset-abc')
    const { user } = renderApp('#/auth/reset?token=reset-abc')
    const page = await screen.findByRole('main', { name: 'Set a new password' })
    await user.type(within(page).getByLabelText('New password'), 'a brand new pass')
    await user.type(within(page).getByLabelText('Confirm new password'), 'a brand new pass')
    await user.click(within(page).getByRole('button', { name: 'Set new password' }))

    await appShows()
    expect(window.location.hash).toBe('#/')
    expect(window.location.href).not.toContain('reset-abc')
    expect(calls(state, '/api/auth/reset')[0].body).toEqual({ token: 'reset-abc', password: 'a brand new pass' })
    // The old password stops working.
    expect(state.auth.owner?.password).toBe('a brand new pass')
  })

  it('refuses a used reset link with the server message', async () => {
    const state = installFakeApi()
    requireLogin(state)
    const { user } = renderApp('#/auth/reset?token=reset-used')
    const page = await screen.findByRole('main', { name: 'Set a new password' })
    await user.type(within(page).getByLabelText('New password'), 'a brand new pass')
    await user.type(within(page).getByLabelText('Confirm new password'), 'a brand new pass')
    await user.click(within(page).getByRole('button', { name: 'Set new password' }))
    expect(await within(page).findByRole('alert')).toHaveTextContent('This link is invalid or has expired.')
    expect(state.auth.signedIn).toBe(false)
  })
})

describe('sign in with GitHub or Google', () => {
  // Scenario: Not configured (auth-page-polish: not offered at all)
  it('offers only the configured providers, with their logos', async () => {
    const state = installFakeApi()
    requireLogin(state)
    state.auth.providers.github = true
    renderApp('#/news')
    const page = await loginPage()
    const github = within(page).getByRole('link', { name: 'Continue with GitHub' })
    expect(github).toHaveAttribute('href', '/api/auth/oauth/github/start?next=%23%2Fnews')
    expect(github.querySelector('svg.auth-provider-logo')).not.toBeNull()
    expect(within(page).queryByRole('link', { name: 'Continue with Google' })).not.toBeInTheDocument()
    expect(within(page).queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument()
    expect(within(page).queryByText('Not configured on this server')).not.toBeInTheDocument()
    expect(within(page).getByText('or')).toBeInTheDocument()
  })

  it('shows no "or" line and no provider when none is configured', async () => {
    const state = installFakeApi()
    requireLogin(state)
    renderApp()
    const page = await loginPage()
    expect(within(page).queryByText('or')).not.toBeInTheDocument()
    expect(within(page).queryByRole('link', { name: /Continue with/ })).not.toBeInTheDocument()
    expect(within(page).queryByText(/can be added later/)).not.toBeInTheDocument()
  })

  // Scenario: Switch between log in and sign up
  it('has Sign up at the top of the login page and Log in at the top of the Sign up page', async () => {
    const state = installFakeApi()
    requireLogin(state)
    const { user } = renderApp()
    const page = await loginPage()
    const corner = within(page).getAllByRole('link', { name: 'Sign up' })[0]
    expect(corner).toHaveClass('auth-corner')
    await user.click(corner)
    const signup = await screen.findByRole('main', { name: 'Sign up' })
    const back = within(signup).getAllByRole('link', { name: 'Log in' }).find((a) => a.classList.contains('auth-corner'))!
    await user.click(back)
    expect(await screen.findByRole('main', { name: 'Log in' })).toBeInTheDocument()
  })

  it.each([
    ['owner_exists', 'This app has an owner already'],
    ['state_mismatch', 'The sign-in could not be confirmed'],
    ['access_denied', 'The sign-in was cancelled at the provider.'],
    ['not_configured', 'This sign-in method is not configured on this server.'],
    ['provider_error', 'The provider did not answer as expected.'],
    ['something_else', 'The sign-in did not work. Try again.'],
  ])('shows the OAuth error %s as a readable message', async (code, text) => {
    const state = installFakeApi()
    requireLogin(state)
    renderApp(`#/auth/login?error=${code}`)
    const page = await loginPage()
    expect(within(page).getByRole('alert')).toHaveTextContent(text)
    expect(within(page).getByRole('alert')).not.toHaveTextContent(code)
    await waitFor(() => expect(window.location.hash).toBe('#/auth/login'))
  })
})

describe('magic link and email verification', () => {
  it.each([
    ['smtp', false],
    ['outbox', true],
  ] as const)('answers a magic link request the same for any email (mail %s)', async (mode, note) => {
    const state = installFakeApi()
    requireLogin(state)
    state.auth.mail = mode
    for (const email of [OWNER.email, 'nobody@example.test']) {
      const { user, unmount } = renderApp()
      await user.click(within(await loginPage()).getByRole('link', { name: 'Email me a sign-in link' }))
      const page = await screen.findByRole('main', { name: 'Sign in with an email link' })
      await user.type(within(page).getByLabelText('Email'), email)
      await user.click(within(page).getByRole('button', { name: 'Send sign-in link' }))
      expect(await within(page).findByRole('status')).toHaveTextContent(MAGIC_SENT)
      if (note) expect(within(page).getByText(OUTBOX_NOTE)).toBeInTheDocument()
      else expect(within(page).queryByText(OUTBOX_NOTE)).not.toBeInTheDocument()
      unmount()
    }
    expect(state.auth.tokens.filter((t) => t.purpose === 'magic_link')).toHaveLength(1)
  })

  it('signs in with a magic link once; a second time it is refused', async () => {
    const state = installFakeApi()
    requireLogin(state)
    seed(state, 'magic_link', 'magic-once')
    const first = renderApp('#/auth/magic?token=magic-once')
    await appShows()
    expect(window.location.hash).toBe('#/')
    expect(calls(state, '/api/auth/magic/consume')).toHaveLength(1)
    first.unmount()

    state.auth.signedIn = false
    renderApp('#/auth/magic?token=magic-once')
    const page = await screen.findByRole('main', { name: 'Sign-in link not accepted' })
    expect(within(page).getByRole('alert')).toHaveTextContent(USED_LINK)
    expect(window.location.hash).toBe('#/auth/magic')
    expect(within(page).getByRole('button', { name: 'Send sign-in link' })).toBeInTheDocument()
    expect(state.auth.signedIn).toBe(false)
  })

  it('verifies the email from the link, signed out', async () => {
    const state = installFakeApi()
    requireLogin(state, { owner: { ...OWNER, email_verified: false } })
    seed(state, 'verify_email', 'verify-1')
    renderApp('#/auth/verify?token=verify-1')
    expect(await screen.findByRole('heading', { name: 'Your email is verified' })).toBeInTheDocument()
    expect(state.auth.owner?.email_verified).toBe(true)
    expect(window.location.hash).toBe('#/auth/verify')
  })

  it('verifies the email signed in, and refuses a used link', async () => {
    const state = installFakeApi()
    requireLogin(state, { signedIn: true, owner: { ...OWNER, email_verified: false } })
    renderApp('#/auth/verify?token=verify-unknown')
    const page = await screen.findByRole('main', { name: 'Email not verified' })
    expect(within(page).getByRole('alert')).toHaveTextContent(USED_LINK)
    expect(state.auth.owner?.email_verified).toBe(false)
  })

  it('asks for a new verification link from the avatar menu while the email is unverified', async () => {
    const state = installFakeApi()
    requireLogin(state, { signedIn: true, owner: { ...OWNER, display_name: null, email_verified: false } })
    const { user } = renderApp()
    const account = await screen.findByRole('button', { name: `Account menu: ${OWNER.email}` })
    expect(account).toHaveTextContent('M')
    await user.click(account)
    await user.click(screen.getByRole('menuitem', { name: 'Verify your email' }))
    expect(await screen.findByText('A verification link is on its way.')).toHaveAttribute('role', 'status')
    expect(calls(state, '/api/auth/verify/resend')).toHaveLength(1)
  })
})

describe('sessions protect the app', () => {
  it('shows the login page on an app page without a session and returns to it after login', async () => {
    const state = installFakeApi()
    requireLogin(state)
    const { user } = renderApp('#/settings')
    await logIn(user)
    expect(await screen.findByRole('heading', { name: 'AI providers' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/settings')
  })

  it('goes to the login page when any API call answers 401, and back to the same page after login', async () => {
    const state = installFakeApi()
    requireLogin(state, { signedIn: true })
    const { user } = renderApp()
    await appShows()
    // The session ends elsewhere (log out everywhere else); the next call answers 401.
    state.auth.signedIn = false
    await user.click(screen.getByRole('link', { name: 'News' }))
    await loginPage()
    expect(window.location.hash).toBe('#/news')

    // Through the forgot-password page and back still returns to the same page.
    await user.click(screen.getByRole('link', { name: 'Forgot password?' }))
    await user.click(within(await screen.findByRole('main', { name: 'Reset your password' })).getByRole('link', { name: 'Back to log in' }))
    await logIn(user)
    expect(await screen.findByRole('heading', { name: 'AI news' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/news')
  })

  it('keeps an outage separate from a 401: the service unavailable page shows', async () => {
    const state = installFakeApi()
    requireLogin(state, { signedIn: true })
    state.down = 'server'
    renderApp()
    expect(await screen.findByRole('main', { name: 'Service unavailable' })).toBeInTheDocument()
    expect(screen.queryByRole('main', { name: 'Log in' })).not.toBeInTheDocument()
  })
})

describe('auth page decoration (visual-polish)', () => {
  it('shows a decorative background behind the card and keeps the Log in button name and type', async () => {
    const state = installFakeApi()
    requireLogin(state, { signedIn: false })
    renderApp()
    const page = await loginPage()
    const background = page.querySelector(':scope > svg')
    expect(background).toHaveAttribute('aria-hidden', 'true')
    const button = within(page).getByRole('button', { name: 'Log in' })
    expect(button).toHaveAttribute('type', 'submit')
    expect(button).toBeEnabled()
  })
})
