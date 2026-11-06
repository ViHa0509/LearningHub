/** Spec: agent-chat - Chat panel; lesson-pages - Ask the agent to draft an empty lesson. */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFakeApi, PROVIDERS } from '../test/fakeApi'
import { renderApp } from '../test/render'

const panel = () => screen.getByRole('complementary', { name: 'Agent' })

function withProviders() {
  const state = installFakeApi()
  state.providers = PROVIDERS.map((p) => ({ ...p, available: p.id === 'anthropic' }))
  return state
}

describe('agent panel', () => {
  it('explains how to configure a provider when none is available', async () => {
    installFakeApi()
    renderApp()
    const status = await within(panel()).findByRole('status')
    expect(status).toHaveTextContent('No AI provider is configured.')
    expect(status).toHaveTextContent('backend/.env')
    expect(within(status).getByText('LH_ANTHROPIC_API_KEY')).toBeInTheDocument()
    expect(within(panel()).queryByRole('textbox', { name: 'Message the agent' })).not.toBeInTheDocument()
  })

  it('asks a question with Enter and shows the Markdown answer with its tool trace', async () => {
    const state = withProviders()
    state.chat = () => ({
      reply: 'You noted **allkeys-lru**. <script>window.__x = 1</script>',
      steps: [
        { tool: 'search_notes', input: { query: 'redis' }, summary: "Searched notes for 'redis': 1 found" },
        { tool: 'read_note', input: { note_id: 'n1' }, summary: "Read note 'Redis eviction'" },
      ],
      changed_lessons: [],
      stopped: false,
    })
    const { user } = renderApp('#/roadmap/backend')
    const box = await within(panel()).findByRole('textbox', { name: 'Message the agent' })
    expect(within(panel()).getByRole('combobox', { name: 'Provider' })).toHaveValue('anthropic')
    expect(within(panel()).getByRole('combobox', { name: 'Model' })).toHaveValue('claude-sonnet-5-5')

    await user.type(box, 'what about redis?{Enter}')

    const log = within(panel()).getByRole('log', { name: 'Conversation' })
    expect(within(log).getByText('what about redis?')).toBeInTheDocument()
    expect((await within(log).findByText('allkeys-lru')).tagName).toBe('STRONG')
    expect(log.querySelector('script')).toBeNull()
    expect(within(log).getByText('Used 2 tools')).toBeInTheDocument()
    expect(within(log).getByText("Read note 'Redis eviction'")).toBeInTheDocument()
    expect(box).toHaveValue('')

    const sent = state.calls.find((c) => c.url === '/api/agent/chat')?.body
    expect(sent).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      messages: [{ role: 'user', content: 'what about redis?' }],
      page: { kind: 'roadmap', domain: 'backend' },
    })
  })

  it('keeps Shift+Enter as a new line and sends the history with the next question', async () => {
    const state = withProviders()
    let n = 0
    state.chat = () => ({ reply: `answer ${++n}`, steps: [], changed_lessons: [], stopped: false })
    const { user } = renderApp()
    const box = await within(panel()).findByRole('textbox', { name: 'Message the agent' })
    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two')
    expect(box).toHaveValue('line one\nline two')
    await user.click(within(panel()).getByRole('button', { name: 'Send' }))
    await within(panel()).findByText('answer 1')
    await user.type(box, 'follow up{Enter}')
    await within(panel()).findByText('answer 2')

    const chats = state.calls.filter((c) => c.url === '/api/agent/chat')
    expect((chats[1].body as { messages: unknown[] }).messages).toEqual([
      { role: 'user', content: 'line one\nline two' },
      { role: 'assistant', content: 'answer 1' },
      { role: 'user', content: 'follow up' },
    ])
  })

  it('shows an error under the question and lets the user send again', async () => {
    const state = withProviders()
    state.chat = () => ({ status: 502, detail: 'Anthropic (Claude): invalid x-api-key' })
    const { user } = renderApp()
    const box = await within(panel()).findByRole('textbox', { name: 'Message the agent' })
    await user.type(box, 'hello{Enter}')
    expect(await within(panel()).findByRole('alert')).toHaveTextContent('invalid x-api-key')

    state.chat = () => ({ reply: 'Hi again.', steps: [], changed_lessons: [], stopped: false })
    await user.type(box, 'hello again{Enter}')
    expect(await within(panel()).findByText('Hi again.')).toBeInTheDocument()
    const last = state.calls.filter((c) => c.url === '/api/agent/chat').at(-1)?.body as { messages: unknown[] }
    // The failed question is not sent again as history.
    expect(last.messages).toEqual([{ role: 'user', content: 'hello again' }])
  })

  it('switches provider and model, and clears the chat', async () => {
    const state = installFakeApi()
    state.providers = PROVIDERS
    const { user } = renderApp()
    const provider = await within(panel()).findByRole('combobox', { name: 'Provider' })
    await user.selectOptions(provider, 'openai')
    expect(within(panel()).getByRole('combobox', { name: 'Model' })).toHaveValue('gpt-5.5')
    await user.selectOptions(provider, 'anthropic')
    await user.selectOptions(within(panel()).getByRole('combobox', { name: 'Model' }), 'claude-haiku-5-5')
    expect(JSON.parse(localStorage.getItem('learninghub.agent') ?? '{}')).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
    })

    await user.type(within(panel()).getByRole('textbox', { name: 'Message the agent' }), 'hi{Enter}')
    await within(panel()).findByText('ok')
    await user.click(within(panel()).getByRole('button', { name: 'Clear chat' }))
    expect(within(panel()).queryByText('ok')).not.toBeInTheDocument()
  })
})

describe('draft with agent', () => {
  it('asks the agent to draft an empty lesson and shows it once written', async () => {
    const state = withProviders()
    state.chat = (body) => {
      state.lessons['backend/caching'] = {
        node_id: 'backend/caching',
        body: '## Caching\n\nKeep hot data close.',
        source: 'agent',
        updated_at: '2026-11-07T00:00:00Z',
      }
      expect(body.page).toEqual({ kind: 'lesson', domain: 'backend', node: 'caching' })
      return { reply: 'Drafted.', steps: [], changed_lessons: ['backend/caching'], stopped: false }
    }
    const { user } = renderApp('#/lesson/backend/caching')
    const lesson = await screen.findByRole('article', { name: 'Lesson: Caching' })
    await user.click(await within(lesson).findByRole('button', { name: 'Draft with agent' }))

    expect(await within(panel()).findByText('Drafted.')).toBeInTheDocument()
    expect(within(panel()).getByText('Draft this lesson (backend/caching).')).toBeInTheDocument()
    await waitFor(() => expect(within(lesson).getByTestId('lesson-body')).toHaveTextContent('Keep hot data close.'))
  })

  it('offers no draft button without a provider', async () => {
    installFakeApi()
    renderApp('#/lesson/backend/apis')
    const lesson = await screen.findByRole('article', { name: 'Lesson: APIs' })
    await within(lesson).findByText(/No lesson yet/)
    await within(panel()).findByRole('status')
    expect(within(lesson).queryByRole('button', { name: 'Draft with agent' })).not.toBeInTheDocument()
  })
})
