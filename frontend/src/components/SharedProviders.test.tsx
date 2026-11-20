/**
 * Spec: shared-providers - ai-providers (Share a configuration with all users) and agent-providers
 * (Provider resolution, Shared agent setup, Daily limit, Withdrawn warning, Shared setup is read-only).
 * The server-side scenarios (hidden from other users, backup, counting, other users, next day, admin
 * not counted, assigning a shared row refused) are covered by the backend tests.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ProviderIn } from '../api'
import { formatDateTimeShort } from '../lib/time'
import { installFakeApi, makeProvider, OWNER, requireLogin, twoProviders, type FakeState } from '../test/fakeApi'
import { renderApp, renderAppReady } from '../test/render'

const ZONE = 'Asia/Tokyo'
const RESETS = '2026-11-20T00:00:00Z'
const WITHDRAWN = 'The shared provider is no longer available. Add your own provider to keep using the agents.'
const panel = () => screen.getByRole('complementary', { name: 'Agent' })

function asMember(state: FakeState) {
  requireLogin(state, { signedIn: true, owner: { ...OWNER, role: 'member', timezone: ZONE } })
}

/** A member with no configuration of their own, and the admin's shared "Claude main". */
function sharedMember() {
  const state = installFakeApi()
  asMember(state)
  state.shared.rows = [makeProvider('Claude main', 'anthropic', 'claude-sonnet-5-5', { shared: true })]
  return state
}

const putOf = (state: FakeState, url: string) =>
  state.calls.filter((c) => c.method === 'PUT' && c.url === url).at(-1)?.body as ProviderIn

describe('share a configuration (admin)', () => {
  // Scenario: Admin shares
  it('ticks Shared with all users, saves, and the list shows a Public badge', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    state.shared.limit = 7
    const { user } = renderApp('#/settings/providers/p1')
    const box = await screen.findByRole('checkbox', { name: 'Shared with all users' })
    // The line uses the server's daily limit.
    expect(
      screen.getByText('Other users can run the agents on this key without adding their own (7 requests a day each).'),
    ).toBeInTheDocument()
    expect(box).not.toBeChecked()
    const save = screen.getByRole('button', { name: 'Save Changes' })

    await user.click(box)
    await user.click(save)
    await waitFor(() => expect(putOf(state, '/api/ai-providers/p1')).toMatchObject({ shared: true }))

    window.location.hash = '#/settings'
    const card = await screen.findByRole('article', { name: 'Claude main' })
    expect(within(card).getByText('Public')).toBeInTheDocument()
    expect(within(await screen.findByRole('article', { name: 'Local qwen' })).queryByText('Public')).not.toBeInTheDocument()
  })

  // Scenario: Unshare
  it('unticks it and saves as private', async () => {
    const state = installFakeApi()
    state.providers = [makeProvider('Claude main', 'anthropic', 'claude-sonnet-5-5', { shared: true })]
    const { user } = renderApp('#/settings/providers/p1')
    const box = await screen.findByRole('checkbox', { name: 'Shared with all users' })
    expect(box).toBeChecked()
    await user.click(box)
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(putOf(state, '/api/ai-providers/p1')).toMatchObject({ shared: false }))
    expect(state.providers[0].shared).toBe(false)
  })

  it('sends no shared field while the box was never ticked', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    const { user } = renderApp('#/settings/providers/p1')
    const name = await screen.findByLabelText('Name')
    await user.type(name, ' 2')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(putOf(state, '/api/ai-providers/p1')).toBeDefined())
    expect(putOf(state, '/api/ai-providers/p1')).not.toHaveProperty('shared')
  })

  // Scenario: Claude Code cannot be shared
  it('does not offer the switch for Claude Code', async () => {
    installFakeApi()
    const { user } = renderApp('#/settings/providers/new')
    const form = await screen.findByRole('region', { name: 'Provider configuration' })
    expect(within(form).getByRole('checkbox', { name: 'Shared with all users' })).toBeInTheDocument()
    await user.click(within(form).getByRole('radio', { name: 'Claude Code (subscription)' }))
    expect(within(form).queryByRole('checkbox', { name: 'Shared with all users' })).not.toBeInTheDocument()
  })

  // Scenario: Member cannot share
  it('does not offer the switch to a member', async () => {
    const state = installFakeApi()
    asMember(state)
    state.providers = twoProviders()
    await renderAppReady('#/settings/providers/p1')
    await screen.findByLabelText('Name')
    expect(screen.queryByRole('checkbox', { name: 'Shared with all users' })).not.toBeInTheDocument()
  })

  it('shows no Public badge on a member own configuration', async () => {
    const state = installFakeApi()
    asMember(state)
    state.providers = twoProviders()
    await renderAppReady('#/settings')
    await screen.findByRole('article', { name: 'Claude main' })
    expect(screen.queryByText('Public')).not.toBeInTheDocument()
  })
})

describe('a member on the shared provider', () => {
  // Scenario: Shared configuration for a user without one; Read-only rows; Count shown
  it('shows what each agent uses, the count once, and no controls in Settings -> Agents', async () => {
    const state = sharedMember()
    state.shared.used = 3
    state.shared.webSearch = { assistant: true }
    await renderAppReady('#/settings/agents')
    const assistant = await screen.findByRole('article', { name: 'Learning assistant' })
    const writer = await screen.findByRole('article', { name: 'Lesson writer' })
    for (const card of [assistant, writer]) {
      expect(within(card).getByText('Uses Claude main (claude-sonnet-5-5), shared by the admin')).toBeInTheDocument()
      expect(within(card).queryByRole('combobox')).not.toBeInTheDocument()
      expect(within(card).queryByRole('checkbox')).not.toBeInTheDocument()
      expect(within(card).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    }
    // Scenario: Internet search follows the admin
    expect(within(assistant).getByText('Internet search: on')).toBeInTheDocument()
    // Scenario: Count shown
    expect(screen.getAllByText('3 of 10 requests used today')).toHaveLength(1)
    // No key hint, base URL or test result of the shared row.
    expect(screen.queryByText(/…1234/)).not.toBeInTheDocument()
    expect(screen.queryByText('Not tested yet')).not.toBeInTheDocument()
    expect(screen.queryByText(WITHDRAWN)).not.toBeInTheDocument()
  })

  // Scenario: Agent follows the admin's assignment
  it('shows the shared row the admin assigned to an agent', async () => {
    const state = sharedMember()
    state.shared.rows.push(makeProvider('Claude fast', 'anthropic', 'claude-haiku-5-5', { shared: true }))
    state.shared.primary = { 'lesson-writer': state.shared.rows[1].id }
    await renderAppReady('#/settings/agents')
    const writer = await screen.findByRole('article', { name: 'Lesson writer' })
    expect(within(writer).getByText('Uses Claude fast (claude-haiku-5-5), shared by the admin')).toBeInTheDocument()
    const assistant = await screen.findByRole('article', { name: 'Learning assistant' })
    expect(within(assistant).getByText('Uses Claude main (claude-sonnet-5-5), shared by the admin')).toBeInTheDocument()
  })

  // Scenario: Member sees the shared provider as an entry; The entry is read-only
  it('lists the shared provider as a read-only Public entry on the providers page', async () => {
    const state = sharedMember()
    state.shared.used = 4
    await renderAppReady('#/settings')
    const card = await screen.findByRole('article', { name: 'Claude main' })
    expect(within(card).getByRole('heading', { name: 'Claude main' })).toBeInTheDocument()
    expect(within(card).getByText('claude-sonnet-5-5')).toBeInTheDocument()
    expect(within(card).getByText('Public')).toBeInTheDocument()
    expect(within(card).getByText('Shared by the admin')).toBeInTheDocument()
    expect(within(card).getByText('4 of 10 requests used today')).toBeInTheDocument()
    expect(within(card).queryByRole('link')).not.toBeInTheDocument()
    expect(within(card).queryByRole('button')).not.toBeInTheDocument()
    expect(card).not.toHaveTextContent(/anthropic|Active|Inactive|Not tested|…\d/i)
    expect(screen.queryByText(WITHDRAWN)).not.toBeInTheDocument()
  })

  // Scenario: Member with their own provider
  it('shows no Public entry when the member has an own active configuration', async () => {
    const state = sharedMember()
    state.providers = [makeProvider('My key', 'anthropic', 'claude-sonnet-5-5')]
    await renderAppReady('#/settings')
    await screen.findByRole('article', { name: 'My key' })
    expect(screen.queryByText('Public')).not.toBeInTheDocument()
    expect(screen.queryByText('Shared by the admin')).not.toBeInTheDocument()
  })

  // Scenario: Shared configuration for a user without one (the chat answers)
  it('shows no "add a provider" hint in the chat and sends the message', async () => {
    const state = sharedMember()
    const { user } = await renderAppReady('#/')
    const box = await within(panel()).findByRole('textbox', { name: 'Message the agent' })
    expect(within(panel()).queryByText('No AI provider is configured.')).not.toBeInTheDocument()
    await user.type(box, 'hello{Enter}')
    const log = within(panel()).getByRole('log', { name: 'Conversation' })
    expect(await within(log).findByText('Claude main · claude-sonnet-5-5')).toBeInTheDocument()
    expect(state.shared.used).toBe(1)
  })

  // Scenario: Over the limit
  it('shows the limit message and when it resets, in the user zone', async () => {
    const state = sharedMember()
    state.shared.used = 10
    state.shared.resetsAt = RESETS
    const { user } = await renderAppReady('#/')
    const box = await within(panel()).findByRole('textbox', { name: 'Message the agent' })
    await user.type(box, 'one more{Enter}')
    const alert = await within(panel()).findByRole('alert')
    expect(alert).toHaveTextContent(
      "Daily limit reached: you have used today's 10 requests on the shared provider. Add your own provider in Settings, or try again tomorrow.",
    )
    expect(alert).toHaveTextContent(`It resets ${formatDateTimeShort(RESETS, ZONE)}.`)
    // 2026-11-20 00:00 UTC is 9:00 AM in Tokyo.
    expect(alert).toHaveTextContent('Nov 20, 2026')
    expect(alert).toHaveTextContent(/9:00\s?AM/)
    expect(state.shared.used).toBe(10)
  })

  // Scenario: Own configuration wins over a shared one
  it('keeps the own controls and no shared line when the member has a configuration', async () => {
    const state = sharedMember()
    state.providers = [makeProvider('My key', 'anthropic', 'claude-sonnet-5-5')]
    await renderAppReady('#/settings/agents')
    const assistant = await screen.findByRole('article', { name: 'Learning assistant' })
    expect(within(assistant).getByRole('combobox', { name: 'Primary provider' })).toBeInTheDocument()
    expect(within(assistant).getByRole('checkbox', { name: 'Internet search' })).toBeInTheDocument()
    expect(within(assistant).getByText('My key · claude-sonnet-5-5')).toBeInTheDocument()
    expect(screen.queryByText(/shared by the admin/)).not.toBeInTheDocument()
    expect(screen.queryByText(/requests used today/)).not.toBeInTheDocument()
  })
})

describe('the shared provider is withdrawn', () => {
  function withdrawnMember() {
    const state = installFakeApi()
    asMember(state)
    state.shared.recentlyUsed = true
    return state
  }

  // Scenario: Unshared / Switched off or deleted
  it('warns in Settings -> Agents with a link to the providers page', async () => {
    withdrawnMember()
    await renderAppReady('#/settings/agents')
    const page = await screen.findByRole('region', { name: 'Agents' })
    const text = await within(page).findByText(WITHDRAWN)
    const warning = text.closest('p') as HTMLElement
    expect(within(warning).getByRole('img', { name: 'Warning' })).toBeInTheDocument()
    expect(within(warning).getByRole('link', { name: 'Go to AI providers' })).toHaveAttribute('href', '#/settings')
  })

  it('warns above the list on the providers page', async () => {
    withdrawnMember()
    await renderAppReady('#/settings')
    const page = await screen.findByRole('region', { name: 'Settings' })
    const text = await within(page).findByText(WITHDRAWN)
    const warning = text.closest('p') as HTMLElement
    expect(within(warning).getByRole('link', { name: 'Go to AI providers' })).toHaveAttribute('href', '#/settings')
    expect(screen.getByText('No providers yet. Add one to use the agent.')).toBeInTheDocument()
    expect(screen.queryByText('Public')).not.toBeInTheDocument()
  })

  it('warns in the chat hint', async () => {
    withdrawnMember()
    await renderAppReady('#/')
    const text = await within(panel()).findByText(WITHDRAWN)
    expect(within(text.closest('p') as HTMLElement).getByRole('img', { name: 'Warning' })).toBeInTheDocument()
    expect(within(panel()).getByText('No AI provider is configured.')).toBeInTheDocument()
    expect(within(panel()).queryByRole('textbox', { name: 'Message the agent' })).not.toBeInTheDocument()
  })

  // Scenario: Falls back to the user's own configuration
  it('shows no warning once the member has a configuration of their own', async () => {
    const state = withdrawnMember()
    state.providers = [makeProvider('My key', 'anthropic', 'claude-sonnet-5-5')]
    await renderAppReady('#/settings/agents')
    await screen.findByRole('article', { name: 'Learning assistant' })
    expect(screen.queryByText(WITHDRAWN)).not.toBeInTheDocument()
  })

  // Scenario: Shared again
  it('shows no warning when a configuration is shared again', async () => {
    const state = withdrawnMember()
    state.shared.rows = [makeProvider('Claude main', 'anthropic', 'claude-sonnet-5-5', { shared: true })]
    await renderAppReady('#/settings/agents')
    expect(await screen.findAllByText('Uses Claude main (claude-sonnet-5-5), shared by the admin')).toHaveLength(2)
    expect(screen.queryByText(WITHDRAWN)).not.toBeInTheDocument()
  })

  // Scenario: User who never used it
  it('shows the usual hint without the warning for a user who never used the shared provider', async () => {
    const state = installFakeApi()
    asMember(state)
    await renderAppReady('#/')
    const status = await within(panel()).findByRole('status')
    expect(status).toHaveTextContent('No AI provider is configured.')
    expect(within(panel()).queryByText(WITHDRAWN)).not.toBeInTheDocument()
    expect(within(status).getByRole('link', { name: 'Open settings' })).toHaveAttribute('href', '#/settings')
  })
})
