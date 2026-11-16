/**
 * Spec: responsive-layout - Screen classes, Side panels as drawers on a phone, One side panel at a time on a tablet.
 * Spec: learning-views - Loading indicator while the app starts.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import indexHtml from '../../index.html?raw'
import { installFakeApi, makeNote, requireLogin, twoProviders } from '../test/fakeApi'
import { renderApp, renderAppReady } from '../test/render'
import { resetScreenClass, setScreenClass } from '../test/screenClass'

afterEach(() => {
  resetScreenClass()
})

function setup() {
  const state = installFakeApi([makeNote('Redis eviction', 'backend/caching')])
  state.providers = twoProviders()
  return state
}

const listToggle = (name: string) => screen.queryByRole('button', { name })
const message = () => screen.getByRole('textbox', { name: 'Message the agent', hidden: true }) as HTMLTextAreaElement
const dialog = (name: string) => screen.queryByRole('dialog', { name })

describe('panels per screen class', () => {
  it('desktop: both panels open and collapsible on their own', async () => {
    setup()
    setScreenClass('desktop')
    const { user, container } = await renderAppReady()
    await screen.findByRole('button', { name: 'Redis eviction' })
    expect(screen.getByRole('complementary', { name: 'Learned items' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Agent' })).toBeInTheDocument()
    expect(listToggle('Collapse learned list')).toBeInTheDocument()
    expect(listToggle('Collapse agent panel')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(container.querySelector('.app-shell')).toHaveStyle({ gridTemplateColumns: 'minmax(240px, 22%) 1fr minmax(300px, 30%)' })

    await user.click(screen.getByRole('button', { name: 'Collapse learned list' }))
    expect(listToggle('Collapse agent panel')).toBeInTheDocument()
    expect(listToggle('Expand learned list')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Collapse agent panel' }))
    expect(listToggle('Expand agent panel')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Expand learned list' }))
    await user.click(screen.getByRole('button', { name: 'Expand agent panel' }))
    expect(listToggle('Collapse learned list')).toBeInTheDocument()
    expect(listToggle('Collapse agent panel')).toBeInTheDocument()
  })

  it('tablet: the list starts open and the chat collapsed; opening one collapses the other', async () => {
    setup()
    setScreenClass('tablet')
    const { user } = await renderAppReady()
    expect(await screen.findByRole('button', { name: 'Redis eviction' })).toBeInTheDocument()
    expect(listToggle('Collapse learned list')).toBeInTheDocument()
    expect(listToggle('Expand agent panel')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand agent panel' }))
    expect(listToggle('Collapse agent panel')).toBeInTheDocument()
    expect(listToggle('Expand learned list')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Redis eviction' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand learned list' }))
    expect(listToggle('Collapse learned list')).toBeInTheDocument()
    expect(listToggle('Expand agent panel')).toBeInTheDocument()
  })

  it('phone: one column, no rails, both drawers closed', async () => {
    setup()
    setScreenClass('phone')
    const { container } = await renderAppReady()
    expect(await screen.findByRole('region', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(container.querySelector('.app-shell')).toHaveStyle({ gridTemplateColumns: '1fr' })
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(dialog('Learned')).not.toBeInTheDocument()
    expect(dialog('Agent')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Expand|Collapse/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Learned' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Agent' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Learned' })).toHaveAttribute('aria-controls', 'learned-panel')
    expect(screen.getByRole('button', { name: 'Agent' })).toHaveAttribute('aria-controls', 'agent-panel')
  })

  it('resets the panels when the class changes and keeps the typed chat text', async () => {
    setup()
    setScreenClass('desktop')
    const { user } = await renderAppReady('#/roadmap/backend')
    await user.type(await screen.findByRole('textbox', { name: 'Message the agent' }), 'what about redis?')

    act(() => setScreenClass('tablet'))
    expect(listToggle('Collapse learned list')).toBeInTheDocument()
    expect(listToggle('Expand agent panel')).toBeInTheDocument()
    expect(message().value).toBe('what about redis?')
    expect(window.location.hash).toBe('#/roadmap/backend')

    act(() => setScreenClass('phone'))
    expect(dialog('Agent')).not.toBeInTheDocument()
    expect(message().value).toBe('what about redis?')
    await user.click(screen.getByRole('button', { name: 'Agent' }))
    expect(within(screen.getByRole('dialog', { name: 'Agent' })).getByRole('textbox', { name: 'Message the agent' })).toHaveValue(
      'what about redis?',
    )

    act(() => setScreenClass('desktop'))
    expect(listToggle('Collapse agent panel')).toBeInTheDocument()
    expect(listToggle('Collapse learned list')).toBeInTheDocument()
    expect(message().value).toBe('what about redis?')
  })

  it('keeps the typed text across closing and opening the chat on a tablet', async () => {
    setup()
    setScreenClass('tablet')
    const { user } = await renderAppReady()
    await user.click(await screen.findByRole('button', { name: 'Expand agent panel' }))
    await user.type(screen.getByRole('textbox', { name: 'Message the agent' }), 'draft')
    await user.click(screen.getByRole('button', { name: 'Expand learned list' }))
    expect(message().value).toBe('draft')
    await user.click(screen.getByRole('button', { name: 'Expand agent panel' }))
    expect(screen.getByRole('textbox', { name: 'Message the agent' })).toHaveValue('draft')
  })
})

describe('side panels as drawers on a phone', () => {
  it('open a note from the list: the drawer closes and the note shows', async () => {
    setup()
    setScreenClass('phone')
    const { user } = await renderAppReady()
    await user.click(await screen.findByRole('button', { name: 'Learned' }))
    const drawer = screen.getByRole('dialog', { name: 'Learned' })
    expect(drawer).toHaveAttribute('aria-modal', 'true')
    await user.click(await within(drawer).findByRole('button', { name: 'Redis eviction' }))

    expect(await screen.findByRole('article', { name: 'Note: Redis eviction' })).toBeInTheDocument()
    expect(dialog('Learned')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Learned' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('asking from the agent button closes the list drawer and opens the agent drawer', async () => {
    setup()
    setScreenClass('phone')
    const { user } = await renderAppReady()
    await user.click(await screen.findByRole('button', { name: 'Learned' }))
    expect(screen.getByRole('dialog', { name: 'Learned' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Agent' }))
    expect(dialog('Learned')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Agent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agent' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Learned' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('Escape closes the drawer, returns focus to its top-bar button and keeps the typed text', async () => {
    setup()
    setScreenClass('phone')
    const { user } = await renderAppReady()
    await user.click(await screen.findByRole('button', { name: 'Agent' }))
    await user.type(within(screen.getByRole('dialog', { name: 'Agent' })).getByRole('textbox', { name: 'Message the agent' }), 'my question')

    await user.keyboard('{Escape}')
    expect(dialog('Agent')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agent' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Agent' }))
    expect(screen.getByRole('textbox', { name: 'Message the agent' })).toHaveValue('my question')
  })

  it('moves focus to the close button on open, and a click on the scrim closes the drawer', async () => {
    setup()
    setScreenClass('phone')
    const { user, container } = await renderAppReady()
    await user.click(await screen.findByRole('button', { name: 'Learned' }))
    expect(screen.getByRole('button', { name: 'Close learned list' })).toHaveFocus()
    expect(container.querySelector('.app-shell')).toHaveAttribute('data-drawer-open', 'true')

    await user.click(container.querySelector('.drawer-scrim') as HTMLElement)
    expect(dialog('Learned')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Learned' })).toHaveFocus()
    expect(container.querySelector('.app-shell')).toHaveAttribute('data-drawer-open', 'false')
  })

  it('the close button closes the drawer', async () => {
    setup()
    setScreenClass('phone')
    const { user } = await renderAppReady()
    await user.click(await screen.findByRole('button', { name: 'Agent' }))
    expect(screen.getByRole('button', { name: 'Close agent' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Close agent' }))
    expect(dialog('Agent')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agent' })).toHaveFocus()
  })

  it('keeps Tab inside the open drawer', async () => {
    setup()
    setScreenClass('phone')
    const { user } = await renderAppReady()
    await user.click(await screen.findByRole('button', { name: 'Agent' }))
    const drawer = screen.getByRole('dialog', { name: 'Agent' })
    await user.tab({ shift: true })
    expect(drawer).toContainElement(document.activeElement as HTMLElement)
    for (let i = 0; i < 12; i++) {
      await user.tab()
      expect(drawer).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it('tablet and desktop panels keep the aside role (no drawer)', async () => {
    setup()
    setScreenClass('tablet')
    await renderAppReady()
    expect(await screen.findByRole('complementary', { name: 'Learned items' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Learned' })).not.toBeInTheDocument()
  })
})

describe('loading indicator while the app starts', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Holds `GET /api/auth/status` (and `/api/auth/me` when asked) until `release()`; the rest is the fake API. */
  function holdAuth(options: { me?: boolean; healthDown?: boolean } = {}) {
    const inner = globalThis.fetch
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (options.healthDown && url === '/api/health') {
        return Promise.resolve(new Response(JSON.stringify({ status: 'unavailable', reason: 'database' }), { status: 503 }))
      }
      if (url === (options.me ? '/api/auth/me' : '/api/auth/status')) return gate.then(() => inner(input, init))
      return inner(input, init)
    })
    return release
  }

  const indicator = () => screen.queryByRole('status')

  it('Before the app code has loaded: the delivered page holds the status element with Loading…', () => {
    const root = new DOMParser().parseFromString(indexHtml, 'text/html').querySelector('#root')
    const status = root?.querySelector('[role="status"]')
    expect(status).not.toBeNull()
    expect(status?.textContent).toBe('Loading…')
    expect(indexHtml).not.toMatch(/<script(?![^>]* src=)/)
    expect(indexHtml).not.toMatch(/\sstyle=/)
  })

  it('While the session is being checked: the indicator shows until the status answers, then the page replaces it', async () => {
    installFakeApi()
    const release = holdAuth()
    renderApp()
    expect(indicator()).toHaveTextContent('Loading…')
    expect(screen.getByRole('main', { busy: true })).toContainElement(indicator())
    expect(screen.queryByRole('complementary', { name: 'Learned items' })).not.toBeInTheDocument()
    release()
    expect(await screen.findByRole('complementary', { name: 'Learned items' })).toBeInTheDocument()
  })

  it('While the session is being checked: also while the session answer is slow', async () => {
    const state = installFakeApi()
    requireLogin(state, { signedIn: true })
    const release = holdAuth({ me: true })
    renderApp()
    await waitFor(() => expect(state.calls.some((c) => c.url === '/api/auth/status')).toBe(true))
    expect(indicator()).toHaveTextContent('Loading…')
    release()
    expect(await screen.findByRole('complementary', { name: 'Learned items' })).toBeInTheDocument()
    expect(document.querySelector('.app-loading')).not.toBeInTheDocument()
  })

  it('Gone once the app shows: the user content and the sign-in page carry no start indicator', async () => {
    installFakeApi()
    await renderAppReady()
    await screen.findByRole('complementary', { name: 'Learned items' })
    expect(document.querySelector('.app-loading')).not.toBeInTheDocument()
  })

  it('Gone once the app shows: the sign-in page', async () => {
    const state = installFakeApi()
    requireLogin(state, { signedIn: false })
    renderApp()
    await screen.findByRole('main', { name: 'Log in' })
    expect(document.querySelector('.app-loading')).not.toBeInTheDocument()
  })

  it('Service unavailable wins: the outage page shows, not the indicator, while the status is pending', async () => {
    installFakeApi()
    holdAuth({ healthDown: true })
    renderApp()
    expect(await screen.findByRole('main', { name: 'Service unavailable' })).toBeInTheDocument()
    expect(document.querySelector('.app-loading')).not.toBeInTheDocument()
  })
})
