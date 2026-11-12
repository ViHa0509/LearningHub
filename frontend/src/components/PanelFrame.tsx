import { useEffect, useRef, type ReactNode } from 'react'

export const LEARNED_PANEL_ID = 'learned-panel'
export const AGENT_PANEL_ID = 'agent-panel'
/** The top-bar buttons that open the phone drawers; focus returns to them when a drawer closes. */
export const LEARNED_OPENER_ID = 'learned-drawer-button'
export const AGENT_OPENER_ID = 'agent-drawer-button'

/** Marks the button that closes a drawer; focus moves to it when the drawer opens. */
export const DRAWER_CLOSE_ATTR = 'data-drawer-close'

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

interface Props {
  id: string
  /** Class names of the pane (`pane left`, `pane right agent-pane`). */
  className: string
  /** Label of the `aside` on tablet and desktop. */
  asideLabel: string
  /** Label of the dialog on a phone. */
  drawerLabel: string
  /** On a phone the panel is a drawer (a modal dialog over the page); otherwise an `aside`. */
  drawer: boolean
  open: boolean
  onClose: () => void
  openerId: string
  children: ReactNode
}

/**
 * A side panel. On tablet and desktop it is the `aside` it always was (collapsed shows a rail). On a
 * phone it is a modal dialog drawer: focus moves to its close button on open and back to the top-bar
 * button on close, Tab stays inside, Escape closes. A closed drawer stays in the tree (hidden), so
 * what it holds (the chat) keeps its state.
 */
export function PanelFrame({ id, className, asideLabel, drawerLabel, drawer, open, onClose, openerId, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(false)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  // Focus in on open, back to the opener on close.
  useEffect(() => {
    if (!drawer) {
      wasOpen.current = false
      return
    }
    const root = ref.current
    if (open) {
      wasOpen.current = true
      root?.querySelector<HTMLElement>(`[${DRAWER_CLOSE_ATTR}]`)?.focus()
    } else if (wasOpen.current) {
      wasOpen.current = false
      const active = document.activeElement
      // Keep focus where the user (or another drawer opening in the same step) has put it.
      if (!active || active === document.body || root?.contains(active)) document.getElementById(openerId)?.focus()
    }
  }, [drawer, open, openerId])

  // Escape closes; Tab stays inside.
  useEffect(() => {
    if (!drawer || !open) return
    const onKeyDown = (event: KeyboardEvent) => {
      const root = ref.current
      if (!root || event.defaultPrevented) return
      // A dialog of its own (import, move) handles its own keys.
      const own = (document.activeElement as Element | null)?.closest('[role="dialog"]')
      if (own && own !== root) return
      if (event.key === 'Escape') {
        event.preventDefault()
        close.current()
      } else if (event.key === 'Tab') {
        const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => !el.hasAttribute('disabled') && !el.closest('[hidden]'),
        )
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement
        if (!active || !root.contains(active)) {
          event.preventDefault()
          first.focus()
        } else if (event.shiftKey && active === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawer, open])

  if (drawer) {
    return (
      <div
        ref={ref}
        id={id}
        className={`${className} drawer`}
        role="dialog"
        aria-modal="true"
        aria-label={drawerLabel}
        hidden={!open}
      >
        {children}
      </div>
    )
  }
  return (
    <aside id={id} className={className} aria-label={asideLabel} data-collapsed={!open}>
      {children}
    </aside>
  )
}
