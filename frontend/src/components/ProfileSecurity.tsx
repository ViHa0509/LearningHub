import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { api, queryKeys, type Me, type OAuthProvider } from '../api'
import { authErrorMessage, useMe } from '../lib/auth'
import { useHash } from '../lib/authRoute'
import { useTime } from '../lib/time'
import { useUnsavedGuard } from '../lib/unsavedGuard'

const MIN_PASSWORD = 10
const PROVIDERS: { id: OAuthProvider; label: string }[] = [
  { id: 'github', label: 'GitHub' },
  { id: 'google', label: 'Google' },
]
const LINK_ERRORS: Record<string, string> = {
  identity_taken: 'That account is already used by another Learning Hub account.',
  already_linked: 'That account is already linked.',
  state_mismatch: 'The sign-in could not be checked. Try linking again.',
  not_configured: 'That sign-in method is not set up on this server.',
  access_denied: 'The sign-in was cancelled.',
  provider_error: 'The provider could not complete the sign-in. Try again.',
}

const Problem = ({ text }: { text: string | null }) =>
  text ? (
    <p className="error" role="alert">
      {text}
    </p>
  ) : null

/** Change the password, or set one when the account has none (the server then needs no current one). */
function PasswordForm({ me }: { me: Me }) {
  const client = useQueryClient()
  const currentId = useId()
  const newId = useId()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = current !== '' || next !== ''
  useUnsavedGuard(dirty)
  const ready = next.length >= MIN_PASSWORD && (!me.has_password || current !== '')
  const clear = () => {
    setCurrent('')
    setNext('')
    setError(null)
  }
  const save = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      clear()
      setDone(true)
      // Other sessions end; the account may have gained a password.
      void client.invalidateQueries({ queryKey: queryKeys.me })
      void client.invalidateQueries({ queryKey: queryKeys.authSessions })
    },
    onError: (e) => setError(authErrorMessage(e)),
  })
  return (
    <form
      className="provider-card"
      aria-label="Password"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !save.isPending) {
          setDone(false)
          save.mutate()
        }
      }}
      onKeyDown={(e) => e.key === 'Escape' && clear()}
    >
      <h2>{me.has_password ? 'Change password' : 'Set a password'}</h2>
      {me.has_password && (
        <>
          <label className="field" htmlFor={currentId}>
            Current password
          </label>
          <input
            id={currentId}
            type="password"
            autoComplete="current-password"
            value={current}
            disabled={save.isPending}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </>
      )}
      <label className="field" htmlFor={newId}>
        New password
      </label>
      <input
        id={newId}
        type="password"
        autoComplete="new-password"
        value={next}
        disabled={save.isPending}
        onChange={(e) => setNext(e.target.value)}
      />
      <p className="muted small">At least {MIN_PASSWORD} characters. Other sessions are logged out.</p>
      <div className="provider-actions">
        <button type="submit" className="primary" disabled={!ready || save.isPending}>
          Save
        </button>
        <button type="button" onClick={clear} disabled={!dirty || save.isPending}>
          Cancel
        </button>
        {done && !dirty && <span className="muted">Saved.</span>}
      </div>
      <Problem text={error} />
    </form>
  )
}

/** The message after the provider's redirect back to `#/profile/security?linked=...` or `?error=...`. */
function useLinkResult(): { text: string; error: boolean } | null {
  const client = useQueryClient()
  const query = new URLSearchParams(useHash().split('?')[1] ?? '')
  const linked = query.get('linked')
  const error = query.get('error')
  useEffect(() => {
    if (linked) void client.invalidateQueries({ queryKey: queryKeys.me })
  }, [linked, client])
  if (linked) {
    const label = PROVIDERS.find((p) => p.id === linked)?.label ?? linked
    return { text: `${label} is linked.`, error: false }
  }
  if (error) return { text: LINK_ERRORS[error] ?? 'The sign-in could not be completed.', error: true }
  return null
}

function LinkedMethods({ me }: { me: Me }) {
  const client = useQueryClient()
  const status = useQuery({ queryKey: queryKeys.authStatus, queryFn: api.authStatus, staleTime: 60_000 })
  const result = useLinkResult()
  const [error, setError] = useState<string | null>(null)
  const unlink = useMutation({
    mutationFn: api.unlinkIdentity,
    onMutate: () => setError(null),
    onSuccess: (next) => client.setQueryData(queryKeys.me, next),
    onError: (e) => setError(authErrorMessage(e)),
  })
  return (
    <div className="provider-card" role="group" aria-label="Sign-in methods">
      <h2>Sign-in methods</h2>
      <ul>
        {me.has_password && <li>Password</li>}
        {PROVIDERS.map(({ id, label }) => {
          const linked = me.linked.includes(id)
          return (
            <li key={id}>
              {label} <span className="muted">{linked ? 'Linked' : 'Not linked'}</span>{' '}
              {linked ? (
                <button type="button" disabled={unlink.isPending} aria-label={`Unlink ${label}`} onClick={() => unlink.mutate(id)}>
                  Unlink
                </button>
              ) : (
                status.data?.providers[id].configured && (
                  <a className="button-link" href={api.oauthLinkUrl(id)} aria-label={`Link ${label}`}>
                    Link
                  </a>
                )
              )}
            </li>
          )
        })}
      </ul>
      {result && (result.error ? <Problem text={result.text} /> : <p role="status">{result.text}</p>)}
      <Problem text={error} />
    </div>
  )
}

function Sessions() {
  const client = useQueryClient()
  const time = useTime()
  const [error, setError] = useState<string | null>(null)
  const list = useQuery({ queryKey: queryKeys.authSessions, queryFn: api.authSessions })
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.authSessions })
  const revoke = useMutation({
    mutationFn: api.revokeAuthSession,
    onMutate: () => setError(null),
    onSuccess: refresh,
    onError: (e) => setError(authErrorMessage(e)),
  })
  const others = useMutation({
    mutationFn: api.logoutOthers,
    onMutate: () => setError(null),
    onSuccess: refresh,
    onError: (e) => setError(authErrorMessage(e)),
  })
  const rows = list.data ?? []
  return (
    <div className="provider-card" role="group" aria-label="Sessions">
      <h2>Sessions</h2>
      <ul className="session-list">
        {rows.map((s) => (
          <li key={s.id} className="session-row">
            <div>
              <div>
                {s.user_agent ?? 'Unknown device'}
                {s.ip ? `, ${s.ip}` : ''}
              </div>
              <div className="muted small">
                Last seen {time.dateTime(s.last_seen_at)}
                {s.current && (
                  <>
                    {' - '}
                    <span>This session</span>
                  </>
                )}
              </div>
            </div>
            {!s.current && (
              <button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}>
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
      {list.isError && <Problem text={authErrorMessage(list.error)} />}
      <div className="provider-actions">
        <button
          type="button"
          disabled={others.isPending || !rows.some((s) => !s.current)}
          onClick={() => others.mutate()}
        >
          Log out everywhere else
        </button>
      </div>
      <Problem text={error} />
    </div>
  )
}

/** Profile > Security. */
export function ProfileSecurity() {
  const me = useMe()
  if (!me) return null
  return (
    <div className="profile-stack">
      <PasswordForm me={me} />
      <LinkedMethods me={me} />
      <Sessions />
    </div>
  )
}
