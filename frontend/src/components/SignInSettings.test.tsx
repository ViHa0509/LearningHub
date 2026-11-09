/** Spec: auth (Set up GitHub and Google sign-in in the app), as far as the Settings page shows it. */
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeApi, requireLogin } from '../test/fakeApi'
import { renderAppReady } from '../test/render'

afterEach(() => vi.restoreAllMocks())

const open = async () => {
  const rendered = await renderAppReady('#/settings/sign-in')
  await screen.findByRole('region', { name: 'Sign-in' })
  return rendered
}
const card = (name: string) => screen.findByRole('article', { name })

describe('settings navigation', () => {
  it('links the three sections and marks the current one', async () => {
    installFakeApi()
    await open()
    const nav = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getByRole('link', { name: 'AI providers' })).toHaveAttribute('href', '#/settings')
    expect(within(nav).getByRole('link', { name: 'Sign-in' })).toHaveAttribute('href', '#/settings/sign-in')
    expect(within(nav).getByRole('link', { name: 'Data & sync' })).toHaveAttribute('href', '#/settings/data')
    expect(within(nav).getByRole('link', { name: 'Sign-in' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'AI providers' })).not.toHaveAttribute('aria-current')
  })

  it('opens the providers page and the data page', async () => {
    installFakeApi()
    const { user } = await open()
    await user.click(screen.getByRole('link', { name: 'Data & sync' }))
    const data = await screen.findByRole('region', { name: 'Data & sync' })
    expect(within(data).getByRole('heading', { name: 'Data & sync' })).toBeInTheDocument()
    expect(within(data).getByRole('link', { name: 'Data & sync' })).toHaveAttribute('aria-current', 'page')
    await user.click(within(data).getByRole('link', { name: 'AI providers' }))
    expect(await screen.findByRole('region', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'AI providers' })).toBeInTheDocument()
  })
})

describe('sign-in settings', () => {
  // Scenario: Callback URL shown
  it('shows the callback URL from the public address', async () => {
    installFakeApi()
    await open()
    const github = await card('GitHub')
    expect(within(github).getByLabelText('Callback URL')).toHaveValue(
      'https://hub.example.com/api/auth/oauth/github/callback',
    )
    expect(within(github).getByLabelText('Callback URL')).toHaveAttribute('readonly')
    const google = await card('Google')
    expect(within(google).getByLabelText('Callback URL')).toHaveValue(
      'https://hub.example.com/api/auth/oauth/google/callback',
    )
    expect(within(github).getByRole('link', { name: /GitHub developer settings/ })).toHaveAttribute(
      'href',
      'https://github.com/settings/developers',
    )
    expect(within(google).getByRole('link', { name: /Google Cloud credentials/ })).toHaveAttribute(
      'href',
      'https://console.cloud.google.com/apis/credentials',
    )
  })

  it('shows where each provider is configured', async () => {
    const state = installFakeApi()
    state.signIn.env.github = { client_id: 'env-id' }
    state.signIn.app.google = { client_id: 'app-id', secret: 'abcdabcd' }
    await open()
    const github = await card('GitHub')
    expect(within(github).getByText('From the environment')).toBeInTheDocument()
    expect(within(github).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    const google = await card('Google')
    expect(within(google).getByText('Set in the app')).toBeInTheDocument()
    expect(within(google).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })

  // Scenario: Turn on GitHub sign-in
  it('turns on GitHub: status, hint only, and the login status is read again', async () => {
    const state = installFakeApi()
    const { user } = await open()
    const github = await card('GitHub')
    expect(within(github).getByText('Not configured')).toBeInTheDocument()
    expect(within(github).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()

    await user.type(within(github).getByLabelText('Client ID'), 'gh-client')
    await user.type(within(github).getByLabelText('Client secret'), 'super-secret-9876')
    await user.click(within(github).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(within(github).getByText('Set in the app')).toBeInTheDocument())
    const put = state.calls.find((c) => c.method === 'PUT' && c.url === '/api/settings/sign-in/github')
    expect(put?.body).toEqual({ client_id: 'gh-client', client_secret: 'super-secret-9876' })
    expect(state.headers[state.calls.indexOf(put!)]['X-LearningHub']).toBe('1')
    const secret = within(github).getByLabelText('Client secret')
    expect(secret).toHaveAttribute('type', 'password')
    expect(secret).toHaveValue('')
    expect(secret).toHaveAttribute('placeholder', 'Saved: ••••9876')
    expect(document.body.textContent).not.toContain('super-secret-9876')
    expect(within(github).getByLabelText('Client ID')).toHaveValue('gh-client')
    expect(within(github).getByRole('button', { name: 'Save' })).toBeDisabled()
    // The login page reads the auth status again, so it offers GitHub at once.
    const putAt = state.calls.indexOf(put!)
    await waitFor(() =>
      expect(state.calls.slice(putAt).some((c) => c.method === 'GET' && c.url === '/api/auth/status')).toBe(true),
    )
    expect(state.auth.providers.github).toBe(true)
  })

  it('keeps the saved secret when only the Client ID changes', async () => {
    const state = installFakeApi()
    state.signIn.app.github = { client_id: 'old-id', secret: 'keepkeep' }
    const { user } = await open()
    const github = await card('GitHub')
    const id = within(github).getByLabelText('Client ID')
    await user.clear(id)
    await user.type(id, 'new-id')
    await user.click(within(github).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(state.calls.find((c) => c.method === 'PUT')?.body).toEqual({ client_id: 'new-id' }),
    )
    expect(state.signIn.app.github?.secret).toBe('keepkeep')
  })

  it('keeps Save disabled until something changed, and Cancel restores the saved values', async () => {
    const state = installFakeApi()
    state.signIn.app.github = { client_id: 'saved-id', secret: 'abcd1234' }
    const { user } = await open()
    const github = await card('GitHub')
    const save = within(github).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    const id = within(github).getByLabelText('Client ID')
    await user.type(id, 'x')
    await user.type(within(github).getByLabelText('Client secret'), 'typed')
    expect(save).toBeEnabled()
    await user.click(within(github).getByRole('button', { name: 'Cancel' }))
    expect(id).toHaveValue('saved-id')
    expect(within(github).getByLabelText('Client secret')).toHaveValue('')
    expect(save).toBeDisabled()
    expect(state.calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('cancels with Escape and does not save on blur', async () => {
    const state = installFakeApi()
    const { user } = await open()
    const github = await card('GitHub')
    const id = within(github).getByLabelText('Client ID')
    await user.type(id, 'abc')
    await user.tab()
    expect(state.calls.some((c) => c.method === 'PUT')).toBe(false)
    await user.click(id)
    await user.keyboard('{Escape}')
    expect(id).toHaveValue('')
  })

  it('asks before unsaved changes are discarded', async () => {
    installFakeApi()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = await open()
    const github = await card('GitHub')
    await user.type(within(github).getByLabelText('Client ID'), 'abc')
    window.location.hash = '#/settings'
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(window.location.hash).toBe('#/settings/sign-in')
    expect(screen.getByRole('region', { name: 'Sign-in' })).toBeInTheDocument()
  })

  // Scenario: Remove a provider
  it('removes a provider saved in the app after confirming', async () => {
    const state = installFakeApi()
    state.signIn.app.google = { client_id: 'g-id', secret: 'abcd1234' }
    state.auth.providers.google = true
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const { user } = await open()
    const google = await card('Google')
    await user.click(within(google).getByRole('button', { name: 'Remove' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(state.calls.some((c) => c.method === 'DELETE')).toBe(false)

    await user.click(within(google).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(within(google).getByText('Not configured')).toBeInTheDocument())
    expect(state.calls.some((c) => c.method === 'DELETE' && c.url === '/api/settings/sign-in/google')).toBe(true)
    expect(within(google).getByLabelText('Client ID')).toHaveValue('')
    expect(within(google).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(state.auth.providers.google).toBe(false)
  })

  it('shows an error from the API inline', async () => {
    const state = installFakeApi()
    state.signIn.saveError = 'The Client ID is too long'
    const { user } = await open()
    const github = await card('GitHub')
    await user.type(within(github).getByLabelText('Client ID'), 'abc')
    await user.click(within(github).getByRole('button', { name: 'Save' }))
    expect(await within(github).findByRole('alert')).toHaveTextContent('The Client ID is too long')
    expect(within(github).getByLabelText('Client ID')).toHaveValue('abc')
  })

  it('copies the callback URL and says so', async () => {
    installFakeApi()
    const { user } = await open()
    const github = await card('GitHub')
    await user.click(within(github).getByRole('button', { name: 'Copy' }))
    expect(await within(github).findByText('Copied')).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe('https://hub.example.com/api/auth/oauth/github/callback')
  })

  it('works behind the login check', async () => {
    const state = installFakeApi()
    requireLogin(state, { signedIn: true })
    await open()
    expect(await card('GitHub')).toBeInTheDocument()
  })
})
