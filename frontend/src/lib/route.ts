import { useEffect, useState } from 'react'

export type Route =
  | { page: 'home' }
  | { page: 'roadmap'; domain: string }
  | { page: 'lesson'; domain: string; node: string }
  | { page: 'note'; id: string }
  | { page: 'settings' }
  /** Settings > Sign-in (GitHub and Google client setup). */
  | { page: 'sign-in-settings' }
  /** Settings > Users (admin only). */
  | { page: 'users-settings' }
  /** Settings > Data & sync (backup, restore, sync). */
  | { page: 'data-settings' }
  | { page: 'news' }
  /** The provider configuration page; id is `new` for a configuration not saved yet. */
  | { page: 'provider'; id: string }

const SEGMENT = /^[A-Za-z0-9_-]+$/

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (!parts.every((p) => SEGMENT.test(p))) return { page: 'home' }
  if (parts[0] === 'roadmap' && parts.length === 2) return { page: 'roadmap', domain: parts[1] }
  if (parts[0] === 'lesson' && parts.length === 3) return { page: 'lesson', domain: parts[1], node: parts[2] }
  if (parts[0] === 'note' && parts.length === 2) return { page: 'note', id: parts[1] }
  if (parts[0] === 'settings' && parts.length === 1) return { page: 'settings' }
  if (parts[0] === 'settings' && parts[1] === 'sign-in' && parts.length === 2) return { page: 'sign-in-settings' }
  if (parts[0] === 'settings' && parts[1] === 'users' && parts.length === 2) return { page: 'users-settings' }
  if (parts[0] === 'settings' && parts[1] === 'data' && parts.length === 2) return { page: 'data-settings' }
  if (parts[0] === 'news' && parts.length === 1) return { page: 'news' }
  if (parts[0] === 'settings' && parts[1] === 'providers' && parts.length === 3) {
    return { page: 'provider', id: parts[2] }
  }
  return { page: 'home' }
}

export function routeHash(route: Route): string {
  switch (route.page) {
    case 'home':
      return '#/'
    case 'roadmap':
      return `#/roadmap/${route.domain}`
    case 'lesson':
      return `#/lesson/${route.domain}/${route.node}`
    case 'note':
      return `#/note/${route.id}`
    case 'settings':
      return '#/settings'
    case 'sign-in-settings':
      return '#/settings/sign-in'
    case 'users-settings':
      return '#/settings/users'
    case 'data-settings':
      return '#/settings/data'
    case 'news':
      return '#/news'
    case 'provider':
      return `#/settings/providers/${route.id}`
  }
}

// The last page opened outside Settings and its provider pages: where Settings' Back goes.
let outsideSettings: Route | null = null

const isSettings = (route: Route) =>
  route.page === 'settings' ||
  route.page === 'provider' ||
  route.page === 'sign-in-settings' ||
  route.page === 'users-settings' ||
  route.page === 'data-settings'

function remember(route: Route): Route {
  if (!isSettings(route)) outsideSettings = route
  return route
}

/** Tests start each app without a remembered page. */
export function forgetPages() {
  outsideSettings = null
}

/** Where Back on the Settings page leads: the last page outside Settings, else home. */
export function backFromSettings(): Route {
  return outsideSettings ?? { page: 'home' }
}

/** Asked before the page changes; returns false to stay (for example, unsaved edits). */
let leaveGuard: (() => boolean) | null = null

export function setLeaveGuard(guard: (() => boolean) | null) {
  leaveGuard = guard
}

/** Asks the open page whether it may be left (unsaved edits); true when nothing stops it. */
export function mayLeave(): boolean {
  if (leaveGuard && !leaveGuard()) return false
  leaveGuard = null
  return true
}

export function navigate(route: Route) {
  if (leaveGuard && !leaveGuard()) return
  // Confirmed once; the hash change that follows must not ask again.
  leaveGuard = null
  window.location.hash = routeHash(route)
}

/** The current page, from the URL hash; follows back/forward and links. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => remember(parseRoute(window.location.hash)))
  useEffect(() => {
    let current = window.location.hash
    const update = () => {
      // A link or the back button changed the hash: put it back when the page must stay.
      if (window.location.hash !== current && leaveGuard) {
        if (!leaveGuard()) {
          window.history.replaceState(null, '', current || '#/')
          return
        }
        leaveGuard = null
      }
      current = window.location.hash
      setRoute(remember(parseRoute(current)))
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}
