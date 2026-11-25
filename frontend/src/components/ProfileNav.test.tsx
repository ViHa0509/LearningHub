/**
 * Spec: settings - Left-column navigation, Profile page.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { parseRoute, routeHash, type Route } from '../lib/route'
import { ProfileNav } from './ProfileNav'
import { SettingsNav } from './SettingsNav'
import { installFakeApi, makeNote, OWNER, requireLogin } from '../test/fakeApi'
import { renderAppReady } from '../test/render'

describe('profile routes', () => {
  it('parses and formats the Profile addresses', () => {
    expect(parseRoute('#/profile')).toEqual({ page: 'profile', section: 'general' })
    expect(parseRoute('#/profile/security')).toEqual({ page: 'profile', section: 'security' })
    expect(parseRoute('#/profile/preferences')).toEqual({ page: 'profile', section: 'preferences' })
    expect(parseRoute('#/profile/other')).toEqual({ page: 'home' })
    expect(routeHash({ page: 'profile', section: 'general' })).toBe('#/profile')
    expect(routeHash({ page: 'profile', section: 'security' })).toBe('#/profile/security')
  })

  it('opens Profile from the old account address', () => {
    expect(parseRoute('#/settings/account')).toEqual({ page: 'profile', section: 'general' })
  })
})

describe('left column', () => {
  const names = (nav: HTMLElement) => within(nav).getAllByRole('link').map((a) => a.textContent)

  // Scenario: Settings sections in the left column
  it('lists every Settings section for the admin, marks the current one, and hides the Learned list', async () => {
    installFakeApi([makeNote('Redis eviction', 'backend/caching')])
    await renderAppReady('#/settings/agents')
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' })
    expect(names(nav)).toEqual(['AI providers', 'Agents', 'Tools', 'Connections', 'Users', 'Sign-in', 'Data & sync'])
    expect(within(nav).getByRole('link', { name: 'Agents' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('complementary', { name: 'Learned items' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Redis eviction' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  // Scenario: Member sees fewer sections
  it('lists fewer sections for a member', async () => {
    const state = installFakeApi()
    requireLogin(state, { signedIn: true, owner: { ...OWNER, role: 'member' } })
    await renderAppReady('#/settings')
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' })
    expect(names(nav)).toEqual(['AI providers', 'Agents', 'Tools', 'Connections', 'Data & sync'])
  })

  // Scenario: Open Profile
  it('lists the Profile sections on Profile and marks the current one', async () => {
    installFakeApi()
    await renderAppReady('#/profile/security')
    const nav = await screen.findByRole('navigation', { name: 'Profile sections' })
    expect(names(nav)).toEqual(['General', 'Security', 'Preferences'])
    expect(within(nav).getByRole('link', { name: 'Security' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('complementary', { name: 'Learned items' })).not.toBeInTheDocument()
  })

  // Scenario: opens in the same drawer as the Learned list (a pick closes it on narrow screens)
  it('calls its close callback when a section link is clicked', async () => {
    installFakeApi()
    const onPick = vi.fn()
    render(<ProfileNav route={{ page: 'profile', section: 'general' }} onPick={onPick} />)
    await userEvent.click(screen.getByRole('link', { name: 'Security' }))
    expect(onPick).toHaveBeenCalledTimes(1)
    cleanup()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SettingsNav route={{ page: 'settings' } as Route} onPick={onPick} />
      </QueryClientProvider>,
    )
    await userEvent.click(await screen.findByRole('link', { name: 'Agents' }))
    expect(onPick).toHaveBeenCalledTimes(2)
  })

  // Scenario: Back to the Learned list
  it('shows the Learned list on the home route', async () => {
    installFakeApi([makeNote('Redis eviction', 'backend/caching')])
    await renderAppReady('#/')
    expect(await screen.findByRole('button', { name: 'Redis eviction' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).not.toBeInTheDocument()
  })
})
