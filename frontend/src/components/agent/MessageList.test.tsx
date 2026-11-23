/** Spec: visual-polish - Thinking indicator (the status semantics stay). */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MessageList } from './MessageList'

describe('MessageList pending row', () => {
  it('shows "Thinking…" as a status while the answer is pending', () => {
    // jsdom does not scroll.
    Element.prototype.scrollIntoView = vi.fn()
    render(<MessageList entries={[]} busy onRetry={() => {}} onStarter={() => {}} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Thinking…')
  })

  it('shows no pending row when idle', () => {
    Element.prototype.scrollIntoView = vi.fn()
    render(<MessageList entries={[]} busy={false} onRetry={() => {}} onStarter={() => {}} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('MessageList images', () => {
  const answer = (content: string) => [{ id: 1, role: 'assistant' as const, content }]
  const show = (content: string) => {
    Element.prototype.scrollIntoView = vi.fn()
    return render(<MessageList entries={answer(content)} busy={false} onRetry={() => {}} onStarter={() => {}} />)
  }

  it('shows an outside image as a placeholder with its alt text and address, and no img', () => {
    const { container } = show('![tracker](https://evil.example/p.png?q=1)')
    expect(container.querySelector('img')).toBeNull()
    const blocked = container.querySelector('.md-blocked-image')
    expect(blocked).not.toBeNull()
    expect(blocked).toHaveTextContent('tracker')
    expect(blocked).toHaveTextContent('https://evil.example/p.png?q=1')
  })

  it('renders an image of the app itself', () => {
    const { container } = show('![Logo](/brand/logo-mark.svg)')
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('/brand/logo-mark.svg')
    expect(img?.getAttribute('alt')).toBe('Logo')
    expect(container.querySelector('.md-blocked-image')).toBeNull()
  })
})

describe('MessageList stopped answers', () => {
  const run = (stopped: boolean, onRetry = vi.fn()) => {
    Element.prototype.scrollIntoView = vi.fn()
    render(
      <MessageList
        entries={[{ id: 1, role: 'assistant', content: 'Stopped by you.', ...(stopped ? { stopped: true } : {}) }]}
        busy={false}
        onRetry={onRetry}
        onStarter={() => {}}
      />,
    )
    return onRetry
  }

  it('marks a stopped answer and keeps Retry working', async () => {
    const onRetry = run(true)
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledWith(1)
  })

  it('shows no mark on a normal answer', () => {
    run(false)
    expect(screen.queryByText('Stopped')).not.toBeInTheDocument()
  })
})
