/** Spec: visual-polish - Thinking indicator (the status semantics stay). */
import { render, screen } from '@testing-library/react'
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
