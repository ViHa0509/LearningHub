/** Spec: node-resources - References on the lesson page. All links are synthetic test data. */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ChatRequest } from '../api'
import { installFakeApi, makeResource, twoProviders } from '../test/fakeApi'
import { renderApp } from '../test/render'

const openLesson = (title: string) => screen.findByRole('article', { name: `Lesson: ${title}` })
const references = async (title: string) =>
  within(await openLesson(title)).findByRole('region', { name: 'References' })
// The sync status is read every 1.5 s while running.
const POLL_WAIT = { timeout: 4000 }

describe('references on the lesson page', () => {
  // Scenario: Grouped links
  it('groups links by type in API order, opens them in a new tab and names the source', async () => {
    const state = installFakeApi()
    state.resources['frontend/basics'] = [
      makeResource('Synthetic spec page', 'official', 'https://www.example.test/spec'),
      makeResource('Synthetic article one', 'article', 'https://blog.example.test/one'),
      makeResource('Synthetic article two', 'article'),
      makeResource('Synthetic cheat sheet', 'cheatsheet'),
    ]
    renderApp('#/lesson/frontend/basics')
    const region = await references('Basics')

    await within(region).findByRole('link', { name: /Synthetic spec page/ })
    expect(within(region).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Official',
      'Articles',
      'cheatsheet',
    ])
    for (const title of ['Synthetic spec page', 'Synthetic article one', 'Synthetic article two', 'Synthetic cheat sheet']) {
      const link = within(region).getByRole('link', { name: title })
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
    expect(within(region).getByRole('link', { name: 'Synthetic spec page' })).toHaveAttribute(
      'href',
      'https://www.example.test/spec',
    )
    // The host is shown next to the title.
    const items = within(region).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Synthetic spec page example.test')
    expect(items[1]).toHaveTextContent('Synthetic article one blog.example.test')

    const source = within(region).getByRole('link', { name: 'roadmap.sh' })
    expect(source).toHaveAttribute('href', 'https://roadmap.sh/frontend')
    expect(source).toHaveAttribute('target', '_blank')
    expect(source).toHaveAttribute('rel', 'noopener noreferrer')
    expect(region).toHaveTextContent('Source: roadmap.sh · synced Nov 8, 2026')
    expect(within(region).queryByRole('button', { name: 'Sync references' })).not.toBeInTheDocument()
  })

  it('shows link titles as text, never as HTML', async () => {
    const state = installFakeApi()
    state.resources['frontend/basics'] = [makeResource('<img src=x onerror="window.__refs=1">Bold', 'article')]
    renderApp('#/lesson/frontend/basics')
    const region = await references('Basics')
    await within(region).findByRole('link', { name: /Bold/ })
    expect(region.querySelector('img')).toBeNull()
    expect((window as unknown as { __refs?: number }).__refs).toBeUndefined()
  })

  // Scenario: Sync from the empty state
  it('syncs from the empty state, shows progress and then the links without a reload', async () => {
    const state = installFakeApi()
    state.syncOutcome = {
      links: { 'frontend/basics': [makeResource('Synthetic synced guide', 'official')] },
    }
    const { user } = renderApp('#/lesson/frontend/basics')
    const region = await references('Basics')
    expect(await within(region).findByText('No references synced yet.')).toBeInTheDocument()

    await user.click(await within(region).findByRole('button', { name: 'Sync references' }))
    expect(await within(region).findByRole('status')).toHaveTextContent('Syncing references…')
    expect(within(region).queryByRole('button', { name: 'Sync references' })).not.toBeInTheDocument()
    const post = state.calls.findIndex((c) => c.method === 'POST' && c.url === '/api/resources/sync')
    expect(state.calls[post].body).toEqual({ domain: 'frontend' })
    expect(state.headers[post]['X-LearningHub']).toBe('1')

    const link = await within(region).findByRole('link', { name: 'Synthetic synced guide' }, POLL_WAIT)
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(region).queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows the error of a failed sync and keeps the Sync button', async () => {
    const state = installFakeApi()
    state.syncOutcome = { error: "slug 'synthetic-missing' not found at the pinned commit" }
    const { user } = renderApp('#/lesson/frontend/basics')
    const region = await references('Basics')
    await user.click(await within(region).findByRole('button', { name: 'Sync references' }))
    expect(await within(region).findByRole('status')).toHaveTextContent('Syncing references…')

    const alert = await within(region).findByRole('alert', {}, POLL_WAIT)
    expect(alert).toHaveTextContent("Sync failed: slug 'synthetic-missing' not found at the pinned commit")
    expect(within(region).getByRole('button', { name: 'Sync references' })).toBeEnabled()
    expect(within(region).queryByRole('link')).not.toBeInTheDocument()
  })

  it('offers no Sync button for a roadmap without a resource mapping', async () => {
    const state = installFakeApi()
    renderApp('#/lesson/backend/caching')
    const region = await references('Caching')
    expect(await within(region).findByText('No references for this roadmap yet.')).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: 'Sync references' })).not.toBeInTheDocument()
    expect(state.calls.some((c) => c.url === '/api/resources/sync/backend')).toBe(true)
  })
})

describe('draft lesson from references', () => {
  it('asks the lesson writer to draft the lesson from its references', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    state.resources['frontend/basics'] = [makeResource('Synthetic spec page', 'official')]
    state.chat = () => ({ reply: 'Drafted from the references.' })
    const { user } = renderApp('#/lesson/frontend/basics')
    const region = await references('Basics')
    await user.click(await within(region).findByRole('button', { name: 'Draft lesson from references' }))

    await waitFor(() => expect(state.calls.some((c) => c.url === '/api/agent/chat')).toBe(true))
    const body = state.calls.find((c) => c.url === '/api/agent/chat')?.body as ChatRequest
    expect(body.agent_id).toBe('lesson-writer')
    expect(body.messages.at(-1)).toEqual({
      role: 'user',
      content: 'Draft this lesson from its references (frontend/basics).',
    })
    const panel = screen.getByRole('complementary', { name: 'Agent' })
    expect(await within(panel).findByText('Drafted from the references.')).toBeInTheDocument()
  })

  it('offers no draft button without references or without an active provider', async () => {
    const withLinks = installFakeApi()
    withLinks.resources['frontend/basics'] = [makeResource('Synthetic spec page', 'official')]
    const { unmount } = renderApp('#/lesson/frontend/basics')
    let region = await references('Basics')
    await within(region).findByRole('link', { name: 'Synthetic spec page' })
    expect(within(region).queryByRole('button', { name: 'Draft lesson from references' })).not.toBeInTheDocument()
    unmount()

    const noLinks = installFakeApi()
    noLinks.providers = twoProviders()
    renderApp('#/lesson/frontend/basics')
    region = await references('Basics')
    await within(region).findByRole('button', { name: 'Sync references' })
    expect(within(region).queryByRole('button', { name: 'Draft lesson from references' })).not.toBeInTheDocument()
  })
})
