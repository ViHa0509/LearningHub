import { useQuery, useQueryClient, type Query } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { ApiError, api, queryKeys, type AuthStatus, type Me } from '../api'
import { forgetReturn, isAuthHash, returnRoute } from './authRoute'
import { onUnauthorized } from './failures'
import { mayLeave } from './route'
import { confirmUnsaved } from './unsavedGuard'

/** Queries holding the user's data (everything but auth and the health check). */
const isDataQuery = (query: Query) => query.queryKey[0] !== queryKeys.auth[0] && query.queryKey[0] !== queryKeys.health[0]

export interface AuthState {
  status: AuthStatus | undefined
  /** The status could not be read (an outage): the app shows, and the outage page takes over. */
  statusFailed: boolean
  required: boolean
  /** undefined while loading or not asked (auth not required); null without a session. */
  me: Me | null | undefined
  meFailed: boolean
}

/**
 * The session gate's data: the public status, and `me` when a session is required. A 401 from any
 * app route (reported by api.ts) reloads both, so an ended session shows the login page.
 */
export function useAuth(): AuthState {
  const client = useQueryClient()
  const status = useQuery({
    queryKey: queryKeys.authStatus,
    queryFn: api.authStatus,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  const required = status.data?.auth_required ?? false
  const me = useQuery({
    queryKey: queryKeys.me,
    queryFn: api.me,
    enabled: required,
    retry: false,
    staleTime: 60_000,
  })

  // Remembered, so the next visit waits for the status instead of showing the app first.
  useEffect(() => {
  }, [status.data])

  useEffect(
    () =>
      onUnauthorized(() => {
        void client.invalidateQueries({ queryKey: queryKeys.auth }, { cancelRefetch: false })
      }),
    [client],
  )

  return {
    status: status.data,
    statusFailed: status.isError,
    required,
    me: required ? me.data : undefined,
    meFailed: required && me.isError,
  }
}

/** After a sign-in (password, sign-up, reset, magic link): store the user and go back to the page. */
export function useSignedIn(): (user: Me) => void {
  const client = useQueryClient()
  return useCallback(
    (user: Me) => {
      client.setQueryData(queryKeys.me, user)
      client.setQueryData<AuthStatus>(queryKeys.authStatus, (old) => old && { ...old, has_owner: true })
      // Data that failed with 401 (or belongs to an earlier session) loads again.
      void client.invalidateQueries({ predicate: isDataQuery })
      const target = returnRoute()
      forgetReturn()
      if (isAuthHash(window.location.hash)) window.location.hash = target
    },
    [client],
  )
}

/** The signed-in user from the session cache (no request); undefined until known or without a session. */
export function useMe(): Me | null | undefined {
  return useQuery({ queryKey: queryKeys.me, queryFn: api.me, enabled: false }).data
}

/** False only for a signed-in member; without a required session the app is the admin's. */
export function useIsAdmin(): boolean {
  return useMe()?.role !== 'member'
}

/** Logs out (after asking about unsaved changes) and shows the login page. */
export function useLogout(): () => Promise<void> {
  const client = useQueryClient()
  return useCallback(async () => {
    if (!mayLeave() || !confirmUnsaved()) return
    try {
      await api.logout()
    } catch (error) {
      // An outage: the session may still be valid, so stay; the outage page explains.
      if (!(error instanceof ApiError) || error.status >= 500) return
    }
    forgetReturn()
    client.setQueryData(queryKeys.me, null)
    // Nothing of the user's data stays in memory after logging out.
    client.removeQueries({ predicate: isDataQuery })
    window.location.hash = '#/auth/login'
  }, [client])
}

/** The text to show for a failed auth request: the server's message, or a reachability note. */
export function authErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status >= 500) return 'Something went wrong on the server. Try again.'
    return error.message
  }
  return 'Could not reach the server. Try again.'
}

/** The name shown for the Owner: the display name, else the email. */
export const displayName = (user: Me) => user.display_name?.trim() || user.email

/** Up to two initials from the display name, else the first letter of the email. */
export function initials(user: Me): string {
  const words = (user.display_name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length > 0) return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return (user.email[0] ?? '?').toUpperCase()
}
