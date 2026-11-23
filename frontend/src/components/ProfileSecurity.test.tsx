/**
 * Spec: settings - Password in Security, Linked sign-in methods, Sessions in Security, Preferences,
 * Delete all notes.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeApi, makeNote, OWNER, requireLogin, twoProviders, type FakeOwner, type FakeState } from '../test/fakeApi'
import { renderAppReady } from '../test/render'

const calls = (state: FakeState, url: string) => state.calls.filter((c) => c.url === url)

function setup(owner: FakeOwner = OWNER) {
  const state = installFakeApi()
  requireLogin(state, { signedIn: true, owner: { ...owner } })
  return state
}

beforeEach(() => window.sessionStorage.clear())

describe('password', () => {
  // Scenario: Change password
  it('changes the password with the right current one', async () => {
    const state = setup()
    const { user } = await renderAppReady('#/profile/security')
    const form = await screen.findByRole('form', { name: 'Password' })
    const save = within(form).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await user.type(within(form).getByLabelText('Current password'), OWNER.password as string)
    await user.type(within(form).getByLabelText('New password'), 'a brand new passphrase')
    await user.click(save)
    expect(await within(form).findByText('Saved.')).toBeInTheDocument()
    expect(calls(state, '/api/auth/password')[0].body).toEqual({
      current: OWNER.password,
      new: 'a brand new passphrase',
    })
    expect(state.auth.owner?.password).toBe('a brand new passphrase')
  })

  it('shows the server message for a wrong current password', async () => {
    setup()
    const { user } = await renderAppReady('#/profile/security')
    const form = await screen.findByRole('form', { name: 'Password' })
    await user.type(within(form).getByLabelText('Current password'), 'wrong wrong wrong')
    await user.type(within(form).getByLabelText('New password'), 'a brand new passphrase')
    await user.click(within(form).getByRole('button', { name: 'Save' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('The current password is not right.')
  })

  it('offers Set a password, without a current password, when the account has none', async () => {
    const state = setup({ ...OWNER, password: null, linked: ['github'] })
    const { user } = await renderAppReady('#/profile/security')
    const form = await screen.findByRole('form', { name: 'Password' })
    expect(within(form).getByRole('heading', { name: 'Set a password' })).toBeInTheDocument()
    expect(within(form).queryByLabelText('Current password')).toBeNull()
    await user.type(within(form).getByLabelText('New password'), 'a brand new passphrase')
    await user.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls(state, '/api/auth/password')).toHaveLength(1))
    expect(calls(state, '/api/auth/password')[0].body).toEqual({ current: '', new: 'a brand new passphrase' })
  })

  it('asks before leaving with a typed password', async () => {
    setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = await renderAppReady('#/profile/security')
    await user.type(await screen.findByLabelText('New password'), 'draft')
    window.location.hash = '#/settings'
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(window.location.hash).toBe('#/profile/security')
    confirm.mockRestore()
  })
})

describe('linked sign-in methods', () => {
  // Scenario: Last method
  it('shows the refusal when GitHub is the only method', async () => {
    const state = setup({ ...OWNER, password: null, linked: ['github'] })
    const { user } = await renderAppReady('#/profile/security')
    await user.click(await screen.findByRole('button', { name: 'Unlink GitHub' }))
    expect(await screen.findByText('Add another sign-in method before removing this one.')).toBeInTheDocument()
    expect(calls(state, '/api/auth/identities/github')).toHaveLength(1)
    expect(state.auth.owner?.linked).toEqual(['github'])
  })

  it('unlinks a provider when another method remains', async () => {
    setup({ ...OWNER, linked: ['google'] })
    const { user } = await renderAppReady('#/profile/security')
    await user.click(await screen.findByRole('button', { name: 'Unlink Google' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Unlink Google' })).toBeNull())
  })

  // Scenario: Link GitHub
  it('links to the server route, only for a configured provider', async () => {
    const state = setup()
    state.auth.providers.github = true
    await renderAppReady('#/profile/security')
    expect(await screen.findByRole('link', { name: 'Link GitHub' })).toHaveAttribute('href', '/api/auth/oauth/github/link')
    expect(screen.queryByRole('link', { name: 'Link Google' })).toBeNull()
  })

  it('shows the linked provider after the redirect back', async () => {
    setup({ ...OWNER, linked: ['github'] })
    await renderAppReady('#/profile/security?linked=github')
    expect(await screen.findByRole('status')).toHaveTextContent('GitHub is linked.')
    expect(screen.getByRole('button', { name: 'Unlink GitHub' })).toBeInTheDocument()
  })

  // Scenario: Identity of another account
  it.each([
    ['identity_taken', 'That account is already used by another Learning Hub account.'],
    ['not_configured', 'That sign-in method is not set up on this server.'],
    ['access_denied', 'The sign-in was cancelled.'],
  ])('explains ?error=%s in a sentence', async (code, text) => {
    setup()
    await renderAppReady(`#/profile/security?error=${code}`)
    expect(await screen.findByText(text)).toBeInTheDocument()
  })
})

describe('sessions', () => {
  // Scenario: Revoke another session
  it('revokes another session and not the current one', async () => {
    const state = setup()
    const { user } = await renderAppReady('#/profile/security')
    const sessions = await screen.findByRole('group', { name: 'Sessions' })
    await within(sessions).findByText(/Safari on iPhone/)
    expect(within(sessions).getAllByRole('button', { name: 'Revoke' })).toHaveLength(1)
    expect(within(sessions).getByText('This session')).toBeInTheDocument()
    await user.click(within(sessions).getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(within(sessions).queryByText(/Safari on iPhone/)).toBeNull())
    expect(calls(state, '/api/auth/sessions/s2')[0].method).toBe('DELETE')
  })

  it('logs out everywhere else', async () => {
    const state = setup()
    const { user } = await renderAppReady('#/profile/security')
    const sessions = await screen.findByRole('group', { name: 'Sessions' })
    await within(sessions).findByText(/Safari on iPhone/)
    await user.click(within(sessions).getByRole('button', { name: 'Log out everywhere else' }))
    await waitFor(() => expect(within(sessions).queryByText(/Safari on iPhone/)).toBeNull())
    expect(calls(state, '/api/auth/sessions/logout-others')).toHaveLength(1)
  })
})

describe('preferences', () => {
  // Scenario: Answer language and Default effort
  it('saves the answer language and default effort with Save, and Cancel restores them', async () => {
    const state = setup()
    const { user } = await renderAppReady('#/profile/preferences')
    const form = await screen.findByRole('form', { name: 'Preferences' })
    const save = within(form).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await user.selectOptions(within(form).getByLabelText('Answer language'), 'vi')
    expect(save).toBeEnabled()
    await user.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(within(form).getByLabelText('Answer language')).toHaveValue('auto')
    await user.selectOptions(within(form).getByLabelText('Answer language'), 'vi')
    await user.selectOptions(within(form).getByLabelText('Default effort'), 'high')
    await user.click(save)
    expect(await within(form).findByText('Saved.')).toBeInTheDocument()
    expect(calls(state, '/api/auth/preferences')[0].body).toEqual({ answer_language: 'vi', default_effort: 'high' })
  })

  it('the hint follows the selected answer language', async () => {
    setup()
    const { user } = await renderAppReady('#/profile/preferences')
    const form = await screen.findByRole('form', { name: 'Preferences' })
    expect(within(form).getByText('Auto answers in the language you write in.')).toBeInTheDocument()
    await user.selectOptions(within(form).getByLabelText('Answer language'), 'vi')
    expect(within(form).getByText('The agent answers in Vietnamese.')).toBeInTheDocument()
  })

  it('asks before leaving with an unsaved change', async () => {
    setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = await renderAppReady('#/profile/preferences')
    await user.selectOptions(await screen.findByLabelText('Default effort'), 'low')
    window.location.hash = '#/settings'
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(window.location.hash).toBe('#/profile/preferences')
    confirm.mockRestore()
  })

  // Scenario: Default effort (new chat on another device)
  it('starts the chat composer at the account default effort when the browser has no pick', async () => {
    window.localStorage.clear()
    const state = setup({ ...OWNER, preferences: { answer_language: 'auto', default_effort: 'high' } })
    state.providers = twoProviders()
    await renderAppReady('#/')
    const panel = await screen.findByRole('complementary', { name: 'Agent' })
    expect(await within(panel).findByText('High effort')).toBeInTheDocument()
  })

  // Spec agent-chat: Effort per message (the browser remembers the pick)
  it('keeps the browser pick over the account default', async () => {
    window.localStorage.setItem('learninghub.effort', 'low')
    const state = setup({ ...OWNER, preferences: { answer_language: 'auto', default_effort: 'high' } })
    state.providers = twoProviders()
    await renderAppReady('#/')
    const panel = await screen.findByRole('complementary', { name: 'Agent' })
    expect(await within(panel).findByText('Low effort')).toBeInTheDocument()
    window.localStorage.clear()
  })
})

describe('delete all notes', () => {
  // Scenario: Delete all notes
  it('needs the typed word, then deletes and reloads the notes', async () => {
    const state = setup()
    state.notes = [makeNote('JWT vs sessions')]
    const { user } = await renderAppReady('#/settings/data')
    const card = await screen.findByRole('article', { name: 'Delete all notes' })
    const button = within(card).getByRole('button', { name: 'Delete all notes' })
    expect(button).toBeDisabled()
    await user.type(within(card).getByLabelText('Type DELETE to confirm'), 'DELET')
    expect(button).toBeDisabled()
    await user.type(within(card).getByLabelText('Type DELETE to confirm'), 'E')
    await user.click(button)
    expect(await within(card).findByText('All notes deleted.')).toBeInTheDocument()
    const call = state.calls.findIndex((c) => c.method === 'DELETE' && c.url === '/api/notes')
    expect(state.calls[call].body).toEqual({ confirm: 'DELETE' })
    expect(state.headers[call]['X-LearningHub']).toBe('1')
    expect(state.notes).toEqual([])
  })
})
