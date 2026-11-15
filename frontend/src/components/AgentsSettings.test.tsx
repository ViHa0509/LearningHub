/** Spec: agent-settings - Agents page in Settings, Save and Cancel, Too long; agent-providers (moved from the providers page). */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parseRoute, routeHash } from '../lib/route'
import { installFakeApi, makeProvider, twoProviders } from '../test/fakeApi'
import { renderAppReady } from '../test/render'

const card = (name: string) => screen.findByRole('article', { name })
const area = (title: string) => screen.findByRole('article', { name: `Area: ${title}` })
const putsOf = (state: ReturnType<typeof installFakeApi>, domain: string) =>
  state.calls.filter((c) => c.method === 'PUT' && c.url === `/api/agents/areas/${domain}`)
const domainsOf = async () => (await (await fetch('/api/domains')).json()) as { id: string; title: string }[]

describe('agents page', () => {
  // Scenario: Agents page in Settings
  it('has a route and a nav tab for every member', async () => {
    expect(parseRoute('#/settings/agents')).toEqual({ page: 'agents-settings' })
    expect(routeHash({ page: 'agents-settings' })).toBe('#/settings/agents')
    installFakeApi()
    await renderAppReady('#/settings/agents')
    const page = await screen.findByRole('region', { name: 'Agents' })
    const nav = within(page).getByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getByRole('link', { name: 'Agents' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'AI providers' })).not.toHaveAttribute('aria-current')
    expect(within(page).getByRole('heading', { level: 1, name: 'Agents' })).toBeInTheDocument()
  })

  it('shows the agent cards and one card per area', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    await renderAppReady('#/settings/agents')
    expect(await card('Learning assistant')).toBeInTheDocument()
    expect(await card('Lesson writer')).toBeInTheDocument()
    const areas = await screen.findByRole('region', { name: 'Areas' })
    expect(within(areas).getByRole('heading', { name: 'Areas' })).toBeInTheDocument()
    const domains = await domainsOf()
    await waitFor(() => expect(within(areas).getAllByRole('article')).toHaveLength(domains.length))
    const first = within(await area(domains[0].title))
    expect(first.getByLabelText(`Extra instructions for ${domains[0].title}`)).toHaveValue('')
    const tools = first.getByRole('group', { name: `Tools for ${domains[0].title}` })
    const boxes = within(tools).getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes).toHaveLength(9)
    expect(boxes.every((b) => b.checked)).toBe(true)
    expect(tools).toHaveTextContent('save_learned_note')
    expect(tools).toHaveTextContent('(Learning assistant only)')
    expect(tools).toHaveTextContent('(Topic outline only)')
  })
})

describe('area settings', () => {
  const firstArea = async () => {
    const state = installFakeApi()
    const { user } = await renderAppReady('#/settings/agents')
    const d = (await domainsOf())[0]
    return { state, user, d, card: within(await area(d.title)) }
  }

  // Scenario: Save and Cancel
  it('keeps Save disabled until the instructions change, and Cancel restores without a request', async () => {
    const { state, user, d, card } = await firstArea()
    const save = card.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    const box = card.getByLabelText(`Extra instructions for ${d.title}`)
    await user.type(box, 'Answer in Vietnamese')
    expect(save).toBeEnabled()
    await user.click(card.getByRole('button', { name: 'Cancel' }))
    expect(box).toHaveValue('')
    expect(save).toBeDisabled()
    expect(putsOf(state, d.id)).toHaveLength(0)
  })

  it('sends tools null when every tool is ticked, and the ticked names after one is unticked', async () => {
    const { state, user, d, card } = await firstArea()
    await user.type(card.getByLabelText(`Extra instructions for ${d.title}`), 'Be brief')
    await user.click(card.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(putsOf(state, d.id)).toHaveLength(1))
    expect(putsOf(state, d.id)[0].body).toEqual({ instructions: 'Be brief', tools: null })
    expect(await card.findByText('Saved')).toBeInTheDocument()
    await waitFor(() => expect(card.getByRole('button', { name: 'Save' })).toBeDisabled())

    await user.click(card.getByRole('checkbox', { name: /^write_lesson/ }))
    await user.click(card.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(putsOf(state, d.id)).toHaveLength(2))
    expect(putsOf(state, d.id)[1].body).toEqual({
      instructions: 'Be brief',
      tools: [
        'fetch_reference',
        'list_node_resources',
        'list_roadmap',
        'propose_topics',
        'read_lesson',
        'read_note',
        'save_learned_note',
        'search_notes',
      ],
    })
    expect(state.areaAgents[d.id].tools).toHaveLength(8)
    expect(state.headers.at(-1)?.['X-LearningHub']).toBe('1')
  })

  it('loads the saved values, and is clean again when the ticks match the saved ones', async () => {
    const state = installFakeApi()
    state.areaAgents = { devops: { instructions: 'Use Docker examples', tools: ['read_note'] } }
    const { user } = await renderAppReady('#/settings/agents')
    const devops = (await domainsOf()).find((d) => d.id === 'devops')!
    const card = within(await area(devops.title))
    expect(card.getByLabelText(`Extra instructions for ${devops.title}`)).toHaveValue('Use Docker examples')
    const boxes = card.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.filter((b) => b.checked)).toHaveLength(1)
    await user.click(card.getByRole('checkbox', { name: /^search_notes/ }))
    expect(card.getByRole('button', { name: 'Save' })).toBeEnabled()
    await user.click(card.getByRole('checkbox', { name: /^search_notes/ }))
    expect(card.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  // Scenario: Too long
  it('limits the textarea to 4000 characters and shows a counter above 3500', async () => {
    const { d, card } = await firstArea()
    const box = card.getByLabelText(`Extra instructions for ${d.title}`)
    expect(box).toHaveAttribute('maxlength', '4000')
    fireEvent.change(box, { target: { value: 'x'.repeat(3500) } })
    expect(card.queryByText(/\/ 4000/)).not.toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'x'.repeat(3612) } })
    expect(card.getByText('3 612 / 4000')).toBeInTheDocument()
  })

  it('shows the message the server answers when the save is refused', async () => {
    const { state, user, d, card } = await firstArea()
    const real = window.fetch
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith('/api/agents/areas/') && init?.method === 'PUT'
        ? Promise.resolve(
            new Response(JSON.stringify({ detail: 'instructions must be at most 4000 characters' }), {
              status: 422,
              headers: { 'Content-Type': 'application/json' },
            }),
          )
        : real(input, init)) as typeof window.fetch
    try {
      await user.type(card.getByLabelText(`Extra instructions for ${d.title}`), 'x')
      await user.click(card.getByRole('button', { name: 'Save' }))
      expect(await card.findByRole('alert')).toHaveTextContent('instructions must be at most 4000 characters')
      expect(card.getByRole('button', { name: 'Save' })).toBeEnabled()
      expect(state.areaAgents[d.id]).toBeUndefined()
    } finally {
      window.fetch = real
    }
  })

  it('the fake API refuses more than 4000 characters and unknown tools like the backend', async () => {
    const { d } = await firstArea()
    const put = (body: unknown) =>
      fetch(`/api/agents/areas/${d.id}`, { method: 'PUT', headers: { 'X-LearningHub': '1' }, body: JSON.stringify(body) })
    const long = await put({ instructions: 'x'.repeat(4001), tools: null })
    expect(long.status).toBe(422)
    expect((await long.json()).detail).toBe('instructions must be at most 4000 characters')
    expect((await put({ instructions: '', tools: ['nope'] })).status).toBe(422)
    const missing = await fetch('/api/agents/areas/nope', {
      method: 'PUT',
      headers: { 'X-LearningHub': '1' },
      body: JSON.stringify({ instructions: '', tools: null }),
    })
    expect(missing.status).toBe(404)
  })
})

describe('internet search per agent', () => {
  // Scenario: Setting needs Save
  it('is off by default and saved only with the card Save', async () => {
    const state = installFakeApi()
    state.providers = [makeProvider('Claude sub', 'claude-code', 'sonnet')]
    const { user } = await renderAppReady('#/settings/agents')
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

  // Scenario: Not a Claude Code or Anthropic provider
  it('says it needs a Claude Code or Anthropic provider for other provider types', async () => {
    const state = installFakeApi()
    state.providers = [makeProvider('GPT', 'openai', 'gpt-5.5')]
    await renderAppReady('#/settings/agents')
    const card = await screen.findByRole('article', { name: 'Learning assistant' })
    expect(await within(card).findByText('Internet search needs a Claude Code or Anthropic provider; it has no effect with the current one.')).toBeInTheDocument()
  })

  it('offers Anthropic web search with an Anthropic provider', async () => {
    const state = installFakeApi()
    state.providers = [makeProvider('Claude main', 'anthropic', 'claude-opus-5-5')]
    await renderAppReady('#/settings/agents')
    const card = await screen.findByRole('article', { name: 'Learning assistant' })
    expect(await within(card).findByText(/Anthropic's web search/)).toBeInTheDocument()
    expect(within(card).queryByText(/needs a Claude Code/)).not.toBeInTheDocument()
  })
})

describe('agents section', () => {
  it('assigns different providers to the two agents', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    const { user } = await renderAppReady('#/settings/agents')
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
    // ... and the providers page lists who uses each provider.
    window.location.hash = '#/settings'
    await waitFor(async () => expect(await card('Claude main')).toHaveTextContent('Learning assistant (primary)'))
  })

  it('does not offer the primary as the fallback, and clears an assignment', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    state.assignments.assistant = { primary: 'p1', fallback: 'p2' }
    const { user } = await renderAppReady('#/settings/agents')
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
    await renderAppReady('#/settings/agents')
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
    await renderAppReady('#/settings/agents')
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
    await renderAppReady('#/settings/agents')
    const writer = await card('Lesson writer')
    await waitFor(() => expect(writer).toHaveTextContent('Uses Local qwen · qwen3'))
    expect(writer).not.toHaveTextContent('same as the Learning assistant')
  })
})

