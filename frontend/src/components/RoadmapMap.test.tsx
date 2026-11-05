/** Spec: learning-views - Roadmap map with note markers. */
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { layoutRoadmap } from '../lib/layout'
import { backend, installFakeApi, makeNote } from '../test/fakeApi'
import { renderApp } from '../test/render'

describe('RoadmapMap', () => {
  it('marks nodes with notes with their count, matching the counts API', async () => {
    const state = installFakeApi([
      makeNote('Redis eviction', 'backend/caching'),
      makeNote('HTTP caching', 'backend/caching'),
    ])
    renderApp()
    const caching = await screen.findByTestId('node-backend/caching')
    expect(await within(caching).findByLabelText('2 notes')).toHaveTextContent('2')
    expect(caching).toHaveClass('has-notes')
    for (const id of ['backend/apis', 'backend/redis', 'backend/auth']) {
      const node = screen.getByTestId(`node-${id}`)
      expect(node).not.toHaveClass('has-notes')
      expect(within(node).queryByLabelText(/notes$/)).not.toBeInTheDocument()
    }
    expect(state.calls.some((c) => c.url === '/api/domains/backend/counts')).toBe(true)
  })

  it('switches domain', async () => {
    installFakeApi([])
    const { user } = renderApp()
    await screen.findByTestId('node-backend/caching')
    await user.click(screen.getByRole('tab', { name: 'DevOps' }))
    expect(await screen.findByTestId('node-devops/ci-cd')).toBeInTheDocument()
    expect(screen.queryByTestId('node-backend/caching')).not.toBeInTheDocument()
  })
})

describe('layoutRoadmap', () => {
  it('creates one flow node per roadmap node, parent edges and a spine between topics', () => {
    const { nodes, edges } = layoutRoadmap(backend, { caching: 3 }, 'backend/redis')
    expect(nodes).toHaveLength(4)
    expect(edges.map((e) => e.id).sort()).toEqual(
      ['caching->redis', 'spine:apis->caching', 'spine:caching->auth'].sort(),
    )
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n.data]))
    expect(byId.caching.count).toBe(3)
    expect(byId.apis.count).toBe(0)
    expect(byId.redis.selected).toBe(true)
    expect(byId.caching.isTopic).toBe(true)
    expect(byId.redis.isTopic).toBe(false)
  })

  it('stacks topics down a spine and branches subtopics to the right', () => {
    const { nodes } = layoutRoadmap(backend, {}, null)
    const pos = Object.fromEntries(nodes.map((n) => [n.id, n.position]))
    expect(pos.apis.x).toBe(pos.caching.x)
    expect(pos.caching.y).toBeGreaterThan(pos.apis.y)
    expect(pos.auth.y).toBeGreaterThan(pos.caching.y)
    expect(pos.redis.x).toBeGreaterThan(pos.caching.x)
  })
})
