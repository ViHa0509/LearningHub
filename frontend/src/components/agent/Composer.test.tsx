/** Spec: agent-stop - the Stop button replaces Send while an answer is pending. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Composer } from './Composer'

function show(over: Partial<Parameters<typeof Composer>[0]> = {}) {
  return render(
    <Composer
      inputRef={createRef()}
      draft=""
      onDraft={() => {}}
      attachments={[]}
      onAddFiles={() => {}}
      onRemoveAttachment={() => {}}
      effort="medium"
      onEffort={() => {}}
      pet={false}
      onPet={() => {}}
      busy={false}
      canSend
      dropping={false}
      onSubmit={() => {}}
      {...over}
    />,
  )
}

describe('Composer stop', () => {
  it('shows Send when idle', () => {
    show({ onStop: () => {} })
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  })

  it('replaces Send with Stop while busy, and Stop calls onStop', async () => {
    const onStop = vi.fn()
    show({ busy: true, onStop })
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('shows "Stopping…" and is disabled after the press', () => {
    show({ busy: true, onStop: () => {}, stopping: true })
    const button = screen.getByRole('button', { name: 'Stop' })
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Stopping…')
  })
})
