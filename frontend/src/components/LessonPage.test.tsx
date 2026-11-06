/** Spec: lesson-pages. */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFakeApi, makeNote } from '../test/fakeApi'
import { renderApp } from '../test/render'

const openLesson = (title: string) => screen.findByRole('article', { name: `Lesson: ${title}` })

describe('lesson page', () => {
  it('shows breadcrumb, description, subtopics and linked notes', async () => {
    installFakeApi([makeNote('Redis eviction', 'backend/caching'), makeNote('JWT', 'backend/auth')])
    renderApp('#/lesson/backend/caching')
    const lesson = await openLesson('Caching')

    const crumbs = within(lesson).getByRole('navigation', { name: 'Breadcrumb' })
    expect(crumbs).toHaveTextContent('Backend › Caching')
    expect(within(lesson).getByText('Keeping hot data close.')).toBeInTheDocument()
    const subtopics = within(lesson).getByRole('region', { name: 'Subtopics' })
    expect(within(subtopics).getByRole('link', { name: 'Redis' })).toHaveAttribute('href', '#/lesson/backend/redis')
    const notes = within(lesson).getByRole('region', { name: 'Your notes' })
    expect(within(notes).getByRole('link', { name: 'Redis eviction' })).toBeInTheDocument()
    expect(within(notes).queryByRole('link', { name: 'JWT' })).not.toBeInTheDocument()
  })

  it('shows the ancestors of a subtopic in the breadcrumb', async () => {
    installFakeApi()
    renderApp('#/lesson/backend/redis')
    const lesson = await openLesson('Redis')
    const crumbs = within(lesson).getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'Caching' })).toHaveAttribute('href', '#/lesson/backend/caching')
  })

  it('opens a linked note', async () => {
    installFakeApi([makeNote('Redis eviction', 'backend/caching')])
    const { user } = renderApp('#/lesson/backend/caching')
    const lesson = await openLesson('Caching')
    await user.click(within(lesson).getByRole('link', { name: 'Redis eviction' }))
    expect(await screen.findByRole('article', { name: 'Note: Redis eviction' })).toBeInTheDocument()
  })

  it('says when a node has no notes and no lesson', async () => {
    installFakeApi()
    renderApp('#/lesson/backend/apis')
    const lesson = await openLesson('APIs')
    expect(within(lesson).getByText('No notes are linked to this topic yet.')).toBeInTheDocument()
    expect(await within(lesson).findByText(/No lesson yet/)).toBeInTheDocument()
    expect(within(lesson).getByRole('button', { name: 'Write lesson' })).toBeInTheDocument()
  })

  it('says when the node does not exist and links back to the roadmap', async () => {
    installFakeApi()
    renderApp('#/lesson/backend/not-a-node')
    const missing = await screen.findByRole('region', { name: 'Lesson not found' })
    expect(within(missing).getByRole('link', { name: 'Back to the Backend roadmap' })).toHaveAttribute(
      'href',
      '#/roadmap/backend',
    )
  })

  it('links to roadmap.sh in a new tab', async () => {
    installFakeApi()
    renderApp('#/lesson/devops/docker')
    const lesson = await openLesson('Docker')
    const link = within(lesson).getByRole('link', { name: /on roadmap\.sh/ })
    expect(link).toHaveAttribute('href', 'https://roadmap.sh/devops')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })
})

describe('lesson content', () => {
  it('writes a lesson and renders it as Markdown', async () => {
    const state = installFakeApi()
    const { user } = renderApp('#/lesson/backend/caching')
    const lesson = await openLesson('Caching')
    await user.click(await within(lesson).findByRole('button', { name: 'Write lesson' }))
    await user.type(
      within(lesson).getByRole('textbox', { name: 'Lesson text (Markdown)' }),
      '**Cache-aside**: read the cache, fall back to the database',
    )
    await user.click(within(lesson).getByRole('button', { name: 'Save lesson' }))

    const body = await within(lesson).findByTestId('lesson-body')
    expect(within(body).getByText('Cache-aside').tagName).toBe('STRONG')
    expect(state.calls).toContainEqual({
      method: 'PUT',
      url: '/api/lessons/backend/caching',
      body: { body: '**Cache-aside**: read the cache, fall back to the database', source: 'user' },
    })
    expect(within(lesson).getByRole('button', { name: 'Edit lesson' })).toBeInTheDocument()
  })

  it('clears a lesson by saving an empty text', async () => {
    const state = installFakeApi()
    state.lessons['backend/caching'] = {
      node_id: 'backend/caching',
      body: 'Old text',
      source: 'user',
      updated_at: '2026-11-07T00:00:00Z',
    }
    const { user } = renderApp('#/lesson/backend/caching')
    const lesson = await openLesson('Caching')
    await within(lesson).findByText('Old text')
    await user.click(within(lesson).getByRole('button', { name: 'Edit lesson' }))
    await user.clear(within(lesson).getByRole('textbox', { name: 'Lesson text (Markdown)' }))
    await user.click(within(lesson).getByRole('button', { name: 'Save lesson' }))
    expect(await within(lesson).findByText(/No lesson yet/)).toBeInTheDocument()
    expect(state.lessons['backend/caching']).toBeUndefined()
  })

  it('does not insert HTML from the lesson text', async () => {
    const state = installFakeApi()
    state.lessons['backend/caching'] = {
      node_id: 'backend/caching',
      body: 'Before <script>window.__pwned = true</script> <img src=x onerror="window.__pwned=true"> after',
      source: 'agent',
      updated_at: '2026-11-07T00:00:00Z',
    }
    renderApp('#/lesson/backend/caching')
    const body = await screen.findByTestId('lesson-body')
    await waitFor(() => expect(body).toHaveTextContent('Before'))
    expect(body.querySelector('script')).toBeNull()
    expect(body.querySelector('img')).toBeNull()
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })
})
