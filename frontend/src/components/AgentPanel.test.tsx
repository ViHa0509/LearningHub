/** Spec: agent-chat - Chat panel; agent-providers; lesson-pages - Ask the agent to draft an empty lesson. */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFakeApi, makeProvider, twoProviders } from '../test/fakeApi'
import { renderApp } from '../test/render'

const panel = () => screen.getByRole('complementary', { name: 'Agent' })

function withProviders() {
  const state = installFakeApi()
  state.providers = twoProviders()
  return state
}

const chats = (state: ReturnType<typeof installFakeApi>) => state.calls.filter((c) => c.url === '/api/agent/chat')

describe('agent panel', () => {
  it('links to Settings when no provider is active', async () => {
    const state = installFakeApi()
    state.providers = [makeProvider('Off', 'anthropic', 'claude-sonnet-5-5', { is_active: false })]
    renderApp()
    const status = await within(panel()).findByRole('status')
    expect(status).toHaveTextContent('No AI provider is configured.')
    expect(within(status).getByRole('link', { name: 'Open settings' })).toHaveAttribute('href', '#/settings')
    expect(within(panel()).queryByRole('textbox', { name: 'Message the agent' })).not.toBeInTheDocument()
  })

  it('asks a question with Enter and shows the answer, its tool trace and who answered', async () => {
    const state = withProviders()
    state.chat = () => ({
      reply: 'You noted **allkeys-lru**. <script>window.__x = 1</script>',
      steps: [
        { tool: 'search_notes', input: { query: 'redis' }, summary: "Searched notes for 'redis': 1 found" },
        { tool: 'read_note', input: { note_id: 'n1' }, summary: "Read note 'Redis eviction'" },
      ],
    })
    const { user } = renderApp('#/roadmap/backend')
    const box = await within(panel()).findByRole('textbox', { name: 'Message the agent' })
    const picker = within(panel()).getByRole('combobox', { name: 'Provider' })
    expect(picker).toHaveValue('')
    expect(within(panel()).queryByRole('combobox', { name: 'Model' })).not.toBeInTheDocument()

    await user.type(box, 'what about redis?{Enter}')

    const log = within(panel()).getByRole('log', { name: 'Conversation' })
    expect(within(log).getByText('what about redis?')).toBeInTheDocument()
    expect((await within(log).findByText('allkeys-lru')).tagName).toBe('STRONG')
    expect(log.querySelector('script')).toBeNull()
    expect(within(log).getByText('Used 2 tools')).toBeInTheDocument()
    expect(within(log).getByText("Read note 'Redis eviction'")).toBeInTheDocument()
    expect(within(log).getByText('Claude main · claude-sonnet-5-5')).toBeInTheDocument()
    expect(box).toHaveValue('')

    expect(chats(state)[0].body).toEqual({
      agent_id: 'assistant',
      messages: [{ role: 'user', content: 'what about redis?' }],
      page: { kind: 'roadmap', domain: 'backend' },
    })
  })

  it('offers "Agent default" with the resolved provider, and the active configurations', async () => {
    const state = installFakeApi()
    state.providers = [...twoProviders(), makeProvider('Old', 'openai', 'gpt-5.5', { is_active: false })]
    state.assignments.assistant = { primary: 'p2', fallback: null }
    renderApp()
    const picker = await within(panel()).findByRole('combobox', { name: 'Provider' })
    await waitFor(() =>
      expect(within(picker).getAllByRole('option')[0]).toHaveTextContent('Agent default (Local qwen · qwen3)'),
    )
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Agent default (Local qwen · qwen3)',
      'Claude main',
      'Local qwen',
    ])
  })

  it('answers from the chosen provider for this conversation without changing the assignment', async () => {
    const state = withProviders()
    state.assignments.assistant = { primary: 'p1', fallback: null }
    const { user } = renderApp()
    const picker = await within(panel()).findByRole('combobox', { name: 'Provider' })
    await user.selectOptions(picker, 'Local qwen')
    expect(JSON.parse(localStorage.getItem('learninghub.agent') ?? '{}')).toEqual({ provider_id: 'p2' })

    await user.type(within(panel()).getByRole('textbox', { name: 'Message the agent' }), 'hi{Enter}')
    expect(await within(panel()).findByText('Local qwen · qwen3')).toBeInTheDocument()
    expect(chats(state)[0].body).toMatchObject({ agent_id: 'assistant', provider_id: 'p2' })
    expect(state.assignments.assistant).toEqual({ primary: 'p1', fallback: null })

    await user.selectOptions(picker, picker.querySelector('option') as HTMLOptionElement)
    await user.type(within(panel()).getByRole('textbox', { name: 'Message the agent' }), 'again{Enter}')
    await waitFor(() => expect(chats(state)).toHaveLength(2))
    expect(chats(state)[1].body).not.toHaveProperty('provider_id')
  })

  it('marks an answer that came from the fallback', async () => {
    const state = withProviders()
    state.chat = () => ({
      reply: 'From the spare.',
      provider: { id: 'p2', name: 'Local qwen', model: 'qwen3' },
      fallback_used: true,
    })
    const { user } = renderApp()
    await user.type(await within(panel()).findByRole('textbox', { name: 'Message the agent' }), 'hi{Enter}')
    expect(await within(panel()).findByText('From the spare.')).toBeInTheDocument()
    expect(within(panel()).getByText('Local qwen · qwen3 (fallback)')).toBeInTheDocument()
  })

  it('keeps Shift+Enter as a new line and sends the history with the next question', async () => {
    const state = withProviders()
    let n = 0
    state.chat = () => ({ reply: `answer ${++n}` })
    const { user } = renderApp()
    const box = await within(panel()).findByRole('textbox', { name: 'Message the agent' })
    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two')
    expect(box).toHaveValue('line one\nline two')
    await user.click(within(panel()).getByRole('button', { name: 'Send' }))
    await within(panel()).findByText('answer 1')
    await user.type(box, 'follow up{Enter}')
    await within(panel()).findByText('answer 2')

    expect((chats(state)[1].body as { messages: unknown[] }).messages).toEqual([
      { role: 'user', content: 'line one\nline two' },
      { role: 'assistant', content: 'answer 1' },
      { role: 'user', content: 'follow up' },
    ])
  })

  it('shows an error under the question and lets the user send again', async () => {
    const state = withProviders()
    state.chat = () => ({ status: 502, detail: 'Claude main: auth_failed' })
    const { user } = renderApp()
    const box = await within(panel()).findByRole('textbox', { name: 'Message the agent' })
    await user.type(box, 'hello{Enter}')
    expect(await within(panel()).findByRole('alert')).toHaveTextContent('auth_failed')

    state.chat = () => ({ reply: 'Hi again.' })
    await user.type(box, 'hello again{Enter}')
    expect(await within(panel()).findByText('Hi again.')).toBeInTheDocument()
    // The failed question is not sent again as history.
    expect((chats(state).at(-1)!.body as { messages: unknown[] }).messages).toEqual([
      { role: 'user', content: 'hello again' },
    ])
  })

  it('clears the chat', async () => {
    withProviders()
    const { user } = renderApp()
    await user.type(await within(panel()).findByRole('textbox', { name: 'Message the agent' }), 'hi{Enter}')
    await within(panel()).findByText('ok')
    await user.click(within(panel()).getByRole('button', { name: 'Clear chat' }))
    expect(within(panel()).queryByText('ok')).not.toBeInTheDocument()
  })
})

describe('draft with agent', () => {
  it('asks the lesson writer to draft an empty lesson and shows it once written', async () => {
    const state = withProviders()
    state.assignments['lesson-writer'] = { primary: 'p2', fallback: null }
    state.chat = (body) => {
      state.lessons['backend/caching'] = {
        node_id: 'backend/caching',
        body: '## Caching\n\nKeep hot data close.',
        source: 'agent',
        updated_at: '2026-11-07T00:00:00Z',
      }
      expect(body.page).toEqual({ kind: 'lesson', domain: 'backend', node: 'caching' })
      return { reply: 'Drafted.', changed_lessons: ['backend/caching'] }
    }
    const { user } = renderApp('#/lesson/backend/caching')
    const lesson = await screen.findByRole('article', { name: 'Lesson: Caching' })
    await user.click(await within(lesson).findByRole('button', { name: 'Draft with agent' }))

    expect(await within(panel()).findByText('Drafted.')).toBeInTheDocument()
    expect(within(panel()).getByText('Draft this lesson (backend/caching).')).toBeInTheDocument()
    expect(within(panel()).getByText('Local qwen · qwen3')).toBeInTheDocument()
    expect(chats(state)[0].body).toMatchObject({ agent_id: 'lesson-writer' })
    expect(chats(state)[0].body).not.toHaveProperty('provider_id')
    await waitFor(() => expect(within(lesson).getByTestId('lesson-body')).toHaveTextContent('Keep hot data close.'))
  })

  it('offers no draft button without an active provider', async () => {
    installFakeApi()
    renderApp('#/lesson/backend/apis')
    const lesson = await screen.findByRole('article', { name: 'Lesson: APIs' })
    await within(lesson).findByText(/No lesson yet/)
    await within(panel()).findByRole('status')
    expect(within(lesson).queryByRole('button', { name: 'Draft with agent' })).not.toBeInTheDocument()
  })
})
