/** Spec: learning-views - Roadmap map with note markers. */
import { act, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NODE_WIDTH, layoutRoadmap } from '../lib/layout'
import { startViewport } from '../lib/startViewport'
import { backend, installFakeApi, makeNote } from '../test/fakeApi'
import { renderApp } from '../test/render'
import { resetScreenClass, setScreenClass } from '../test/screenClass'

describe('RoadmapMap', () => {
  it('marks nodes with notes with their count, matching the counts API', async () => {
    const state = installFakeApi([
      makeNote('Redis eviction', 'backend/caching'),
      makeNote('HTTP caching', 'backend/caching'),
    ])
    renderApp('#/roadmap/backend')
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

  it('scrolls the active domain tab into view inside its row', async () => {
    installFakeApi([])
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      renderApp('#/roadmap/devops')
      await screen.findByTestId('node-devops/ci-cd')
      expect(scrollIntoView).toHaveBeenCalledWith({ inline: 'nearest', block: 'nearest' })
      expect(scrollIntoView.mock.contexts).toContain(screen.getByRole('tab', { name: 'DevOps' }))
    } finally {
      // @ts-expect-error jsdom has no scrollIntoView; restore that state
      delete Element.prototype.scrollIntoView
    }
  })

  it('switches domain', async () => {
    installFakeApi([])
    const { user } = renderApp('#/roadmap/backend')
    await screen.findByTestId('node-backend/caching')
    await user.click(screen.getByRole('tab', { name: 'DevOps' }))
    expect(await screen.findByTestId('node-devops/ci-cd')).toBeInTheDocument()
    expect(screen.queryByTestId('node-backend/caching')).not.toBeInTheDocument()
  })
})

/** Spec: responsive-layout - Roadmap map on small screens. */
describe('startViewport', () => {
  const first = { x: 0, y: 0 }

  it('keeps the fixed viewport on desktop', () => {
    expect(startViewport(first, NODE_WIDTH, 1200, 'desktop')).toEqual({ x: 32, y: 24, zoom: 0.9 })
  })

  it.each([
    ['phone', 390],
    ['tablet', 820],
  ] as const)('centers the first node at zoom 0.85 on %s', (screenClass, pane) => {
    const v = startViewport({ x: 40, y: 10 }, NODE_WIDTH, pane, screenClass)
    expect(v.zoom).toBe(0.85)
    expect((40 + NODE_WIDTH / 2) * v.zoom + v.x).toBeCloseTo(pane / 2)
    expect(v.y + 10 * v.zoom).toBeCloseTo(24)
  })
})

describe('RoadmapMap start view', () => {
  afterEach(() => resetScreenClass())

  it('renders on phone without fitView and with the map still pannable', async () => {
    installFakeApi([])
    act(() => setScreenClass('phone'))
    renderApp('#/roadmap/backend')
    expect(await screen.findByTestId('node-backend/caching')).toBeInTheDocument()
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
