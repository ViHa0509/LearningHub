import { useEffect, useState } from 'react'

export type Route =
  | { page: 'home' }
  | { page: 'roadmap'; domain: string }
  | { page: 'lesson'; domain: string; node: string }
  | { page: 'note'; id: string }
  | { page: 'settings' }
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
    case 'provider':
      return `#/settings/providers/${route.id}`
  }
}

export function navigate(route: Route) {
  window.location.hash = routeHash(route)
}

/** The current page, from the URL hash; follows back/forward and links. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}
