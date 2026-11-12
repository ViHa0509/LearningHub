import { useSyncExternalStore } from 'react'

export type ScreenClass = 'phone' | 'tablet' | 'desktop'

// The media queries in src/index.css use the same numbers; change them together.
export const PHONE_MAX_WIDTH = 640
export const TABLET_MAX_WIDTH = 1100

export const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH - 0.02}px)`
export const TABLET_QUERY = `(max-width: ${TABLET_MAX_WIDTH - 0.02}px)`

const hasMatchMedia = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

function subscribe(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => {}
  const queries = [window.matchMedia(PHONE_QUERY), window.matchMedia(TABLET_QUERY)]
  queries.forEach((query) => query.addEventListener('change', onChange))
  return () => queries.forEach((query) => query.removeEventListener('change', onChange))
}

function snapshot(): ScreenClass {
  if (!hasMatchMedia()) return 'desktop'
  if (window.matchMedia(PHONE_QUERY).matches) return 'phone'
  if (window.matchMedia(TABLET_QUERY).matches) return 'tablet'
  return 'desktop'
}

/** The screen class by viewport width (phone, tablet, desktop); follows changes live, 'desktop' without matchMedia. */
export function useScreenClass(): ScreenClass {
  return useSyncExternalStore(subscribe, snapshot, () => 'desktop')
}
