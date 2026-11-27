/** Spec: agent-settings - Connections page under Agents. */
import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { parseRoute, routeHash } from '../lib/route'
import { installFakeApi } from '../test/fakeApi'
import { renderAppReady } from '../test/render'

describe('Settings > Agents > Connections', () => {
  // Scenario: Knowledge Hub on Connections
  it('is a nav child after Tools with the Knowledge Hub card, which the Agents page no longer has', async () => {
    installFakeApi()
    expect(parseRoute('#/settings/agents/connections')).toEqual({ page: 'connections-settings' })
    expect(routeHash({ page: 'connections-settings' })).toBe('#/settings/agents/connections')
    const { user } = await renderAppReady('#/settings/agents')
    expect(screen.queryByRole('article', { name: 'Knowledge Hub' })).toBeNull()
    const nav = within(screen.getByRole('navigation', { name: 'Settings sections' }))
    const links = nav.getAllByRole('link').map((l) => l.textContent)
    expect(links.indexOf('Connections')).toBe(links.indexOf('Tools') + 1)
    await user.click(nav.getByRole('link', { name: 'Connections' }))
    expect(nav.getByRole('link', { name: 'Connections' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('article', { name: 'Knowledge Hub' })).toBeInTheDocument()
  })
})

/** Spec: roadmap-explorer - An optional GitHub token per user. */
describe('GitHub card', () => {
  const open = async () => {
    const state = installFakeApi()
    const { user } = await renderAppReady('#/settings/agents/connections')
    const card = within(await screen.findByRole('article', { name: 'GitHub' }))
    return { state, user, card, field: await card.findByLabelText('GitHub token') }
  }
  const calls = (state: ReturnType<typeof installFakeApi>, method: string) =>
    state.calls.filter((c) => c.url === '/api/github' && c.method === method)

  // Scenario: Save a token
  it('saves a typed token and shows only its last 4 characters', async () => {
    const { state, user, card, field } = await open()
    expect(field).toHaveAttribute('type', 'password')
    await user.type(field, 'ghp_abcdefghij1234567890wxyz')
    await user.click(card.getByRole('button', { name: 'Save' }))
    expect(await card.findByText('Token saved (…wxyz)')).toBeInTheDocument()
    expect(card.queryByLabelText('GitHub token')).toBeNull()
    expect(calls(state, 'PUT')).toHaveLength(1)
    expect(screen.queryByText(/ghp_abcdefghij/)).toBeNull()
  })

  // Scenario: Token refused
  it('shows the refusal and keeps the typed text', async () => {
    const { state, user, card, field } = await open()
    state.github.refuse = { status: 400, detail: 'GitHub refused this token' }
    await user.type(field, 'bad_token_value_1234567')
    await user.click(card.getByRole('button', { name: 'Save' }))
    expect(await card.findByRole('alert')).toHaveTextContent('GitHub refused this token')
    expect(card.getByLabelText('GitHub token')).toHaveValue('bad_token_value_1234567')
    expect(state.github.saved).toBe(false)
  })

  it('Save is disabled until something is typed, and Cancel clears the field', async () => {
    const { user, card, field } = await open()
    expect(card.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.type(field, 'abc')
    expect(card.getByRole('button', { name: 'Save' })).toBeEnabled()
    await user.click(card.getByRole('button', { name: 'Cancel' }))
    expect(card.getByLabelText('GitHub token')).toHaveValue('')
    expect(card.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  // Scenario: Remove is confirmed first
  it('keeps the token when Remove is declined and deletes it when confirmed', async () => {
    const { state, user, card, field } = await open()
    await user.type(field, 'ghp_abcdefghij1234567890wxyz')
    await user.click(card.getByRole('button', { name: 'Save' }))
    await card.findByText('Token saved (…wxyz)')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await user.click(card.getByRole('button', { name: 'Remove' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(calls(state, 'DELETE')).toHaveLength(0)
    expect(card.getByText('Token saved (…wxyz)')).toBeInTheDocument()
    confirm.mockReturnValue(true)
    await user.click(card.getByRole('button', { name: 'Remove' }))
    expect(await card.findByLabelText('GitHub token')).toHaveValue('')
    expect(calls(state, 'DELETE')).toHaveLength(1)
    confirm.mockRestore()
  })
})
