/** The shared popup menu of the learned list and the note page. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ActionMenu } from './ActionMenu'

function Harness({ onClose }: { onClose: (restoreFocus: boolean) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" className="trigger" onClick={() => setOpen(!open)}>
        Open
      </button>
      <button type="button">Elsewhere</button>
      {open && (
        <ActionMenu
          label="Things"
          triggerSelector=".trigger"
          onClose={(restoreFocus) => {
            setOpen(false)
            onClose(restoreFocus)
          }}
        >
          <button type="button" role="menuitem">
            One
          </button>
          <a role="menuitem" href="#two">
            Two
          </a>
          <button type="button" role="menuitem">
            Three
          </button>
        </ActionMenu>
      )}
    </div>
  )
}

async function open() {
  const user = userEvent.setup()
  const onClose = vi.fn()
  render(<Harness onClose={onClose} />)
  await user.click(screen.getByRole('button', { name: 'Open' }))
  return { user, onClose, items: screen.getAllByRole('menuitem') }
}

describe('action menu', () => {
  it('is a named menu and puts the focus on its first item', async () => {
    const { items } = await open()
    expect(screen.getByRole('menu', { name: 'Things' })).toBeInTheDocument()
    expect(items[0]).toHaveFocus()
  })

  it('moves with Down and Up and wraps at both ends', async () => {
    const { user, items } = await open()
    await user.keyboard('{ArrowDown}')
    expect(items[1]).toHaveFocus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(items[0]).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(items[2]).toHaveFocus()
  })

  it('closes with Escape and asks for the focus to go back', async () => {
    const { user, onClose } = await open()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalledWith(true)
  })

  it('closes on a click outside without moving the focus back', async () => {
    const { user, onClose } = await open()
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalledWith(false)
  })

  it('leaves a click on its own trigger to the trigger', async () => {
    const { user, onClose } = await open()
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    // Closed by the trigger's own toggle, not by the outside-click rule.
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes when the focus leaves the window, as a click into an embedded page does', async () => {
    const { onClose } = await open()
    window.dispatchEvent(new Event('blur'))
    expect(onClose).toHaveBeenCalledWith(false)
  })
})
