/** Spec: ai-providers (list); agent-providers (assign providers, fallback, provider resolution). */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFakeApi, makeProvider, twoProviders } from '../test/fakeApi'
import { renderAppReady } from '../test/render'

const panel = () => screen.getByRole('complementary', { name: 'Agent' })
const card = (name: string) => screen.findByRole('article', { name })

describe('back from settings', () => {
  // Scenario: Back to the lesson
  it('returns to the last page outside Settings, also after a provider page', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    const { user } = await renderAppReady('#/lesson/devops/docker')
    await screen.findByRole('article', { name: 'Lesson: Docker' })

    await user.click(screen.getByRole('link', { name: 'Settings' }))
    const settings = await screen.findByRole('region', { name: 'Settings' })
    await user.click(await within(settings).findByRole('link', { name: 'Claude main' }))
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/settings\/providers\//))
    window.location.hash = '#/settings'

    const back = await within(await screen.findByRole('region', { name: 'Settings' })).findByRole('link', {
      name: '← Back',
    })
    expect(back).toHaveAttribute('href', '#/lesson/devops/docker')
    await user.click(back)
    expect(await screen.findByRole('article', { name: 'Lesson: Docker' })).toBeInTheDocument()
  })

  // Scenario: Settings opened directly
  it('goes home when Settings was opened directly', async () => {
    installFakeApi()
    await renderAppReady('#/settings')
    const settings = await screen.findByRole('region', { name: 'Settings' })
    expect(within(settings).getByRole('link', { name: '← Back' })).toHaveAttribute('href', '#/')
  })
})

describe('providers list', () => {
  it('is reachable from the top bar and from the agent panel', async () => {
    installFakeApi()
    const { user } = await renderAppReady()
    expect(await within(panel()).findByRole('link', { name: 'Open settings' })).toHaveAttribute('href', '#/settings')
    await user.click(screen.getByRole('link', { name: 'Settings' }))
    expect(await screen.findByRole('region', { name: 'Settings' })).toBeInTheDocument()
    expect(await screen.findByText('No providers yet. Add one to use the agent.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add provider' })).toHaveAttribute('href', '#/settings/providers/new')
  })

  it('lists each configuration with type, model, state, last test and use', async () => {
    const state = installFakeApi()
    state.providers = [
      makeProvider('Claude main', 'anthropic', 'claude-sonnet-5-5', {
        last_test: { status: 'ok', message: 'OK', latency_ms: 300, at: '2026-11-07T10:00:00Z' },
      }),
      makeProvider('Local qwen', 'local', 'qwen3', { is_active: false }),
    ]
    state.assignments.assistant = { primary: 'p1', fallback: null }
    await renderAppReady('#/settings')
    const claude = await card('Claude main')
    expect(claude).toHaveTextContent('Anthropic · claude-sonnet-5-5')
    expect(within(claude).getByText('Active')).toBeInTheDocument()
    expect(within(claude).getByText('Connected')).toBeInTheDocument()
    expect(claude).toHaveTextContent('Used by Learning assistant (primary)')
    expect(within(claude).getByRole('link', { name: 'Claude main' })).toHaveAttribute('href', '#/settings/providers/p1')

    const local = await card('Local qwen')
    expect(within(local).getByText('Inactive')).toBeInTheDocument()
    expect(within(local).getByText('Not tested yet')).toBeInTheDocument()
    expect(local).toHaveTextContent('Not used by any agent')
  })

  it('opens a configuration from its name', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    const { user } = await renderAppReady('#/settings')
    await user.click(within(await card('Local qwen')).getByRole('link', { name: 'Local qwen' }))
    expect(await screen.findByRole('region', { name: 'Provider configuration' })).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Local qwen')).toBeInTheDocument()
  })
})

describe('internet search per agent', () => {
  // Scenario: Setting needs Save
  it('is off by default and saved only with the card Save', async () => {
    const state = installFakeApi()
    state.providers = [makeProvider('Claude sub', 'claude-code', 'sonnet')]
    const { user } = await renderAppReady('#/settings')
    const card = await screen.findByRole('article', { name: 'Learning assistant' })
    const box = within(card).getByRole('checkbox', { name: 'Internet search' })
    expect(box).not.toBeChecked()
    expect(within(card).getByText(/Lets the agent search the web/)).toBeInTheDocument()

    await user.click(box)
    expect(state.webSearch.assistant).toBeUndefined()
    await user.click(within(card).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(state.webSearch.assistant).toBe(true))
    const put = state.calls.find((c) => c.url === '/api/agents/assistant/settings')
    expect(put).toMatchObject({ method: 'PUT', body: { web_search: true } })
  })

  // Scenario: Not a Claude Code provider
  it('says it needs a Claude Code provider for other provider types', async () => {
    const state = installFakeApi()
    state.providers = [makeProvider('GPT', 'openai', 'gpt-5.5')]
    await renderAppReady('#/settings')
    const card = await screen.findByRole('article', { name: 'Learning assistant' })
    expect(
      await within(card).findByText('Internet search needs a Claude Code provider; it has no effect with the current one.'),
    ).toBeInTheDocument()
  })
})

describe('agents section', () => {
  it('assigns different providers to the two agents', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    const { user } = await renderAppReady('#/settings')
    const assistant = await card('Learning assistant')
    const writer = await card('Lesson writer')
    expect(within(assistant).getByLabelText('Primary provider')).toHaveValue('')
    expect(within(assistant).getByRole('option', { name: 'Default: first active provider' })).toBeInTheDocument()
    expect(within(assistant).getByLabelText('Fallback provider')).toHaveValue('')
    expect(within(assistant).getByRole('option', { name: 'None' })).toBeInTheDocument()
    expect(assistant).toHaveTextContent('Uses Claude main · claude-sonnet-5-5')

    await user.selectOptions(within(assistant).getByLabelText('Primary provider'), 'Claude main')
    await user.selectOptions(within(assistant).getByLabelText('Fallback provider'), 'Local qwen')
    await user.click(within(assistant).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(state.assignments.assistant).toEqual({ primary: 'p1', fallback: 'p2' }))
    expect(state.calls.find((c) => c.url === '/api/agents/assistant/provider')?.body).toEqual({
      primary_provider_id: 'p1',
      fallback_provider_id: 'p2',
    })

    await user.selectOptions(within(writer).getByLabelText('Primary provider'), 'Local qwen')
    await user.click(within(writer).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(state.assignments['lesson-writer']).toEqual({ primary: 'p2', fallback: null }))
    // The writer card now names its provider, and the list says who uses each provider.
    await waitFor(() => expect(writer).toHaveTextContent('Uses Local qwen · qwen3'))
    await waitFor(async () => expect(await card('Claude main')).toHaveTextContent('Learning assistant (primary)'))
  })

  it('does not offer the primary as the fallback, and clears an assignment', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    state.assignments.assistant = { primary: 'p1', fallback: 'p2' }
    const { user } = await renderAppReady('#/settings')
    const assistant = await card('Learning assistant')
    const fallback = within(assistant).getByLabelText('Fallback provider')
    await waitFor(() => expect(fallback).toHaveValue('p2'))
    expect(within(fallback).queryByRole('option', { name: 'Claude main' })).toBeNull()
    await user.selectOptions(fallback, 'None')
    await user.click(within(assistant).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(state.assignments.assistant).toEqual({ primary: 'p1', fallback: null }))
  })

  it('offers only active providers as primary and shows the status badge', async () => {
    const state = installFakeApi()
    state.providers = [
      makeProvider('Claude main', 'anthropic', 'claude-sonnet-5-5', {
        last_test: { status: 'rate_limited', message: 'slow down', latency_ms: 10, at: '2026-11-07T10:00:00Z' },
      }),
      makeProvider('Local qwen', 'local', 'qwen3', { is_active: false }),
    ]
    await renderAppReady('#/settings')
    const assistant = await card('Learning assistant')
    const primary = await within(assistant).findByLabelText('Primary provider')
    expect(within(primary).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Default: first active provider',
      'Claude main',
    ])
    expect(within(assistant).getByText('Rate limited')).toBeInTheDocument()
  })

  // Scenario: Unassigned agent follows the assistant
  it("shows that an agent without an assignment uses the assistant's provider", async () => {
    const state = installFakeApi()
    state.providers = [
      makeProvider('Claude main', 'anthropic', 'claude-sonnet-5-5'),
      makeProvider('Claude sub', 'claude-code', 'sonnet'),
    ]
    state.assignments.assistant = { primary: 'p2', fallback: 'p1' }
    await renderAppReady('#/settings')
    const writer = await card('Lesson writer')
    await waitFor(() => expect(writer).toHaveTextContent('Uses Claude sub · sonnet (same as the Learning assistant)'))
    const assistant = await card('Learning assistant')
    expect(assistant).toHaveTextContent('Uses Claude sub · sonnet')
    expect(assistant).not.toHaveTextContent('same as the Learning assistant')
  })

  // Scenario: Own assignment wins
  it('does not say "same as the Learning assistant" for an agent with its own provider', async () => {
    const state = installFakeApi()
    state.providers = [makeProvider('Claude sub', 'claude-code', 'sonnet'), makeProvider('Local qwen', 'local', 'qwen3')]
    state.assignments.assistant = { primary: 'p1', fallback: null }
    state.assignments['lesson-writer'] = { primary: 'p2', fallback: null }
    await renderAppReady('#/settings')
    const writer = await card('Lesson writer')
    await waitFor(() => expect(writer).toHaveTextContent('Uses Local qwen · qwen3'))
    expect(writer).not.toHaveTextContent('same as the Learning assistant')
  })
})

describe('restored providers', () => {
  // Spec: data-sync - Scenario: Provider keys entered again
  it('marks a provider whose type needs a key and has none', async () => {
    const state = installFakeApi()
    state.providers = [
      makeProvider('Restored OpenAI', 'openai', 'gpt-x', { has_key: false, key_hint: null, key_kind: null }),
      makeProvider('Keyed Anthropic', 'anthropic', 'claude-x'),
    ]
    await renderAppReady('#/settings')
    const restored = await card('Restored OpenAI')
    expect(within(restored).getByText(/Needs its API key/)).toBeInTheDocument()
    expect(within(restored).getByRole('link', { name: 'enter it again' })).toHaveAttribute('href', `#/settings/providers/${state.providers[0].id}`)
    expect(within(await card('Keyed Anthropic')).queryByText(/Needs its API key/)).not.toBeInTheDocument()
  })
})
