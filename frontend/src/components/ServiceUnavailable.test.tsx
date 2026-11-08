/** Spec: learning-views - Service unavailable page. */
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeApi, makeNote } from '../test/fakeApi'
import { renderApp } from '../test/render'

const outage = () => screen.findByRole('main', { name: 'Service unavailable' })
const healthCalls = (state: ReturnType<typeof installFakeApi>) =>
  state.calls.filter((c) => c.url === '/api/health').length

afterEach(() => {
  vi.useRealTimers()
})

describe('service unavailable page', () => {
  it('shows the server wording, with no retry controls, when the backend does not answer', async () => {
    const state = installFakeApi([makeNote('Redis eviction', 'backend/caching')])
    state.down = 'server'
    renderApp()

    const page = await outage()
    expect(within(page).getByRole('heading', { name: 'Service unavailable' })).toBeInTheDocument()
    expect(within(page).getByText("Learning Hub can't reach its server.")).toBeInTheDocument()
    expect(within(page).getByText('This page reconnects on its own.')).toBeInTheDocument()
    // It reconnects in the background: no retry button and no countdown message.
    expect(within(page).queryByRole('button')).not.toBeInTheDocument()
    expect(within(page).queryByText(/Retrying|Try again/)).not.toBeInTheDocument()
    expect(within(page).getByText(/^Last checked \d\d:\d\d:\d\d$/)).toBeInTheDocument()
    // The panels are gone, the top bar with the theme switch stays.
    expect(screen.queryByRole('main', { name: 'Content' })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Learned items' })).not.toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument()
    expect(screen.queryByText(/Is the backend running\?/)).not.toBeInTheDocument()
  })

  it('says the database cannot be reached when the health check answers 503 database', async () => {
    const state = installFakeApi()
    state.down = 'database'
    renderApp()

    const page = await outage()
    expect(within(page).getByText("Learning Hub can't reach its database.")).toBeInTheDocument()
    expect(within(page).queryByText("Learning Hub can't reach its server.")).not.toBeInTheDocument()
  })

  it('treats any other failed health answer as the server being down', async () => {
    const state = installFakeApi()
    state.down = 'proxy'
    renderApp()

    const page = await outage()
    expect(within(page).getByText("Learning Hub can't reach its server.")).toBeInTheDocument()
  })

  it('returns to the same page with its data when the service comes back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = installFakeApi()
    state.lessons['devops/docker'] = {
      node_id: 'devops/docker',
      body: 'Images, containers and layers.',
      source: 'user',
      updated_at: '2026-11-07T00:00:00Z',
    }
    state.down = 'server'
    renderApp('#/lesson/devops/docker')
    await outage()
    const lessonCalls = () => state.calls.filter((c) => c.url === '/api/lessons/devops/docker').length
    const before = lessonCalls()

    state.down = null
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    const lesson = await screen.findByRole('article', { name: 'Lesson: Docker' })
    expect(await within(lesson).findByText('Images, containers and layers.')).toBeInTheDocument()
    expect(screen.queryByRole('main', { name: 'Service unavailable' })).not.toBeInTheDocument()
    expect(window.location.hash).toBe('#/lesson/devops/docker')
    expect(lessonCalls()).toBeGreaterThan(before)
  })

  it('keeps checking every 5 s while down and comes back without any click', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = installFakeApi()
    state.down = 'database'
    renderApp()
    await outage()
    const before = healthCalls(state)
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    await waitFor(() => expect(healthCalls(state)).toBeGreaterThan(before))
    expect(screen.getByRole('main', { name: 'Service unavailable' })).toBeInTheDocument()

    state.down = null
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(await screen.findByRole('main', { name: 'Content' })).toBeInTheDocument()
    expect(screen.queryByRole('main', { name: 'Service unavailable' })).not.toBeInTheDocument()
  })

  it('checks health right after a request fails, without waiting for the next poll', async () => {
    const state = installFakeApi()
    const { user } = renderApp()
    await screen.findByRole('main', { name: 'Content' })
    const before = healthCalls(state)

    state.down = 'server'
    await user.click(screen.getByRole('link', { name: 'Settings' }))

    expect(await outage()).toBeInTheDocument()
    expect(healthCalls(state)).toBeGreaterThan(before)
  })
})
