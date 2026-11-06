/** Spec: learning-views - Three-pane layout, two-way selection, empty state, theme, addresses. */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFakeApi, makeNote } from './test/fakeApi'
import { renderApp } from './test/render'

/** The address the browser back button would restore, as a hash change. */
function goBackTo(hash: string) {
  return act(async () => {
    window.history.replaceState(null, '', hash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

describe('three-pane layout', () => {
  it('shows the top bar, list, home page and agent panel', async () => {
    installFakeApi([makeNote('Redis eviction', 'backend/caching')])
    renderApp()
    expect(await screen.findByRole('complementary', { name: 'Learned items' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Learning Hub' })).toHaveAttribute('href', '#/')
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument()
    const main = screen.getByRole('main', { name: 'Content' })
    expect(await within(main).findByRole('region', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Agent' })).toBeInTheDocument()
  })

  it('collapses and expands the left panel', async () => {
    installFakeApi([makeNote('Redis eviction', 'backend/caching')])
    const { user, container } = renderApp()
    await screen.findByRole('button', { name: 'Redis eviction' })
    const shell = container.querySelector('.app-shell') as HTMLElement
    const before = shell.style.gridTemplateColumns

    await user.click(screen.getByRole('button', { name: 'Collapse learned list' }))
    expect(screen.queryByRole('button', { name: 'Redis eviction' })).not.toBeInTheDocument()
    expect(shell.style.gridTemplateColumns).not.toBe(before)
    expect(shell.style.gridTemplateColumns.startsWith('44px')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Expand learned list' }))
    expect(await screen.findByRole('button', { name: 'Redis eviction' })).toBeInTheDocument()
    expect(shell.style.gridTemplateColumns).toBe(before)
  })

  it('collapses the agent panel', async () => {
    installFakeApi()
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: 'Collapse agent panel' }))
    expect(screen.getByRole('button', { name: 'Expand agent panel' })).toBeInTheDocument()
  })
})

describe('empty state', () => {
  it('explains how to import the first file', async () => {
    installFakeApi([])
    renderApp()
    expect(await screen.findByText('Nothing learned yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import HTML files' })).toBeInTheDocument()
  })
})

describe('two-way selection', () => {
  it('opening a note from the list selects its node on the map', async () => {
    installFakeApi([makeNote('GitHub Actions basics', 'devops/ci-cd')])
    const { user } = renderApp()

    await user.click(await screen.findByRole('button', { name: 'GitHub Actions basics' }))
    const article = await screen.findByRole('article', { name: 'Note: GitHub Actions basics' })
    await user.click(within(article).getByRole('button', { name: '← Back' }))

    const node = await screen.findByTestId('node-devops/ci-cd')
    expect(window.location.hash).toBe('#/roadmap/devops')
    expect(node).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'DevOps' })).toHaveAttribute('aria-selected', 'true')
  })

  it('clicking a node opens its lesson and highlights its notes in the list', async () => {
    installFakeApi([
      makeNote('Redis eviction', 'backend/caching'),
      makeNote('HTTP caching', 'backend/caching'),
      makeNote('JWT', 'backend/auth'),
    ])
    renderApp('#/roadmap/backend')
    fireEvent.click(await screen.findByTestId('node-backend/caching'))

    expect(await screen.findByRole('article', { name: 'Lesson: Caching' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/lesson/backend/caching')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Redis eviction' })).toHaveAttribute('aria-pressed', 'true'),
    )
    expect(screen.getByRole('button', { name: 'HTTP caching' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'JWT' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('addressable pages', () => {
  it('opens a page by address', async () => {
    installFakeApi()
    renderApp('#/lesson/backend/caching')
    expect(await screen.findByRole('article', { name: 'Lesson: Caching' })).toBeInTheDocument()
  })

  it('shows the previous page when the address goes back', async () => {
    installFakeApi()
    const { user } = renderApp()
    await user.click(await screen.findByRole('link', { name: /^Backend/ }))
    fireEvent.click(await screen.findByTestId('node-backend/caching'))
    await screen.findByRole('article', { name: 'Lesson: Caching' })

    await goBackTo('#/roadmap/backend')
    expect(await screen.findByTestId('node-backend/caching')).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Lesson: Caching' })).not.toBeInTheDocument()
  })

  it('returns home from the app title', async () => {
    installFakeApi()
    const { user } = renderApp('#/roadmap/backend')
    await screen.findByTestId('node-backend/caching')
    await user.click(screen.getByRole('link', { name: 'Learning Hub' }))
    expect(await screen.findByRole('region', { name: 'Home' })).toBeInTheDocument()
  })

  it('treats an unknown address as home', async () => {
    installFakeApi()
    renderApp('#/nowhere/%3Cscript%3E')
    expect(await screen.findByRole('region', { name: 'Home' })).toBeInTheDocument()
  })
})

describe('theme', () => {
  it('switches to dark at once and keeps it after a reload', async () => {
    installFakeApi()
    const { user, unmount } = renderApp()
    await user.click(await screen.findByRole('radio', { name: 'Dark' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')

    unmount()
    document.documentElement.removeAttribute('data-theme')
    installFakeApi()
    renderApp()
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'))
    expect(await screen.findByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
  })

  it('goes back to following the system', async () => {
    installFakeApi()
    const { user } = renderApp()
    await user.click(await screen.findByRole('radio', { name: 'Light' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    await user.click(screen.getByRole('radio', { name: 'System' }))
    expect(document.documentElement).not.toHaveAttribute('data-theme')
    expect(localStorage.getItem('learninghub.theme')).toBeNull()
  })
})
