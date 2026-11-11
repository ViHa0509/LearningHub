/** Spec: home-page. */
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFakeApi, makeNote } from '../test/fakeApi'
import { renderApp } from '../test/render'

describe('home page', () => {
  it('shows six cards, one per domain in catalog order, with descriptions', async () => {
    installFakeApi()
    renderApp()
    const home = await screen.findByRole('region', { name: 'Home' })
    const cards = await within(home).findAllByRole('link')
    expect(cards.map((c) => within(c).getByRole('heading').textContent)).toEqual([
      'Frontend',
      'Backend',
      'DevOps',
      'QA',
      'Data Engineer',
      'AI Engineer',
    ])
    expect(within(cards[1]).getByText('Server-side code.')).toBeInTheDocument()
    expect(within(cards[5]).getByText('Building with LLMs and agents.')).toBeInTheDocument()
  })

  it('does not count archived notes as progress', async () => {
    installFakeApi([
      makeNote('Pipelines', 'devops/ci-cd'),
      makeNote('Old images', 'devops/docker', { archived_at: '2026-11-07T00:00:00Z' }),
    ])
    renderApp()
    const card = await screen.findByRole('link', { name: /^DevOps/ })
    expect(within(card).getByLabelText('1 of 2 topics with notes')).toBeInTheDocument()
  })

  it('shows progress as topics with notes out of all topics', async () => {
    installFakeApi([
      makeNote('Pipelines', 'devops/ci-cd'),
      makeNote('More pipelines', 'devops/ci-cd'),
      makeNote('Images', 'devops/docker'),
      makeNote('Loose'),
    ])
    renderApp()
    const card = await screen.findByRole('link', { name: /^DevOps/ })
    expect(within(card).getByLabelText('2 of 2 topics with notes')).toHaveTextContent('2 / 2 topics')
    const backend = screen.getByRole('link', { name: /^Backend/ })
    expect(within(backend).getByLabelText('0 of 4 topics with notes')).toBeInTheDocument()
  })

  it('shows a card without description', async () => {
    installFakeApi()
    renderApp()
    const card = await screen.findByRole('link', { name: /^DevOps/ })
    expect(card.querySelector('.card-description')).toBeNull()
    expect(within(card).getByLabelText(/topics with notes/)).toBeInTheDocument()
  })

  it('opens the roadmap of a card', async () => {
    installFakeApi()
    const { user } = renderApp()
    await user.click(await screen.findByRole('link', { name: /^Backend/ }))
    expect(window.location.hash).toBe('#/roadmap/backend')
    expect(await screen.findByTestId('node-backend/caching')).toBeInTheDocument()
  })
})

describe('home page decoration (visual-polish)', () => {
  it('keeps each card a link named by its title, with its progress label', async () => {
    installFakeApi([makeNote('Images', 'devops/docker')])
    renderApp()
    const card = await screen.findByRole('link', { name: /^DevOps/ })
    expect(card).toHaveAttribute('href', '#/roadmap/devops')
    expect(card).toHaveAccessibleName('DevOps 1 of 2 topics with notes')
    expect(within(card).getByLabelText('1 of 2 topics with notes')).toHaveTextContent('1 / 2 topics')
    // The ticker exposes the final number; the beam only shows while hovered or focused.
    expect(within(card).getByLabelText('1')).toBeInTheDocument()
    expect(card.parentElement?.querySelector('.mu-beam')).toBeNull()
  })

  it('shows a decorative border beam while a card has the keyboard focus, and takes it away on blur', async () => {
    installFakeApi()
    const { user } = renderApp()
    const card = await screen.findByRole('link', { name: /^DevOps/ })
    await user.hover(card)
    const beam = card.parentElement?.querySelector('.mu-beam')
    expect(beam).toHaveAttribute('aria-hidden', 'true')
    await user.unhover(card)
    expect(card.parentElement?.querySelector('.mu-beam')).toBeNull()
  })
})
