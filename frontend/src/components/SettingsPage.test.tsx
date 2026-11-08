/** Spec: ai-providers (list); agent-providers (assign providers, fallback). */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFakeApi, makeProvider, twoProviders } from '../test/fakeApi'
import { renderApp } from '../test/render'

const panel = () => screen.getByRole('complementary', { name: 'Agent' })
const card = (name: string) => screen.findByRole('article', { name })

describe('back from settings', () => {
  // Scenario: Back to the lesson
  it('returns to the last page outside Settings, also after a provider page', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    const { user } = renderApp('#/lesson/devops/docker')
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
    renderApp('#/settings')
    const settings = await screen.findByRole('region', { name: 'Settings' })
    expect(within(settings).getByRole('link', { name: '← Back' })).toHaveAttribute('href', '#/')
  })
})

describe('providers list', () => {
  it('is reachable from the top bar and from the agent panel', async () => {
    installFakeApi()
    const { user } = renderApp()
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
    renderApp('#/settings')
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
    const { user } = renderApp('#/settings')
    await user.click(within(await card('Local qwen')).getByRole('link', { name: 'Local qwen' }))
    expect(await screen.findByRole('region', { name: 'Provider configuration' })).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Local qwen')).toBeInTheDocument()
  })
})

describe('agents section', () => {
  it('assigns different providers to the two agents', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    const { user } = renderApp('#/settings')
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
    const { user } = renderApp('#/settings')
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
    renderApp('#/settings')
    const assistant = await card('Learning assistant')
    const primary = await within(assistant).findByLabelText('Primary provider')
    expect(within(primary).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Default: first active provider',
      'Claude main',
    ])
    expect(within(assistant).getByText('Rate limited')).toBeInTheDocument()
  })
})
