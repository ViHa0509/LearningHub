// Test helper for components that depend on useScreenClass().
//   setScreenClass('phone' | 'tablet' | 'desktop')  installs a window.matchMedia stub that answers the two
//     screen-class queries and notifies subscribed listeners when the class changes (wrap in act() if
//     a component is mounted). Every other query answers matches: false.
//   resetScreenClass()  restores the matchMedia that was there before the first setScreenClass().
import { PHONE_QUERY, TABLET_QUERY, type ScreenClass } from '../lib/useScreenClass'

type Listener = (event: MediaQueryListEvent) => void

let current: ScreenClass = 'desktop'
let original: typeof window.matchMedia | undefined
let installed = false
const listeners = new Set<{ query: string; listener: Listener }>()

function matches(query: string): boolean {
  if (query === PHONE_QUERY) return current === 'phone'
  if (query === TABLET_QUERY) return current === 'phone' || current === 'tablet'
  return false
}

function stub(query: string): MediaQueryList {
  const list = {
    media: query,
    onchange: null,
    get matches() {
      return matches(query)
    },
    addEventListener: (type: string, listener: Listener) => {
      if (type === 'change') listeners.add({ query, listener })
    },
    removeEventListener: (type: string, listener: Listener) => {
      if (type !== 'change') return
      for (const entry of listeners) if (entry.query === query && entry.listener === listener) listeners.delete(entry)
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }
  return list as unknown as MediaQueryList
}

export function setScreenClass(screenClass: ScreenClass): void {
  if (!installed) {
    original = window.matchMedia
    window.matchMedia = stub as unknown as typeof window.matchMedia
    installed = true
  }
  const before = new Map([PHONE_QUERY, TABLET_QUERY].map((q) => [q, matches(q)]))
  current = screenClass
  for (const { query, listener } of [...listeners]) {
    if (before.get(query) !== matches(query)) {
      listener({ matches: matches(query), media: query } as MediaQueryListEvent)
    }
  }
}

export function resetScreenClass(): void {
  if (installed) window.matchMedia = original as typeof window.matchMedia
  installed = false
  original = undefined
  current = 'desktop'
  listeners.clear()
}
