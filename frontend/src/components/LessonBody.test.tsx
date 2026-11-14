/** Spec: lesson-pages - Lesson template (change lesson-template). */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { readingMinutes, splitSections } from '../lib/lessonTemplate'
import { LessonBody } from './LessonBody'

const LESSON = `Caching keeps answers close to where they are needed.

## Overview
A cache stores results.

> [!KEY] Cache what is read often and changes rarely.

## How it works
| Policy | Evicts |
| --- | --- |
| LRU | least recently used |

\`\`\`python
cache.get("k")
\`\`\`

> [!WARNING]
> Stale data is the price.

> A plain quote stays a quote.

## Key takeaways
- Measure the hit rate.
`

describe('lesson template', () => {
  it('splits at level-two headings outside code fences', () => {
    const sections = splitSections('intro\n## A\none\n```\n## not a heading\n```\n## B\ntwo\n')
    expect(sections.map((s) => s.title)).toEqual([null, 'A', 'B'])
    expect(sections[1].body).toContain('## not a heading')
    expect(splitSections('## Only\nx').map((s) => s.title)).toEqual(['Only'])
    expect(readingMinutes('word '.repeat(450))).toBe(2)
    expect(readingMinutes('')).toBe(1)
  })

  it('draws numbered section cards, contents, reading time and a takeaways card', () => {
    render(<LessonBody text={LESSON} />)
    const body = screen.getByTestId('lesson-body').parentElement!
    expect(within(body).getByText('1 min read · 3 sections')).toBeInTheDocument()
    const toc = within(body).getByRole('navigation', { name: 'On this page' })
    expect(within(toc).getAllByRole('link').map((a) => a.textContent)).toEqual(['Overview', 'How it works', 'Key takeaways'])
    const cards = within(body).getAllByRole('region')
    expect(cards.map((c) => c.getAttribute('aria-labelledby'))).toHaveLength(3)
    expect(within(cards[0]).getByRole('heading', { level: 2 })).toHaveTextContent('Overview')
    expect(cards[2]).toHaveClass('takeaways')
    expect(within(cards[0]).getByRole('heading', { level: 2 })).toHaveAttribute('data-n', '1')
    expect(within(cards[2]).getByRole('heading', { level: 2 })).toHaveAttribute('data-n', '★')
    // The intro stays above the cards.
    expect(within(body).getByText('Caching keeps answers close to where they are needed.')).toBeInTheDocument()
  })

  it('turns alerts into callouts and keeps plain quotes, tables and code blocks', () => {
    render(<LessonBody text={LESSON} />)
    const key = screen.getByRole('complementary', { name: 'Key idea' })
    expect(key).toHaveTextContent('Cache what is read often and changes rarely.')
    expect(key).not.toHaveTextContent('[!KEY]')
    const warning = screen.getByRole('complementary', { name: 'Watch out' })
    expect(warning).toHaveTextContent('Stale data is the price.')
    expect(screen.getByText('A plain quote stays a quote.').closest('blockquote')).not.toBeNull()
    expect(screen.getByRole('table')).toHaveTextContent('least recently used')
    expect(screen.getByTitle('Copy code').tagName).toBe('BUTTON')
  })

  it('renders no raw HTML from the lesson text', () => {
    render(<LessonBody text={'## A\n<script>window.__x = 1</script><b>bold</b>'} />)
    const body = screen.getByTestId('lesson-body')
    expect(body.querySelector('script')).toBeNull()
    expect(body.querySelector('b')).toBeNull()
  })

  it('a contents link scrolls to its card without changing the address', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const before = window.location.hash
    render(<LessonBody text={LESSON} />)
    await userEvent.click(screen.getByRole('link', { name: 'How it works' }))
    expect(scroll).toHaveBeenCalled()
    expect(window.location.hash).toBe(before)
  })

  it('a lesson without sections shows only its text', () => {
    render(<LessonBody text="Just a short note." />)
    expect(screen.queryByRole('navigation', { name: 'On this page' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(screen.getByText('1 min read')).toBeInTheDocument()
  })
})
