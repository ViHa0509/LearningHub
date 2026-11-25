/** Spec: agent-settings - Tools page under Agents; Add and remove an agent's tools. */
import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseRoute, routeHash } from '../lib/route'
import { installFakeApi } from '../test/fakeApi'
import { renderAppReady } from '../test/render'

const card = async (name: string) => within(await screen.findByRole('article', { name }))
afterEach(() => vi.restoreAllMocks())

describe('Settings > Agents > Tools', () => {
  // Scenario: Open the Tools page
  it('is a child of Agents in the nav and shows the four agent cards with their tools', async () => {
    installFakeApi()
    expect(parseRoute('#/settings/agents/tools')).toEqual({ page: 'agent-tools-settings' })
    expect(routeHash({ page: 'agent-tools-settings' })).toBe('#/settings/agents/tools')
    const { user } = await renderAppReady('#/settings/agents')
    const nav = within(screen.getByRole('navigation', { name: 'Settings sections' }))
    await user.click(nav.getByRole('link', { name: 'Tools' }))
    expect(nav.getByRole('link', { name: 'Tools' })).toHaveAttribute('aria-current', 'page')
    expect(nav.getByRole('link', { name: 'Agents' })).not.toHaveAttribute('aria-current')
    for (const name of ['Learning assistant', 'Lesson writer', 'Topic outline', 'Interactive tutor']) {
      expect(await screen.findByRole('article', { name })).toBeInTheDocument()
    }
    const assistant = await card('Learning assistant')
    expect(assistant.getByText('write_lesson')).toBeInTheDocument()
    expect(assistant.getByText('Write or update the lesson of a topic.')).toBeInTheDocument()
    expect(assistant.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  // Scenario: Remove and save
  it('removes a tool, saves it, and offers it in the dropdown', async () => {
    const state = installFakeApi()
    const { user } = await renderAppReady('#/settings/agents/tools')
    const assistant = await card('Learning assistant')
    await user.click(await assistant.findByRole('button', { name: 'Remove write_lesson from Learning assistant' }))
    expect(assistant.queryByText('write_lesson', { selector: 'code' })).toBeNull()
    expect(assistant.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(state.removedTools.assistant).toBeUndefined()
    await user.click(assistant.getByRole('button', { name: 'Save' }))
    expect(state.removedTools.assistant).toEqual(['write_lesson'])
    expect(await assistant.findByRole('option', { name: 'write_lesson' })).toBeInTheDocument()
    expect(assistant.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  // Scenario: Add back
  it('adds a removed tool back from the dropdown and saves it', async () => {
    const state = installFakeApi()
    state.removedTools.assistant = ['write_lesson']
    const { user } = await renderAppReady('#/settings/agents/tools')
    const assistant = await card('Learning assistant')
    await user.selectOptions(await assistant.findByLabelText('Add tool'), 'write_lesson')
    await user.click(assistant.getByRole('button', { name: 'Add' }))
    await user.click(assistant.getByRole('button', { name: 'Save' }))
    expect(state.removedTools.assistant).toEqual([])
    expect(await assistant.findByRole('button', { name: 'Remove write_lesson from Learning assistant' })).toBeInTheDocument()
  })

  // Scenario: Only the agent's own tools
  it("never offers another agent's tools in the dropdown", async () => {
    const state = installFakeApi()
    state.removedTools['lesson-writer'] = ['write_lesson']
    await renderAppReady('#/settings/agents/tools')
    const writer = await card('Lesson writer')
    const select = await writer.findByLabelText('Add tool')
    const options = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['write_lesson'])
  })

  it('shows a refusal on the card and keeps the draft', async () => {
    installFakeApi()
    const { user } = await renderAppReady('#/settings/agents/tools')
    const writer = await card('Lesson writer')
    await user.click(await writer.findByRole('button', { name: 'Remove read_note from Lesson writer' }))
    const real = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      init?.method === 'PUT'
        ? Promise.resolve(new Response(JSON.stringify({ detail: 'not a tool of this agent' }), { status: 422 }))
        : real(input, init),
    )
    await user.click(writer.getByRole('button', { name: 'Save' }))
    expect(await writer.findByRole('alert')).toBeInTheDocument()
    expect(writer.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  // Scenario: Cancel
  it('Cancel restores the saved list and stores nothing', async () => {
    const state = installFakeApi()
    const { user } = await renderAppReady('#/settings/agents/tools')
    const assistant = await card('Learning assistant')
    await user.click(await assistant.findByRole('button', { name: 'Remove write_lesson from Learning assistant' }))
    await user.click(assistant.getByRole('button', { name: 'Cancel' }))
    expect(assistant.getByRole('button', { name: 'Remove write_lesson from Learning assistant' })).toBeInTheDocument()
    expect(assistant.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(state.calls.some((c) => c.method === 'PUT' && c.url.endsWith('/tools'))).toBe(false)
  })

  it('says an agent without tools answers from the conversation only', async () => {
    installFakeApi()
    const { user } = await renderAppReady('#/settings/agents/tools')
    const tutor = await card('Interactive tutor')
    for (const n of ['search_notes', 'read_note', 'list_roadmap', 'read_lesson']) {
      await user.click(await tutor.findByRole('button', { name: `Remove ${n} from Interactive tutor` }))
    }
    expect(tutor.getByText('No tools: this agent answers from the conversation only.')).toBeInTheDocument()
  })
})
