/**
 * Spec: chat-history - History in the chat panel, The open chat survives a reload;
 * agent-chat - Chat panel (New chat and History).
 */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ChatRequest, ChatSessionDetail, StoredChatMessage } from '../../api'
import { installFakeApi, twoProviders } from '../../test/fakeApi'
import { renderAppReady } from '../../test/render'

const SESSION_KEY = 'lh.agent.session'
const panel = () => screen.getByRole('complementary', { name: 'Agent' })
const history = () => within(panel()).getByRole('region', { name: 'Chat history' })
const input = () => within(panel()).findByRole('textbox', { name: 'Message the agent' })
const row = (title: string) =>
  within(history()).getByRole('button', { name: (name) => name.startsWith(title) })

const message = (id: string, role: 'user' | 'assistant', content: string, extra: Partial<StoredChatMessage> = {}) => ({
  id,
  role,
  content,
  display: role === 'user' ? content : null,
  agent_id: role === 'user' ? 'assistant' : null,
  attachments: [],
  steps: [],
  stopped: false,
  provider: role === 'assistant' ? { name: 'Claude main', model: 'claude-sonnet-5-5' } : null,
  fallback_used: false,
  effort: role === 'assistant' ? ('medium' as const) : null,
  created_at: '2026-11-12T10:00:00Z',
  ...extra,
})

const stored = (id: string, title: string, messages: StoredChatMessage[], at = '2026-11-12T10:00:00Z'): ChatSessionDetail => ({
  id,
  title,
  created_at: at,
  last_message_at: at,
  message_count: messages.length,
  messages,
})

const jwtChat = () =>
  stored('s-jwt', 'what is JWT?', [
    message('m1', 'user', 'what is JWT?'),
    message('m2', 'assistant', 'A signed token.'),
  ])

function setup(sessions: ChatSessionDetail[] = []) {
  const state = installFakeApi()
  state.providers = twoProviders()
  state.chatSessions = sessions
  return state
}

const chats = (state: ReturnType<typeof installFakeApi>) => state.calls.filter((c) => c.url === '/api/agent/chat')

async function openHistory(user: Awaited<ReturnType<typeof renderAppReady>>['user']) {
  const toggle = await within(panel()).findByRole('button', { name: 'History' })
  await user.click(toggle)
  return toggle
}

describe('chat history', () => {
  it('says there are no past chats yet', async () => {
    setup()
    const { user } = await renderAppReady()
    const toggle = await openHistory(user)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(await within(history()).findByText('No past chats yet.')).toBeInTheDocument()
    // History replaces the conversation and the input; pressing it again brings them back.
    expect(within(panel()).queryByRole('textbox', { name: 'Message the agent' })).not.toBeInTheDocument()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(await input()).toBeVisible()
  })

  it('reopens a past chat and continues it', async () => {
    const state = setup([jwtChat()])
    state.chat = () => ({ reply: 'Through the exp claim.' })
    const { user } = await renderAppReady()
    await openHistory(user)
    const item = await waitFor(() => row('what is JWT?'))
    expect(item).toHaveTextContent('2 messages')
    expect(item).not.toHaveAttribute('aria-current')
    await user.click(item)

    expect(within(panel()).queryByRole('region', { name: 'Chat history' })).not.toBeInTheDocument()
    expect(await within(panel()).findByText('what is JWT?')).toBeInTheDocument()
    expect(within(panel()).getByText('A signed token.')).toBeInTheDocument()

    await user.type(await input(), 'and how does it expire?{Enter}')
    expect(await within(panel()).findByText('Through the exp claim.')).toBeInTheDocument()
    const body = chats(state).at(-1)!.body as ChatRequest
    expect(body.session_id).toBe('s-jwt')
    expect(body.messages).toEqual([
      { role: 'user', content: 'and how does it expire?', display: 'and how does it expire?' },
    ])
    expect(within(panel()).getByText('what is JWT?')).toBeInTheDocument()

    await openHistory(user)
    const again = await waitFor(() => row('what is JWT?'))
    expect(again).toHaveTextContent('4 messages')
    expect(again).toHaveAttribute('aria-current', 'true')
    expect(within(history()).getAllByRole('listitem')).toHaveLength(1)
  })

  it('shows a reopened chat as it was: typed text, tool trace, who answered, effort, fallback and file names', async () => {
    const chat = stored('s-quiz', '/quiz JWT', [
      message('m1', 'user', 'Quiz me on this topic: JWT', {
        display: '/quiz JWT',
        attachments: ['jwt.md'],
      }),
      message('m2', 'assistant', 'Question 1: what does exp mean?', {
        steps: [{ tool: 'search_notes', input: { query: 'jwt' }, summary: "Searched notes for 'jwt': 1 found" }],
        provider: { name: 'Local qwen', model: 'qwen3' },
        fallback_used: true,
        effort: 'high',
      }),
    ])
    const state = setup([chat])
    const { user } = await renderAppReady()
    await openHistory(user)
    await user.click(await waitFor(() => row('/quiz JWT')))

    const log = within(panel()).getByRole('log')
    expect(await within(log).findByText('/quiz JWT')).toBeInTheDocument()
    expect(within(log).queryByText('Quiz me on this topic: JWT')).not.toBeInTheDocument()
    expect(within(log).getByText('Question 1: what does exp mean?')).toBeInTheDocument()
    expect(within(log).getByText('Used 1 tool')).toBeInTheDocument()
    expect(within(log).getByText("Searched notes for 'jwt': 1 found")).toBeInTheDocument()
    expect(within(log).getByText('Local qwen · qwen3 (fallback)')).toBeInTheDocument()
    expect(within(log).getByText('High')).toBeInTheDocument()
    expect(within(within(log).getByRole('list', { name: 'Attached files' })).getByText('jwt.md')).toBeInTheDocument()

    // Retrying the stored answer replaces the stored turn.
    state.chat = () => ({ reply: 'Question 1, again.' })
    await user.click(within(log).getByRole('button', { name: 'Retry' }))
    expect(await within(log).findByText('Question 1, again.')).toBeInTheDocument()
    const body = chats(state).at(-1)!.body as ChatRequest
    expect(body.session_id).toBe('s-quiz')
    expect(body.retry_from).toBe('m1')
    expect(body.messages).toEqual([{ role: 'user', content: 'Quiz me on this topic: JWT', display: '/quiz JWT' }])
  })

  it('renames a chat with Save, Enter saves, and Cancel or Escape keep the title', async () => {
    const state = setup([jwtChat()])
    const { user } = await renderAppReady()
    await openHistory(user)
    await waitFor(() => row('what is JWT?'))

    await user.click(within(history()).getByRole('button', { name: 'Rename what is JWT?' }))
    const field = within(history()).getByRole('textbox', { name: 'Chat title' })
    expect(field).toHaveValue('what is JWT?')
    expect(field).toHaveFocus()
    const save = within(history()).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await user.clear(field)
    expect(save).toBeDisabled()
    await user.type(field, 'JWT expiry')
    expect(save).toBeEnabled()
    await user.click(save)
    expect(await waitFor(() => row('JWT expiry'))).toBeInTheDocument()
    expect(state.chatSessions[0].title).toBe('JWT expiry')

    // Escape and Cancel leave it as it is.
    await user.click(within(history()).getByRole('button', { name: 'Rename JWT expiry' }))
    await user.type(within(history()).getByRole('textbox', { name: 'Chat title' }), ' draft{Escape}')
    expect(within(history()).queryByRole('textbox', { name: 'Chat title' })).not.toBeInTheDocument()
    await user.click(within(history()).getByRole('button', { name: 'Rename JWT expiry' }))
    await user.type(within(history()).getByRole('textbox', { name: 'Chat title' }), ' draft')
    await user.click(within(history()).getByRole('button', { name: 'Cancel' }))
    expect(row('JWT expiry')).toBeInTheDocument()
    expect(state.chatSessions[0].title).toBe('JWT expiry')

    // Enter saves.
    await user.click(within(history()).getByRole('button', { name: 'Rename JWT expiry' }))
    await user.type(within(history()).getByRole('textbox', { name: 'Chat title' }), ' rules{Enter}')
    expect(await waitFor(() => row('JWT expiry rules'))).toBeInTheDocument()
    expect(state.calls.filter((c) => c.method === 'PATCH' && c.url === '/api/agent/sessions/s-jwt')).toHaveLength(2)
  })

  it('deletes the open chat after a confirmation and shows an empty new chat', async () => {
    const other = stored('s-redis', 'redis', [message('r1', 'user', 'redis'), message('r2', 'assistant', 'An in-memory store.')])
    const state = setup([jwtChat(), other])
    const { user } = await renderAppReady()
    await openHistory(user)
    await user.click(await waitFor(() => row('what is JWT?')))
    expect(await within(panel()).findByText('A signed token.')).toBeInTheDocument()

    await openHistory(user)
    await user.click(within(history()).getByRole('button', { name: 'Delete what is JWT?' }))
    const confirm = within(history()).getByRole('alertdialog', { name: 'Confirm delete' })
    expect(state.calls.some((c) => c.method === 'DELETE')).toBe(false)
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(row('what is JWT?')).toBeInTheDocument()

    await user.click(within(history()).getByRole('button', { name: 'Delete what is JWT?' }))
    await user.click(within(history()).getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(within(history()).getAllByRole('listitem')).toHaveLength(1))
    expect(row('redis')).toBeInTheDocument()
    expect(state.chatSessions.map((s) => s.id)).toEqual(['s-redis'])

    await user.click(within(panel()).getByRole('button', { name: 'History' }))
    expect(within(panel()).queryByText('A signed token.')).not.toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: 'New chat' })).toBeDisabled()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('New chat leaves History and empties the conversation', async () => {
    setup([jwtChat()])
    const { user } = await renderAppReady()
    await openHistory(user)
    await user.click(await waitFor(() => row('what is JWT?')))
    await within(panel()).findByText('A signed token.')
    await openHistory(user)
    await user.click(within(panel()).getByRole('button', { name: 'New chat' }))
    expect(within(panel()).queryByRole('region', { name: 'Chat history' })).not.toBeInTheDocument()
    expect(within(panel()).queryByText('A signed token.')).not.toBeInTheDocument()
    const box = await input()
    await waitFor(() => expect(box).toHaveFocus())
  })
})

describe('the open chat survives a reload', () => {
  it('remembers the chat it is in and shows it again', async () => {
    const state = setup()
    state.chat = () => ({ reply: 'A signed token.' })
    const first = await renderAppReady()
    await first.user.type(await input(), 'what is JWT?{Enter}')
    await within(panel()).findByText('A signed token.')
    const id = state.chatSessions[0].id
    expect(localStorage.getItem(SESSION_KEY)).toBe(id)
    first.unmount()

    state.chat = () => ({ reply: 'Through the exp claim.' })
    const { user } = await renderAppReady()
    expect(await within(panel()).findByText('A signed token.')).toBeInTheDocument()
    expect(within(panel()).getByText('what is JWT?')).toBeInTheDocument()
    await user.type(await input(), 'and how does it expire?{Enter}')
    await within(panel()).findByText('Through the exp claim.')
    expect((chats(state).at(-1)!.body as ChatRequest).session_id).toBe(id)
    expect(state.chatSessions).toHaveLength(1)
    expect(state.chatSessions[0].message_count).toBe(4)
  })

  it('starts an empty new chat without an error when the remembered chat is gone', async () => {
    const state = setup()
    localStorage.setItem(SESSION_KEY, 'deleted-elsewhere')
    const { user } = await renderAppReady()
    await waitFor(() => expect(state.calls.some((c) => c.url === '/api/agent/sessions/deleted-elsewhere')).toBe(true))
    await waitFor(() => expect(localStorage.getItem(SESSION_KEY)).toBeNull())
    expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: 'New chat' })).toBeDisabled()
    await user.type(await input(), 'hello{Enter}')
    await within(panel()).findByText('ok')
    expect((chats(state).at(-1)!.body as ChatRequest).session_id).toBeUndefined()
  })
})
