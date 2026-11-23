/**
 * Spec: settings - Profile details, Avatar, Email change, Delete account.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeApi, OWNER, requireLogin, type FakeState } from '../test/fakeApi'
import { renderAppReady } from '../test/render'

const MEMBER = { ...OWNER, role: 'member' as const }
const calls = (state: FakeState, url: string) => state.calls.filter((c) => c.url === url)

function setup(owner = OWNER) {
  const state = installFakeApi()
  requireLogin(state, { signedIn: true, owner: { ...owner } })
  return state
}

const upload = (file: File) => fireEvent.change(screen.getByLabelText('Avatar file'), { target: { files: [file] } })
const submitOf = (form: HTMLElement) => form.querySelector('button[type=submit]') as HTMLButtonElement

beforeEach(() => window.sessionStorage.clear())

describe('profile details', () => {
  // Scenario: Change display name
  it('saves the name and the avatar menu shows it', async () => {
    const state = setup()
    const { user } = await renderAppReady('#/profile')
    const form = await screen.findByRole('form', { name: 'Profile details' })
    const name = screen.getByLabelText('Display name')
    await user.clear(name)
    await user.type(name, 'Grace Hopper')
    await user.type(screen.getByLabelText('Bio'), 'Compilers')
    await user.click(submitOf(form))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Account menu: Grace Hopper' })).toBeInTheDocument())
    expect(calls(state, '/api/auth/profile')[0].body).toEqual({ display_name: 'Grace Hopper', bio: 'Compilers' })
    expect(state.headers[state.calls.findIndex((c) => c.url === '/api/auth/profile')]['X-LearningHub']).toBe('1')
  })

  // Scenario: Leave without saving
  it('asks before leaving with an edited bio and stores nothing', async () => {
    const state = setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = await renderAppReady('#/profile')
    await user.type(await screen.findByLabelText('Bio'), 'draft')
    window.location.hash = '#/settings'
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(window.location.hash).toBe('#/profile')
    expect(calls(state, '/api/auth/profile')).toHaveLength(0)
    confirm.mockRestore()
  })

  it('keeps Save disabled until something changed, and Cancel restores the value', async () => {
    setup()
    const { user } = await renderAppReady('#/profile')
    const form = await screen.findByRole('form', { name: 'Profile details' })
    const save = submitOf(form)
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText('Bio'), 'x')
    expect(save).toBeEnabled()
    await user.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
    expect(screen.getByLabelText('Bio')).toHaveValue('')
    expect(save).toBeDisabled()
  })

  // Scenario: Unverified email
  it('sends a verification link for an unverified email', async () => {
    const state = setup({ ...OWNER, email_verified: false })
    const { user } = await renderAppReady('#/profile')
    expect(await screen.findByText('Not verified')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Verify email' }))
    expect(await screen.findByText('A verification link is on its way.')).toBeInTheDocument()
    expect(calls(state, '/api/auth/verify/resend')).toHaveLength(1)
  })

  it('shows Verified and no Verify email for a verified email', async () => {
    setup()
    await renderAppReady('#/profile')
    expect(await screen.findByText('Verified')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Verify email' })).not.toBeInTheDocument()
  })
})

describe('avatar', () => {
  // Scenario: Upload an avatar
  it('uploads a PNG and shows it, and Remove goes back to initials', async () => {
    const state = setup()
    const { user } = await renderAppReady('#/profile')
    await screen.findByLabelText('Avatar file')
    upload(new File([new Uint8Array(200 * 1024)], 'me.png', { type: 'image/png' }))
    await waitFor(() =>
      expect(document.querySelector('.account-button img.avatar')).toHaveAttribute('src', '/api/auth/avatar/u1?v=1'),
    )
    expect(calls(state, '/api/auth/avatar')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Remove picture' }))
    await waitFor(() => expect(document.querySelector('.account-button img.avatar')).toBeNull())
    expect(document.querySelector('.account-button span.avatar')).toHaveTextContent('AL')
  })

  // Scenario: Wrong avatar file
  it('refuses a 3 MB image and a PDF in the browser', async () => {
    const state = setup()
    await renderAppReady('#/profile')
    await screen.findByLabelText('Avatar file')
    upload(new File([new Uint8Array(3 * 1024 * 1024)], 'big.png', { type: 'image/png' }))
    expect(await screen.findByText('The image is larger than 1 MB.')).toBeInTheDocument()
    upload(new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }))
    expect(await screen.findByText('Use a PNG, JPEG or WebP image.')).toBeInTheDocument()
    expect(calls(state, '/api/auth/avatar')).toHaveLength(0)
  })

  it('shows the server refusal and keeps the avatar', async () => {
    const state = setup()
    state.auth.avatarError = { status: 415, detail: 'Use a PNG, JPEG or WebP image.' }
    await renderAppReady('#/profile')
    await screen.findByLabelText('Avatar file')
    upload(new File(['<html>'], 'page.png', { type: 'image/png' }))
    expect(await screen.findByText('Use a PNG, JPEG or WebP image.')).toBeInTheDocument()
    expect(calls(state, '/api/auth/avatar')).toHaveLength(1)
    expect(state.auth.owner?.avatar_url).toBeNull()
  })
})

describe('email change', () => {
  // Scenario: Not confirmed
  it('requests a change, shows the server message and leaves the email', async () => {
    const state = setup()
    const { user } = await renderAppReady('#/profile')
    await user.click(await screen.findByRole('button', { name: 'Change email' }))
    const save = submitOf(screen.getByLabelText('New email').closest('form') as HTMLElement)
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText('New email'), 'new@example.test')
    await user.click(save)
    expect(await screen.findByText('A confirmation link is on its way to the new address.')).toBeInTheDocument()
    expect(calls(state, '/api/auth/email')[0].body).toEqual({ email: 'new@example.test' })
    expect(state.auth.owner?.email).toBe(OWNER.email)
  })

  // Scenario: Change confirmed
  it('confirms from the emailed link and shows success', async () => {
    const state = setup()
    state.auth.pendingEmail = 'new@example.test'
    state.auth.tokens.push({ purpose: 'email_change', token: 'tok', used: false })
    await renderAppReady('#/auth/email-change?token=tok')
    expect(await screen.findByRole('main', { name: 'Your email is changed' })).toBeInTheDocument()
    expect(state.auth.owner?.email).toBe('new@example.test')
  })

  it('shows the error when the address is taken', async () => {
    const state = setup()
    state.auth.pendingEmail = 'taken@example.test'
    state.auth.takenEmails = ['taken@example.test']
    state.auth.tokens.push({ purpose: 'email_change', token: 'tok', used: false })
    await renderAppReady('#/auth/email-change?token=tok')
    expect(await screen.findByRole('main', { name: 'Email not changed' })).toBeInTheDocument()
    expect(screen.getByText('That email is already used by another account.')).toBeInTheDocument()
    expect(state.auth.owner?.email).toBe(OWNER.email)
  })
})

describe('delete account', () => {
  // Scenario: Admin cannot
  it('is not offered to the admin', async () => {
    setup()
    await renderAppReady('#/profile')
    await screen.findByLabelText('Bio')
    expect(screen.queryByRole('form', { name: 'Delete account' })).not.toBeInTheDocument()
  })

  // Scenario: Member deletes their account
  it('needs the typed email, then signs the member out', async () => {
    const state = setup(MEMBER)
    const { user } = await renderAppReady('#/profile')
    const button = await screen.findByRole('button', { name: 'Delete account' })
    const field = screen.getByLabelText(`Type ${MEMBER.email} to confirm`)
    expect(button).toBeDisabled()
    await user.type(field, 'wrong@example.test')
    expect(button).toBeDisabled()
    await user.clear(field)
    await user.type(field, MEMBER.email)
    await user.click(button)
    expect(await screen.findByRole('main', { name: 'Log in' })).toBeInTheDocument()
    expect(calls(state, '/api/auth/account')[0].body).toEqual({ confirm_email: MEMBER.email })
    expect(state.auth.signedIn).toBe(false)
  })
})
