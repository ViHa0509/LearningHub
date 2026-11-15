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

describe('providers page', () => {
  // Scenario: Agents page in Settings (the providers page shows the providers only)
  it('no longer shows the agent cards', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    await renderAppReady('#/settings')
    await card('Claude main')
    expect(screen.queryByRole('article', { name: 'Learning assistant' })).not.toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Lesson writer' })).not.toBeInTheDocument()
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
