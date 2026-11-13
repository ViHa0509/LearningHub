import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

interface Props {
  /** The menu's accessible name. */
  label: string
  /**
   * Called when the menu should close; `restoreFocus` is true when the keyboard closed it,
   * so the caller puts the focus back on the button that opened it.
   */
  onClose: (restoreFocus: boolean) => void
  /** A click on an element matching this selector is left to that button's own toggle. */
  triggerSelector: string
  /** The items: elements with `role="menuitem"`. */
  children: ReactNode
}

/**
 * A popup menu of actions: the focus starts on the first item, Up and Down move between the
 * items, Escape closes it, and so does a click or a focus move outside it.
 */
export function ActionMenu({ label, onClose, triggerSelector, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const outside = (event: MouseEvent) => {
      const target = event.target as Element
      if (ref.current?.contains(target)) return
      if (target.closest?.(triggerSelector)) return
      close.current(false)
    }
    // A click inside an embedded page (a note's frame) never reaches this document.
    const away = () => close.current(false)
    document.addEventListener('mousedown', outside)
    window.addEventListener('blur', away)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('blur', away)
    }
  }, [triggerSelector])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose(true)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
      const at = items.indexOf(document.activeElement as HTMLElement)
      const next = event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
      items[next]?.focus()
    }
  }

  return (
    <div ref={ref} className="note-menu" role="menu" aria-label={label} onKeyDown={onKeyDown}>
      {children}
    </div>
  )
}
