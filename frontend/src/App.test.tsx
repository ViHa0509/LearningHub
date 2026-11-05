/** Spec: learning-views - Three-pane layout, two-way selection, empty state. */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFakeApi, makeNote } from './test/fakeApi'
import { renderApp } from './test/render'

describe('three-pane layout', () => {
  it('shows list, map and the reserved agent panel', async () => {
    installFakeApi([makeNote('Redis eviction', 'backend/caching')])
    renderApp()
    expect(await screen.findByRole('complementary', { name: 'Learned items' })).toBeInTheDocument()
    expect(screen.getByRole('main', { name: 'Roadmap' })).toBeInTheDocument()
    const agent = screen.getByRole('complementary', { name: 'Agent' })
    expect(within(agent).getByText('The agent is not available yet.')).toBeInTheDocument()
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
    expect(screen.queryByText('The agent is not available yet.')).not.toBeInTheDocument()
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
  it('selecting a note shows its domain on the map and highlights its node', async () => {
    installFakeApi([makeNote('GitHub Actions basics', 'devops/ci-cd')])
    const { user } = renderApp()
    expect(await screen.findByTestId('node-backend/caching')).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'GitHub Actions basics' }))

    const node = await screen.findByTestId('node-devops/ci-cd')
    expect(node).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'DevOps' })).toHaveAttribute('aria-selected', 'true')
  })

  it('selecting a node highlights its notes in the list', async () => {
    installFakeApi([
      makeNote('Redis eviction', 'backend/caching'),
      makeNote('HTTP caching', 'backend/caching'),
      makeNote('JWT', 'backend/auth'),
    ])
    renderApp()
    fireEvent.click(await screen.findByTestId('node-backend/caching'))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Redis eviction' })).toHaveAttribute('aria-pressed', 'true'),
    )
    expect(screen.getByRole('button', { name: 'HTTP caching' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'JWT' })).toHaveAttribute('aria-pressed', 'false')
  })
})
