/**
 * Spec: agent-chat - Chat panel, Skills in the composer, Effort per message, Text attachments;
 * agent-providers; lesson-pages - Ask the agent to draft an empty lesson.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ChatRequest } from '../api'
import { SKILLS } from '../lib/skills'
import { installFakeApi, makeProvider, twoProviders } from '../test/fakeApi'
import { renderAppReady } from '../test/render'

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
    await renderAppReady()
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
    const { user } = await renderAppReady('#/roadmap/backend')
    const box = await within(panel()).findByRole('textbox', { name: 'Message the agent' })
    // No provider or model picker: the agent's assignment decides (Settings -> Agents).
    expect(within(panel()).queryByRole('combobox')).not.toBeInTheDocument()

    await user.type(box, 'what about redis?{Enter}')

    const log = within(panel()).getByRole('log', { name: 'Conversation' })
    expect(within(log).getByText('what about redis?')).toBeInTheDocument()
    expect((await within(log).findByText('allkeys-lru')).tagName).toBe('STRONG')
    expect(log.querySelector('script')).toBeNull()
    expect(within(log).getByText('Used 2 tools')).toBeInTheDocument()
    expect(within(log).getByText("Read note 'Redis eviction'")).toBeInTheDocument()
    expect(within(log).getByText('Claude main · claude-sonnet-5-5')).toBeInTheDocument()
    expect(within(log).getByText('Medium')).toBeInTheDocument()
    expect(box).toHaveValue('')

    expect(chats(state)[0].body).toEqual({
      agent_id: 'assistant',
      messages: [{ role: 'user', content: 'what about redis?', display: 'what about redis?' }],
      page: { kind: 'roadmap', domain: 'backend' },
      effort: 'medium',
    })
  })

  // Scenario: The panel follows the assignment
  it('has no provider picker and answers from the assigned provider', async () => {
    const state = withProviders()
    state.assignments.assistant = { primary: 'p2', fallback: null }
    localStorage.setItem('learninghub.agent', JSON.stringify({ provider_id: 'p1' }))
    const { user } = await renderAppReady()
    const box = await within(panel()).findByRole('textbox', { name: 'Message the agent' })
    expect(within(panel()).queryByRole('combobox', { name: 'Provider' })).not.toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: 'Agent: Learning assistant' })).toHaveTextContent(
      'via Local qwen',
    )

    await user.type(box, 'hi{Enter}')
    expect(await within(panel()).findByText('Local qwen · qwen3')).toBeInTheDocument()
    // An old saved choice is ignored: the request names no provider.
    expect(chats(state)[0].body).not.toHaveProperty('provider_id')
    expect(state.assignments.assistant).toEqual({ primary: 'p2', fallback: null })
  })

  it('marks an answer that came from the fallback', async () => {
    const state = withProviders()
    state.chat = () => ({
      reply: 'From the spare.',
      provider: { id: 'p2', name: 'Local qwen', model: 'qwen3' },
      fallback_used: true,
    })
    const { user } = await renderAppReady()
    await user.type(await within(panel()).findByRole('textbox', { name: 'Message the agent' }), 'hi{Enter}')
    expect(await within(panel()).findByText('From the spare.')).toBeInTheDocument()
    expect(within(panel()).getByText('Local qwen · qwen3 (fallback)')).toBeInTheDocument()
  })

  it('keeps Shift+Enter as a new line and continues the stored chat with the next question', async () => {
    const state = withProviders()
    let n = 0
    state.chat = () => ({ reply: `answer ${++n}` })
    const { user } = await renderAppReady()
    const box = await within(panel()).findByRole('textbox', { name: 'Message the agent' })
    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two')
    expect(box).toHaveValue('line one\nline two')
    await user.click(within(panel()).getByRole('button', { name: 'Send' }))
    await within(panel()).findByText('answer 1')
    await user.type(box, 'follow up{Enter}')
    await within(panel()).findByText('answer 2')

    // The server holds the history of a stored chat: the request names it and carries one message.
    const first = chats(state)[0].body as ChatRequest
    expect(first.session_id).toBeUndefined()
    const second = chats(state)[1].body as ChatRequest
    expect(second.messages).toEqual([{ role: 'user', content: 'follow up', display: 'follow up' }])
    expect(second.session_id).toBe(state.chatSessions[0].id)
    expect(state.chatSessions).toHaveLength(1)
    expect(state.chatSessions[0].messages.map((m) => m.content)).toEqual([
      'line one\nline two',
      'answer 1',
      'follow up',
      'answer 2',
    ])
  })

  it('shows an error under the question and lets the user send again', async () => {
    const state = withProviders()
    state.chat = () => ({ status: 502, detail: 'Claude main: auth_failed' })
    const { user } = await renderAppReady()
    const box = await within(panel()).findByRole('textbox', { name: 'Message the agent' })
    await user.type(box, 'hello{Enter}')
    expect(await within(panel()).findByRole('alert')).toHaveTextContent('auth_failed')

    state.chat = () => ({ reply: 'Hi again.' })
    await user.type(box, 'hello again{Enter}')
    expect(await within(panel()).findByText('Hi again.')).toBeInTheDocument()
    // The failed question is not sent again as history.
    const again = chats(state).at(-1)!.body as ChatRequest
    expect(again.messages).toEqual([{ role: 'user', content: 'hello again', display: 'hello again' }])
    // A failed request stores nothing, so the next one starts the chat.
    expect(again.session_id).toBeUndefined()
  })

  it('starts a new chat: the conversation is emptied and the next message is not sent to the old chat', async () => {
    const state = withProviders()
    const { user } = await renderAppReady()
    const input = await within(panel()).findByRole('textbox', { name: 'Message the agent' })
    const newChat = within(panel()).getByRole('button', { name: 'New chat' })
    expect(newChat).toBeDisabled()
    expect(within(panel()).queryByRole('button', { name: 'Clear chat' })).not.toBeInTheDocument()
    await user.type(input, 'hi{Enter}')
    await within(panel()).findByText('ok')
    await user.click(newChat)
    expect(within(panel()).queryByText('ok')).not.toBeInTheDocument()
    expect(newChat).toBeDisabled()
    await waitFor(() => expect(input).toHaveFocus())

    await user.type(input, 'another{Enter}')
    await within(panel()).findByText('ok')
    expect((chats(state).at(-1)!.body as ChatRequest).session_id).toBeUndefined()
    // The earlier chat is kept in the history.
    expect(state.chatSessions.map((s) => s.title)).toEqual(['another', 'hi'])
  })
})

const box = () => within(panel()).getByRole('textbox', { name: 'Message the agent' })
const lastBody = (state: ReturnType<typeof installFakeApi>) => chats(state).at(-1)!.body as ChatRequest
const fileInput = () => panel().querySelector('input[type="file"]') as HTMLInputElement
type User = Awaited<ReturnType<typeof renderAppReady>>['user']
/** Opens the composer's options menu (the plus button). */
async function openOptions(user: User) {
  await user.click(await within(panel()).findByRole('button', { name: 'Message options' }))
  return within(panel()).getByRole('menu', { name: 'Message options' })
}
/** Opens the menu and its Effort choices. */
async function openEffort(user: User) {
  const menu = await openOptions(user)
  await user.click(within(menu).getByRole('menuitem', { name: /Effort/ }))
  return within(menu).getByRole('group', { name: 'Effort' })
}
const mdFile = (name: string, text: string) => new File([text], name, { type: 'text/markdown' })

describe('chat panel layout', () => {
  it('shows the error in its own row under the question with Retry, which sends it again', async () => {
    const state = withProviders()
    state.chat = () => ({ status: 502, detail: 'Claude main: auth_failed' })
    const { user } = await renderAppReady()
    await user.type(await within(panel()).findByRole('textbox', { name: 'Message the agent' }), 'hello{Enter}')
    const alert = await within(panel()).findByRole('alert')
    expect(alert).toHaveTextContent('auth_failed')
    // Not inside the user's bubble: the bubble holds only the question.
    expect(within(panel()).getByText('hello').contains(alert)).toBe(false)
    const row = alert.closest('.agent-error-row') as HTMLElement
    expect(row).not.toBeNull()

    state.chat = () => ({ reply: 'Hi now.' })
    await user.click(within(row).getByRole('button', { name: 'Retry' }))
    expect(await within(panel()).findByText('Hi now.')).toBeInTheDocument()
    expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(panel()).getAllByText('hello')).toHaveLength(1)
    expect(chats(state)).toHaveLength(2)
    expect(lastBody(state).messages).toEqual([{ role: 'user', content: 'hello', display: 'hello' }])
    // The failed question was never stored: its Retry is a plain send.
    expect(lastBody(state).retry_from).toBeUndefined()
  })

  it('retries an answer: the question is sent again and the old answer replaced', async () => {
    const state = withProviders()
    let n = 0
    state.chat = () => ({ reply: `take ${++n}` })
    const { user } = await renderAppReady()
    await user.type(await within(panel()).findByRole('textbox', { name: 'Message the agent' }), 'explain{Enter}')
    await within(panel()).findByText('take 1')
    const question = state.chatSessions[0].messages[0].id
    await user.click(within(panel()).getByRole('button', { name: 'Retry' }))
    expect(await within(panel()).findByText('take 2')).toBeInTheDocument()
    expect(within(panel()).queryByText('take 1')).not.toBeInTheDocument()
    expect(lastBody(state).messages).toEqual([{ role: 'user', content: 'explain', display: 'explain' }])
    // The stored turn is replaced too.
    expect(lastBody(state).session_id).toBe(state.chatSessions[0].id)
    expect(lastBody(state).retry_from).toBe(question)
    expect(state.chatSessions[0].messages.map((m) => m.content)).toEqual(['explain', 'take 2'])
  })

  it('lets the user pick the agent that answers; the header shows it', async () => {
    const state = withProviders()
    state.assignments['lesson-writer'] = { primary: 'p2', fallback: null }
    const { user } = await renderAppReady()
    const menu = await within(panel()).findByRole('button', { name: 'Agent: Learning assistant' })
    expect(menu).toHaveAttribute('aria-haspopup', 'listbox')
    await user.click(menu)
    const list = within(panel()).getByRole('listbox', { name: 'Choose agent' })
    const options = within(list).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Learning assistant'),
      expect.stringContaining('Lesson writer'),
    ])
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    await user.click(within(list).getByRole('option', { name: /Lesson writer/ }))

    expect(within(panel()).queryByRole('listbox', { name: 'Choose agent' })).not.toBeInTheDocument()
    const current = within(panel()).getByRole('button', { name: 'Agent: Lesson writer' })
    expect(current).toHaveTextContent('via Local qwen')

    await user.type(box(), 'draft caching{Enter}')
    await within(panel()).findByText('ok')
    expect(lastBody(state)).toMatchObject({ agent_id: 'lesson-writer' })
    expect(lastBody(state)).not.toHaveProperty('provider_id')
  })

  it('opens the agent menu with the keyboard and closes it with Escape', async () => {
    withProviders()
    const { user } = await renderAppReady()
    const menu = await within(panel()).findByRole('button', { name: 'Agent: Learning assistant' })
    menu.focus()
    await user.keyboard('{Enter}')
    const list = within(panel()).getByRole('listbox', { name: 'Choose agent' })
    expect(within(list).getAllByRole('option')[0]).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(within(list).getAllByRole('option')[1]).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(within(panel()).queryByRole('listbox', { name: 'Choose agent' })).not.toBeInTheDocument()
    expect(menu).toHaveFocus()
    await user.click(menu)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(within(panel()).getByRole('button', { name: 'Agent: Lesson writer' })).toBeInTheDocument()
  })

  it('links to Settings from the header', async () => {
    withProviders()
    await renderAppReady()
    expect(await within(panel()).findByRole('link', { name: 'Agent settings' })).toHaveAttribute('href', '#/settings')
  })

  it('shows a Markdown table as a table and HTML tags as text', async () => {
    const state = withProviders()
    state.chat = () => ({
      reply: '| Policy | Picks |\n|---|---|\n| allkeys-lru | least recent |\n\nUse <b>care</b> here.',
    })
    const { user } = await renderAppReady()
    await user.type(await within(panel()).findByRole('textbox', { name: 'Message the agent' }), 'policies?{Enter}')
    const log = within(panel()).getByRole('log', { name: 'Conversation' })
    const table = await within(log).findByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Policy' })).toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: 'allkeys-lru' })).toBeInTheDocument()
    expect(log.querySelector('b')).toBeNull()
    expect(log).toHaveTextContent('Use <b>care</b> here.')
  })

  it('copies a code block and an answer', async () => {
    const state = withProviders()
    state.chat = () => ({ reply: 'Set it:\n\n```conf\nmaxmemory 512mb\n```' })
    const { user } = await renderAppReady()
    await user.type(await within(panel()).findByRole('textbox', { name: 'Message the agent' }), 'config?{Enter}')
    const log = within(panel()).getByRole('log', { name: 'Conversation' })
    expect(await within(log).findByText('maxmemory 512mb')).toBeInTheDocument()
    expect(within(log).getByText('conf')).toBeInTheDocument()

    await user.click(within(log).getByRole('button', { name: 'Copy' }))
    expect(await navigator.clipboard.readText()).toBe('maxmemory 512mb')
    expect(within(log).getByRole('button', { name: 'Copied' })).toBeInTheDocument()

    await user.click(within(log).getByRole('button', { name: 'Copy answer' }))
    expect(await navigator.clipboard.readText()).toBe('Set it:\n\n```conf\nmaxmemory 512mb\n```')
  })

  it('offers starters in an empty chat that fill the input', async () => {
    withProviders()
    const { user } = await renderAppReady()
    const log = await within(panel()).findByRole('log', { name: 'Conversation' })
    expect(within(log).getByText('What are we learning today?')).toBeInTheDocument()
    const starters = within(log).getAllByRole('button')
    expect(starters).toHaveLength(3)
    await user.click(within(log).getByRole('button', { name: 'What should I learn next?' }))
    expect(box()).toHaveValue('What should I learn next?')
    expect(box()).toHaveFocus()
  })

  it('disables Send until there is text or a file', async () => {
    withProviders()
    const { user } = await renderAppReady()
    const send = await within(panel()).findByRole('button', { name: 'Send' })
    expect(send).toBeDisabled()
    await user.type(box(), '  ')
    expect(send).toBeDisabled()
    await user.type(box(), 'x')
    expect(send).toBeEnabled()
  })
})

describe('skills in the composer', () => {
  it('suggests skills for "/qu" and Enter puts "/quiz " in the input without sending', async () => {
    const state = withProviders()
    const { user } = await renderAppReady()
    await user.type(await within(panel()).findByRole('textbox', { name: 'Message the agent' }), '/qu')
    const list = within(panel()).getByRole('listbox', { name: 'Skills' })
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('/quiz'),
    ])
    expect(within(list).getByRole('option')).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(box()).toHaveValue('/quiz ')
    expect(within(panel()).queryByRole('listbox', { name: 'Skills' })).not.toBeInTheDocument()
    expect(chats(state)).toHaveLength(0)
  })

  it('moves through the skills with the arrow keys and closes with Escape', async () => {
    withProviders()
    const { user } = await renderAppReady()
    await user.type(await within(panel()).findByRole('textbox', { name: 'Message the agent' }), '/')
    const list = within(panel()).getByRole('listbox', { name: 'Skills' })
    const options = () => within(list).getAllByRole('option')
    expect(options().map((o) => o.querySelector('.popover-option-title')?.textContent)).toEqual(SKILLS.map((s) => s.cmd))
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(options()[2]).toHaveAttribute('aria-selected', 'true')
    expect(box()).toHaveAttribute('aria-activedescendant', options()[2].id)
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}')
    expect(options().at(-1)).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Escape}')
    expect(within(panel()).queryByRole('listbox', { name: 'Skills' })).not.toBeInTheDocument()
    expect(box()).toHaveValue('/')
  })

  it('opens all skills from the Skills button and picks one with a click', async () => {
    withProviders()
    const { user } = await renderAppReady()
    const menu = await openOptions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Skills' }))
    expect(within(panel()).queryByRole('menu')).not.toBeInTheDocument()
    const list = within(panel()).getByRole('listbox', { name: 'Skills' })
    expect(within(list).getAllByRole('option')).toHaveLength(SKILLS.length)
    await user.click(within(list).getByRole('option', { name: /\/flashcards/ }))
    expect(box()).toHaveValue('/flashcards ')
    expect(box()).toHaveFocus()
  })

  it('sends a skill message as the instruction plus the text, and shows what the user typed', async () => {
    const state = withProviders()
    const { user } = await renderAppReady()
    await user.type(await within(panel()).findByRole('textbox', { name: 'Message the agent' }), '/quiz JWT{Enter}')
    const log = within(panel()).getByRole('log', { name: 'Conversation' })
    expect(await within(log).findByText('/quiz JWT')).toBeInTheDocument()
    await within(log).findByText('ok')
    const sent = lastBody(state).messages.at(-1)!.content
    const quiz = SKILLS.find((s) => s.cmd === '/quiz')!
    expect(sent.startsWith(quiz.prompt)).toBe(true)
    expect(sent).toContain('JWT')
    expect(within(log).queryByText(quiz.prompt, { exact: false })).not.toBeInTheDocument()
  })
})

describe('effort per message', () => {
  it('sends the chosen effort, remembers it and shows it in the caption', async () => {
    const state = withProviders()
    const { user, unmount } = await renderAppReady()
    // Medium is the default and is not called out in the composer.
    expect(within(panel()).queryByText(/ effort$/)).not.toBeInTheDocument()
    const group = await openEffort(user)
    const choices = within(group).getAllByRole('menuitemradio')
    expect(choices.map((b) => [b.textContent, b.getAttribute('title')])).toEqual([
      ['Low', 'Fast, saves tokens'],
      ['Medium', 'Balanced'],
      ['High', 'Deep reasoning, slower'],
    ])
    expect(within(group).getByRole('menuitemradio', { name: 'Medium' })).toBeChecked()

    await user.click(within(group).getByRole('menuitemradio', { name: 'Low' }))
    // Choosing closes the menu, the focus is back on its button and the composer names the effort.
    expect(within(panel()).queryByRole('menu')).not.toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: 'Message options' })).toHaveFocus()
    expect(within(panel()).getByText('Low effort')).toBeInTheDocument()
    expect(localStorage.getItem('learninghub.effort')).toBe('low')

    await user.type(box(), 'quick one{Enter}')
    const log = within(panel()).getByRole('log', { name: 'Conversation' })
    await within(log).findByText('ok')
    expect(lastBody(state).effort).toBe('low')
    expect(within(log).getByText('Low')).toBeInTheDocument()

    unmount()
    const second = await renderAppReady()
    const again = await openEffort(second.user)
    expect(within(again).getByRole('menuitemradio', { name: 'Low' })).toBeChecked()
    expect(within(again).getByRole('menuitemradio', { name: 'Medium' })).not.toBeChecked()
  })

  it('falls back to Medium when the stored effort is unknown', async () => {
    localStorage.setItem('learninghub.effort', 'extreme')
    withProviders()
    const { user } = await renderAppReady()
    const group = await openEffort(user)
    expect(within(group).getByRole('menuitemradio', { name: 'Medium' })).toBeChecked()
  })
})

describe('composer options menu', () => {
  it('opens with Attach files, Skills and Effort; the composer has no separate controls for them', async () => {
    withProviders()
    const { user } = await renderAppReady()
    const button = await within(panel()).findByRole('button', { name: 'Message options' })
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    for (const name of ['Attach', 'Skills', 'Low', 'Medium', 'High']) {
      expect(within(panel()).queryByRole('button', { name })).not.toBeInTheDocument()
    }
    const menu = await openOptions(user)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Attach files',
      '/Skills',
      'EffortMedium',
    ])
    // Effort lists its three choices in the same menu.
    expect(within(menu).queryByRole('menuitemradio')).not.toBeInTheDocument()
    const effort = within(menu).getByRole('menuitem', { name: /Effort/ })
    await user.click(effort)
    expect(effort).toHaveAttribute('aria-expanded', 'true')
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(3)
  })

  it('works with the keyboard and closes with Escape or a click outside', async () => {
    withProviders()
    const { user } = await renderAppReady()
    const menu = await openOptions(user)
    const items = within(menu).getAllByRole('menuitem')
    expect(items[0]).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(items[1]).toHaveFocus()
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(items[2]).toHaveFocus()
    await user.keyboard('{Enter}{ArrowDown}')
    expect(within(menu).getByRole('menuitemradio', { name: 'Low' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(within(panel()).queryByRole('menu')).not.toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: 'Message options' })).toHaveFocus()

    await openOptions(user)
    await user.click(box())
    expect(within(panel()).queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Attach files in the menu opens the file picker', async () => {
    withProviders()
    const { user } = await renderAppReady()
    const menu = await openOptions(user)
    let picked = 0
    fileInput().addEventListener('click', () => (picked += 1))
    await user.click(within(menu).getByRole('menuitem', { name: 'Attach files' }))
    expect(picked).toBe(1)
    expect(within(panel()).queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('text attachments', () => {
  it('attaches a file, sends its name and text with the message, clears the chip and shows the file', async () => {
    const state = withProviders()
    const { user } = await renderAppReady()
    await within(panel()).findByRole('textbox', { name: 'Message the agent' })
    await user.upload(fileInput(), mdFile('jwt.md', '# JWT\n\nTokens expire.'))
    const chips = await within(panel()).findByRole('list', { name: 'Attachments' })
    expect(within(chips).getByText('jwt.md')).toBeInTheDocument()
    expect(within(chips).getByText('21 B')).toBeInTheDocument()
    expect(within(chips).getByRole('button', { name: 'Remove jwt.md' })).toBeInTheDocument()

    await user.type(box(), 'summarize this{Enter}')
    const log = within(panel()).getByRole('log', { name: 'Conversation' })
    await within(log).findByText('ok')
    expect(lastBody(state)).toMatchObject({
      messages: [{ role: 'user', content: 'summarize this', display: 'summarize this' }],
      attachments: [{ name: 'jwt.md', text: '# JWT\n\nTokens expire.' }],
    })
    expect(within(panel()).queryByRole('list', { name: 'Attachments' })).not.toBeInTheDocument()
    expect(within(within(log).getByRole('list', { name: 'Attached files' })).getByText('jwt.md')).toBeInTheDocument()

    // Later messages do not carry the file again.
    await user.type(box(), 'and more{Enter}')
    await waitFor(() => expect(chats(state)).toHaveLength(2))
    expect(lastBody(state)).not.toHaveProperty('attachments')
  })

  it('sends a message with only a file, and Retry resends the same file', async () => {
    const state = withProviders()
    state.chat = () => ({ status: 502, detail: 'Claude main: unavailable' })
    const { user } = await renderAppReady()
    await within(panel()).findByRole('textbox', { name: 'Message the agent' })
    await user.upload(fileInput(), mdFile('notes.txt', 'plain'))
    const send = within(panel()).getByRole('button', { name: 'Send' })
    await waitFor(() => expect(send).toBeEnabled())
    await user.click(send)
    const alert = await within(panel()).findByRole('alert')
    expect(lastBody(state).attachments).toEqual([{ name: 'notes.txt', text: 'plain' }])

    state.chat = () => ({ reply: 'Read it.' })
    await user.click(within(alert.closest('.agent-error-row') as HTMLElement).getByRole('button', { name: 'Retry' }))
    await within(panel()).findByText('Read it.')
    expect(lastBody(state).attachments).toEqual([{ name: 'notes.txt', text: 'plain' }])
  })

  it('shows a dropped unsupported file as an error chip and sends nothing for it', async () => {
    const state = withProviders()
    const { user } = await renderAppReady()
    const input = await within(panel()).findByRole('textbox', { name: 'Message the agent' })
    const pdf = new File(['%PDF'], 'diagram.pdf', { type: 'application/pdf' })

    fireEvent.dragEnter(input, { dataTransfer: { types: ['Files'], files: [] } })
    expect(within(panel()).getByText('Drop to attach')).toBeInTheDocument()
    fireEvent.drop(input, { dataTransfer: { types: ['Files'], files: [pdf] } })
    expect(within(panel()).queryByText('Drop to attach')).not.toBeInTheDocument()

    const chips = await within(panel()).findByRole('list', { name: 'Attachments' })
    expect(within(chips).getByText('diagram.pdf')).toBeInTheDocument()
    expect(within(chips).getByText(/File type not supported/)).toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: 'Send' })).toBeDisabled()

    await user.type(input, 'hi{Enter}')
    await waitFor(() => expect(chats(state)).toHaveLength(1))
    expect(lastBody(state)).not.toHaveProperty('attachments')
  })

  it('refuses a sixth file and a file over 100 KB, and removes a chip', async () => {
    const state = withProviders()
    const { user } = await renderAppReady()
    await within(panel()).findByRole('textbox', { name: 'Message the agent' })
    const six = Array.from({ length: 6 }, (_, i) => mdFile(`n${i + 1}.md`, `note ${i + 1}`))
    await user.upload(fileInput(), six)
    const chips = await within(panel()).findByRole('list', { name: 'Attachments' })
    await waitFor(() => expect(within(chips).getAllByRole('listitem')).toHaveLength(6))
    const sixth = within(chips).getByText('n6.md').closest('li') as HTMLElement
    expect(sixth).toHaveTextContent('Only 5 files per message.')

    await user.click(within(chips).getByRole('button', { name: 'Remove n1.md' }))
    expect(within(chips).queryByText('n1.md')).not.toBeInTheDocument()

    await user.upload(fileInput(), mdFile('big.md', 'a'.repeat(100_001)))
    const big = (await within(chips).findByText('big.md')).closest('li') as HTMLElement
    expect(big).toHaveTextContent('Larger than 100 KB.')

    await user.type(box(), 'go{Enter}')
    await waitFor(() => expect(chats(state)).toHaveLength(1))
    expect(lastBody(state).attachments?.map((a) => a.name)).toEqual(['n2.md', 'n3.md', 'n4.md', 'n5.md'])
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
    const { user } = await renderAppReady('#/lesson/backend/caching')
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
    await renderAppReady('#/lesson/backend/apis')
    const lesson = await screen.findByRole('article', { name: 'Lesson: APIs' })
    await within(lesson).findByText(/No lesson yet/)
    await within(panel()).findByRole('status')
    expect(within(lesson).queryByRole('button', { name: 'Draft with agent' })).not.toBeInTheDocument()
  })
})
