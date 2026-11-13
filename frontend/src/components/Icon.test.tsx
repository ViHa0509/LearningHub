/** Visual identity (design decision 7): the shared 1.5 px icon set. */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Icon, type IconName } from './Icon'

// A Record over IconName: the type check fails if an icon is added or removed without updating this list.
const ALL: Record<IconName, true> = {
  home: true, roadmap: true, lesson: true, note: true, settings: true, agent: true, import: true,
  archive: true, restore: true, edit: true, move: true, more: true, sun: true, moon: true, system: true,
  search: true, close: true, check: true, trash: true, 'chevron-down': true, external: true,
  paperclip: true, send: true, copy: true, retry: true, sparkle: true, sidebar: true, print: true, news: true,
  'more-vertical': true,
}
const ICON_NAMES = Object.keys(ALL) as IconName[]

describe('Icon', () => {
  it('has the 30 icons of the set', () => {
    expect(ICON_NAMES).toHaveLength(30)
  })

  it.each(ICON_NAMES)('draws "%s" as a 1.5 px currentColor line icon on a 24 px grid', (name) => {
    const { container } = render(<Icon name={name} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg).toHaveAttribute('stroke', 'currentColor')
    expect(svg).toHaveAttribute('stroke-width', '1.5')
    expect(svg).toHaveAttribute('fill', 'none')
    expect(svg).toHaveAttribute('stroke-linecap', 'round')
    expect(svg).toHaveAttribute('stroke-linejoin', 'round')
    expect(svg).toHaveAttribute('data-icon', name)
    expect(svg!.querySelectorAll('path, circle, rect').length).toBeGreaterThan(0)
  })

  it('is hidden from assistive tech by default', () => {
    const { container } = render(<Icon name="home" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).not.toHaveAttribute('role')
    expect(svg!.querySelector('title')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('becomes a named image when given a title', () => {
    render(<Icon name="archive" title="Archive note" />)
    const img = screen.getByRole('img', { name: 'Archive note' })
    expect(img).not.toHaveAttribute('aria-hidden')
    expect(img.querySelector('title')).toHaveTextContent('Archive note')
  })

  it('uses the given size and keeps extra class names', () => {
    const { container } = render(<Icon name="search" size={24} className="lead" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '24')
    expect(svg).toHaveAttribute('height', '24')
    expect(svg).toHaveClass('icon', 'lead')
  })
})
