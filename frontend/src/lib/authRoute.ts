import { useEffect, useState } from 'react'

export type AuthPage = 'login' | 'create' | 'signup' | 'forgot' | 'reset' | 'magic' | 'verify' | 'invite'

export interface AuthRoute {
  page: AuthPage
  /** The hash query (`#/auth/reset?token=...`): tokens and OAuth error codes. */
  params: URLSearchParams
}

const PAGES: AuthPage[] = ['login', 'create', 'signup', 'forgot', 'reset', 'magic', 'verify', 'invite']

/** An auth page address (`#/auth/<page>[?query]`), or null for any other hash. */
export function parseAuthRoute(hash: string): AuthRoute | null {
  const match = hash.match(/^#\/auth\/([a-z]+)\/?(?:\?(.*))?$/)
  if (!match || !PAGES.includes(match[1] as AuthPage)) return null
  return { page: match[1] as AuthPage, params: new URLSearchParams(match[2] ?? '') }
}

export const isAuthHash = (hash: string) => hash.startsWith('#/auth/') || hash === '#/auth'

/** The raw URL hash; follows hash changes (not replaceState, which pages use to drop a used token). */
export function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const update = () => setHash(window.location.hash)
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return hash
}

// Where the user goes back to after signing in: the app page that asked for a session.
const RETURN_KEY = 'lh-return-to'
let returnTo: string | null = null

const isAppHash = (hash: string) => /^#\/[^\s\\]*$/.test(hash) && !isAuthHash(hash) && hash.length <= 500

/** Remembers the app page to come back to after sign-in (auth pages are never remembered). */
export function rememberReturn(hash: string) {
  const value = hash || '#/'
  if (!isAppHash(value)) return
  returnTo = value
  try {
    sessionStorage.setItem(RETURN_KEY, value)
  } catch {
    // Storage blocked: the in-memory value still works in this tab.
  }
}

/** The page to come back to after sign-in; home when none was remembered. */
export function returnRoute(): string {
  if (returnTo) return returnTo
  try {
    const stored = sessionStorage.getItem(RETURN_KEY)
    if (stored && isAppHash(stored)) return stored
  } catch {
    // ignore
  }
  return '#/'
}

/** Forgets the remembered page (after sign-in, and between tests). */
export function forgetReturn() {
  returnTo = null
  try {
    sessionStorage.removeItem(RETURN_KEY)
  } catch {
    // ignore
  }
}

/** Removes a used token (or error code) from the address bar without a navigation. */
export function dropQuery(page: AuthPage) {
  window.history.replaceState(null, '', `#/auth/${page}`)
}
