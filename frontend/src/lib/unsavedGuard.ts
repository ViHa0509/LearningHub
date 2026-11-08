import { useEffect, useRef } from 'react'

export const LEAVE_MESSAGE = 'You have unsaved changes. Leave this page and discard them?'

/**
 * Warns before unsaved changes are lost: the browser's own prompt when the tab is closed or
 * reloaded, and a confirm() on in-app navigation (a hash change), which is undone when the user
 * cancels. `markClean` lets a save navigate away without being asked.
 */
const open = new Set<{ current: boolean }>()

/**
 * Asks once before something other than a hash change (logging out) discards unsaved changes.
 * True when nothing is unsaved or the user agreed; the pages are then treated as clean.
 */
export function confirmUnsaved(): boolean {
  const dirty = [...open].filter((ref) => ref.current)
  if (dirty.length === 0) return true
  if (!window.confirm(LEAVE_MESSAGE)) return false
  for (const ref of dirty) ref.current = false
  return true
}

export function useUnsavedGuard(dirty: boolean): { markClean: () => void } {
  const dirtyRef = useRef(dirty)
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  useEffect(() => {
    const ref = dirtyRef
    open.add(ref)
    return () => {
      open.delete(ref)
    }
  }, [])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    // Registered for the capture phase so it runs before the router's listener (added earlier,
    // at app start) and can restore the URL before the router reads it.
    const hashChange = (event: HashChangeEvent) => {
      if (!dirtyRef.current) return
      if (window.confirm(LEAVE_MESSAGE)) return
      window.history.replaceState(null, '', event.oldURL)
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('hashchange', hashChange, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('hashchange', hashChange, true)
    }
  }, [])

  return {
    markClean: () => {
      dirtyRef.current = false
    },
  }
}
