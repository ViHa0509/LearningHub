/** Spec: agent-chat - Pet can be switched off; Pet never gets in the way (Phone). */
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeApi, twoProviders } from '../test/fakeApi'
import { renderAppReady } from '../test/render'
import { resetScreenClass, setScreenClass } from '../test/screenClass'

const panel = () => screen.getByRole('complementary', { name: 'Agent' })

function withProviders() {
  const state = installFakeApi()
  state.providers = twoProviders()
  return state
}

type User = Awaited<ReturnType<typeof renderAppReady>>['user']
async function openOptions(user: User) {
  await user.click(await within(panel()).findByRole('button', { name: 'Message options' }))
  return within(panel()).getByRole('menu', { name: 'Message options' })
}

afterEach(() => {
  resetScreenClass()
  vi.restoreAllMocks()
})

describe('chat pet in the panel', () => {
  it('is on by default, on the composer, with the greeting', async () => {
    withProviders()
    await renderAppReady()
    await within(panel()).findByRole('button', { name: 'Message options' })
    const pet = panel().querySelector('.composer .chat-pet')!
    expect(pet).toHaveAttribute('aria-hidden', 'true')
    expect(pet).toHaveTextContent('Hi! What are we learning today?')
    expect(panel().querySelector('.agent-messages')).toHaveClass('pet-room')
  })

  // Scenario: Thinking / Done through a real send
  it('shows done after an answer arrives', async () => {
    withProviders()
    const { user } = await renderAppReady()
    await user.type(await within(panel()).findByRole('textbox', { name: 'Message the agent' }), 'hi{Enter}')
    await within(panel()).findByText('ok')
    await waitFor(() => expect(panel().querySelector('.chat-pet')).toHaveAttribute('data-pose', 'done'))
  })

  // Scenario: Error
  it('shows the error pose and keeps the panel error row', async () => {
    const state = withProviders()
    state.chat = () => ({ status: 502, detail: 'Claude main: auth_failed' })
    const { user } = await renderAppReady()
    await user.type(await within(panel()).findByRole('textbox', { name: 'Message the agent' }), 'hi{Enter}')
    expect(await within(panel()).findByRole('alert')).toHaveTextContent('auth_failed')
    await waitFor(() => expect(panel().querySelector('.chat-pet')).toHaveAttribute('data-pose', 'error'))
    expect(panel().querySelector('.chat-pet-bubble')).toHaveTextContent("That didn't work. Try again?")
    expect(panel().querySelector('.chat-pet')).not.toHaveTextContent('auth_failed')
  })

  // Scenario: Switch off, Switch on again
  it('has a Pet checkbox item that switches the pet off and on, kept after a remount', async () => {
    withProviders()
    const first = await renderAppReady()
    let menu = await openOptions(first.user)
    const item = within(menu).getByRole('menuitemcheckbox', { name: 'Pet' })
    expect(item).toHaveAttribute('aria-checked', 'true')
    await first.user.click(item)
    expect(panel().querySelector('.chat-pet')).not.toBeInTheDocument()
    expect(panel().querySelector('.agent-messages')).not.toHaveClass('pet-room')
    expect(localStorage.getItem('learninghub.pet')).toBe('off')
    expect(within(panel()).queryByRole('menu')).not.toBeInTheDocument()
    first.unmount()

    const second = await renderAppReady()
    await within(panel()).findByRole('button', { name: 'Message options' })
    expect(panel().querySelector('.chat-pet')).not.toBeInTheDocument()
    menu = await openOptions(second.user)
    const again = within(menu).getByRole('menuitemcheckbox', { name: 'Pet' })
    expect(again).toHaveAttribute('aria-checked', 'false')
    await second.user.click(again)
    expect(panel().querySelector('.composer .chat-pet')).toBeInTheDocument()
    expect(localStorage.getItem('learninghub.pet')).toBeNull()
  })

  it('works with storage blocked: the choice lasts for the page', async () => {
    withProviders()
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked)
    const { user } = await renderAppReady()
    await within(panel()).findByRole('button', { name: 'Message options' })
    expect(panel().querySelector('.chat-pet')).toBeInTheDocument()
    const menu = await openOptions(user)
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: 'Pet' }))
    expect(panel().querySelector('.chat-pet')).not.toBeInTheDocument()
  })

  // Scenario: Phone
  it('shows no pet at phone size and no extra message padding', async () => {
    withProviders()
    setScreenClass('phone')
    const { user } = await renderAppReady()
    await user.click(screen.getByRole('button', { name: 'Agent' }))
    const dialog = screen.getByRole('dialog', { name: 'Agent' })
    await within(dialog).findByRole('textbox', { name: 'Message the agent' })
    expect(dialog.querySelector('.chat-pet')).not.toBeInTheDocument()
    expect(dialog.querySelector('.agent-messages')).not.toHaveClass('pet-room')
  })

  it('shows the pet at tablet size', async () => {
    withProviders()
    setScreenClass('tablet')
    await renderAppReady()
    await waitFor(() => expect(document.querySelector('.composer .chat-pet')).toBeInTheDocument())
  })
})
