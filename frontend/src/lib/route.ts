import { useEffect, useState } from 'react'

export type ProfileSection = 'general' | 'security' | 'preferences'

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
  /** Settings > Agents (providers per agent, instructions and tools per area). */
  | { page: 'agents-settings' }
  /** The user's own Profile (`#/profile`, `#/profile/security`, `#/profile/preferences`). */
  | { page: 'profile'; section: ProfileSection }
  | { page: 'news' }
  /** The A2UI Lab playground (`#/a2ui-lab`). */
  | { page: 'a2ui-lab' }
  /** Practice questions of an area (`#/practice/<area slug>`). */
  | { page: 'practice'; area: string }
  /** A mock test (`#/exam/<exam id>`): taking it, or its result. */
  | { page: 'exam'; id: string }
  /** The provider configuration page; id is `new` for a configuration not saved yet. */
  | { page: 'provider'; id: string }

const SEGMENT = /^[A-Za-z0-9_-]+$/

export function parseRoute(hash: string): Route {
  // A query (`#/profile/security?linked=github`, after an OAuth redirect) is not part of the page.
  const parts = hash.split('?')[0].replace(/^#\/?/, '').split('/').filter(Boolean)
  if (!parts.every((p) => SEGMENT.test(p))) return { page: 'home' }
  if (parts[0] === 'roadmap' && parts.length === 2) return { page: 'roadmap', domain: parts[1] }
  if (parts[0] === 'lesson' && parts.length === 3) return { page: 'lesson', domain: parts[1], node: parts[2] }
  if (parts[0] === 'note' && parts.length === 2) return { page: 'note', id: parts[1] }
  if (parts[0] === 'settings' && parts.length === 1) return { page: 'settings' }
  if (parts[0] === 'settings' && parts[1] === 'sign-in' && parts.length === 2) return { page: 'sign-in-settings' }
  if (parts[0] === 'settings' && parts[1] === 'users' && parts.length === 2) return { page: 'users-settings' }
  if (parts[0] === 'settings' && parts[1] === 'data' && parts.length === 2) return { page: 'data-settings' }
  if (parts[0] === 'settings' && parts[1] === 'agents' && parts.length === 2) return { page: 'agents-settings' }
  // Account moved to Profile.
  if (parts[0] === 'settings' && parts[1] === 'account' && parts.length === 2) return { page: 'profile', section: 'general' }
  if (parts[0] === 'profile' && parts.length === 1) return { page: 'profile', section: 'general' }
  if (parts[0] === 'profile' && (parts[1] === 'security' || parts[1] === 'preferences') && parts.length === 2) {
    return { page: 'profile', section: parts[1] }
  }
  if (parts[0] === 'news' && parts.length === 1) return { page: 'news' }
  if (parts[0] === 'a2ui-lab' && parts.length === 1) return { page: 'a2ui-lab' }
  if (parts[0] === 'practice' && parts.length === 2) return { page: 'practice', area: parts[1] }
  if (parts[0] === 'exam' && parts.length === 2) return { page: 'exam', id: parts[1] }
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
    case 'agents-settings':
      return '#/settings/agents'
    case 'profile':
      return route.section === 'general' ? '#/profile' : `#/profile/${route.section}`
    case 'news':
      return '#/news'
    case 'a2ui-lab':
      return '#/a2ui-lab'
    case 'practice':
      return `#/practice/${route.area}`
    case 'exam':
      return `#/exam/${route.id}`
    case 'provider':
      return `#/settings/providers/${route.id}`
  }
}

// The last page opened outside Settings and its provider pages: where Settings' Back goes.
let outsideSettings: Route | null = null

export const isSettings = (route: Route) =>
  route.page === 'settings' ||
  route.page === 'provider' ||
  route.page === 'sign-in-settings' ||
  route.page === 'users-settings' ||
  route.page === 'data-settings' ||
  route.page === 'agents-settings'

function remember(route: Route): Route {
  if (!isSettings(route) && route.page !== 'profile') outsideSettings = route
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
