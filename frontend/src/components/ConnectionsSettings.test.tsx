/** Spec: agent-settings - Connections page under Agents. */
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
