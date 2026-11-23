import { useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import { api, queryKeys, type Me } from '../api'
import { authErrorMessage, displayName, endSession, useMe } from '../lib/auth'
import { browserZone } from '../lib/time'
import { useUnsavedGuard } from '../lib/unsavedGuard'
import { Avatar } from './AccountMenu'
import { TimeZoneSelect } from './TimeZoneDialog'

const AVATAR_MAX_BYTES = 1024 * 1024
const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const TOO_BIG = 'The image is larger than 1 MB.'
const WRONG_TYPE = 'Use a PNG, JPEG or WebP image.'

const Problem = ({ text }: { text: string | null }) =>
  text ? (
    <p className="error" role="alert">
      {text}
    </p>
  ) : null

/** The time zone the app shows times in. */
function TimeZoneForm() {
  const me = useMe()
  const client = useQueryClient()
  const id = useId()
  const stored = me?.timezone ?? null
  // Until a zone is chosen the browser's zone is what the app shows, so it is what the field shows.
  const shown = stored ?? browserZone()
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const value = picked ?? shown
  // With none stored, saving the shown zone is a change too.
  const dirty = picked !== null && (picked !== shown || stored === null)
  useUnsavedGuard(dirty)

  const save = async () => {
    if (!dirty || busy || picked === null) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const next = await api.setTimezone(picked)
      client.setQueryData(queryKeys.me, next)
      setPicked(null)
      setSaved(true)
    } catch (e) {
      setError(authErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => {
    setPicked(null)
    setError(null)
  }

  return (
    <form
      className="provider-card"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      onKeyDown={(e) => e.key === 'Escape' && cancel()}
    >
      <label className="field" htmlFor={id}>
        Time zone
      </label>
      <TimeZoneSelect
        id={id}
        value={value}
        disabled={busy || !me}
        onChange={(zone) => {
          setSaved(false)
          setPicked(zone)
        }}
      />
      <p className="muted small">
        {stored === null
          ? "No time zone chosen yet: times show in this browser's zone."
          : 'Times in the app are shown in this time zone.'}
      </p>
      <div className="provider-actions">
        <button type="submit" className="primary" disabled={!dirty || busy}>
          Save
        </button>
        <button type="button" onClick={cancel} disabled={!dirty || busy}>
          Cancel
        </button>
        {saved && !dirty && <span className="muted">Saved.</span>}
      </div>
      <Problem text={error} />
    </form>
  )
}

/** Display name and bio, one Save. */
function DetailsForm({ me }: { me: Me }) {
  const client = useQueryClient()
  const nameId = useId()
  const bioId = useId()
  const [name, setName] = useState<string | null>(null)
  const [bio, setBio] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const storedName = me.display_name ?? ''
  const storedBio = me.bio ?? ''
  const nameValue = name ?? storedName
  const bioValue = bio ?? storedBio
  const dirty = nameValue !== storedName || bioValue !== storedBio
  useUnsavedGuard(dirty)

  const cancel = () => {
    setName(null)
    setBio(null)
    setError(null)
  }
  const save = async () => {
    if (!dirty || busy || !nameValue.trim()) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      client.setQueryData(queryKeys.me, await api.updateProfile(nameValue.trim(), bioValue))
      cancel()
      setSaved(true)
    } catch (e) {
      setError(authErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="provider-card"
      aria-label="Profile details"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      onKeyDown={(e) => e.key === 'Escape' && cancel()}
    >
      <label className="field" htmlFor={nameId}>
        Display name
      </label>
      <input
        id={nameId}
        value={nameValue}
        maxLength={80}
        disabled={busy}
        onChange={(e) => {
          setSaved(false)
          setName(e.target.value)
        }}
      />
      <label className="field" htmlFor={bioId}>
        Bio
      </label>
      <textarea
        id={bioId}
        value={bioValue}
        maxLength={500}
        rows={3}
        disabled={busy}
        onChange={(e) => {
          setSaved(false)
          setBio(e.target.value)
        }}
      />
      <div className="provider-actions">
        <button type="submit" className="primary" disabled={!dirty || busy || !nameValue.trim()}>
          Save
        </button>
        <button type="button" onClick={cancel} disabled={!dirty || busy}>
          Cancel
        </button>
        {saved && !dirty && <span className="muted">Saved.</span>}
      </div>
      <Problem text={error} />
    </form>
  )
}

/** Upload (checked here first, and again by the server) and remove. */
function AvatarSection({ me }: { me: Me }) {
  const client = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (call: () => Promise<Me>) => {
    setBusy(true)
    setError(null)
    try {
      client.setQueryData(queryKeys.me, await call())
    } catch (e) {
      setError(authErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const pick = (file: File | undefined) => {
    if (input.current) input.current.value = ''
    if (!file) return
    if (!AVATAR_TYPES.includes(file.type)) return setError(WRONG_TYPE)
    if (file.size > AVATAR_MAX_BYTES) return setError(TOO_BIG)
    void run(() => api.uploadAvatar(file))
  }
  return (
    <div className="provider-card" role="group" aria-label="Avatar">
      <Avatar user={me} />
      <div className="provider-actions">
        <label className="button-link">
          Upload picture
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            disabled={busy}
            aria-label="Avatar file"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </label>
        {me.avatar_url && (
          <button type="button" disabled={busy} onClick={() => void run(api.removeAvatar)}>
            Remove picture
          </button>
        )}
      </div>
      <p className="muted small">PNG, JPEG or WebP, up to 1 MB.</p>
      <Problem text={error} />
    </div>
  )
}

/** The email with its state, Verify email, and Change email (the change happens when the link is opened). */
function EmailSection({ me }: { me: Me }) {
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useUnsavedGuard(editing && value.trim() !== '')

  const call = async (run: () => Promise<{ message: string }>, done?: () => void) => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      setNote((await run()).message)
      done?.()
    } catch (e) {
      setError(authErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const close = () => {
    setEditing(false)
    setValue('')
    setError(null)
  }
  const valid = value.trim() !== '' && value.trim().toLowerCase() !== me.email.toLowerCase()
  return (
    <div className="provider-card" role="group" aria-label="Email">
      <p>
        {me.email} <span className="muted">{me.email_verified ? 'Verified' : 'Not verified'}</span>
      </p>
      {!editing && (
        <div className="provider-actions">
          {!me.email_verified && (
            <button type="button" disabled={busy} onClick={() => void call(api.resendVerification)}>
              Verify email
            </button>
          )}
          <button type="button" onClick={() => setEditing(true)}>
            Change email
          </button>
        </div>
      )}
      {editing && (
        <form
          className="provider-card-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid && !busy) void call(() => api.requestEmailChange(value.trim()), close)
          }}
          onKeyDown={(e) => e.key === 'Escape' && close()}
        >
          <label className="field" htmlFor={id}>
            New email
          </label>
          <input id={id} type="email" value={value} disabled={busy} onChange={(e) => setValue(e.target.value)} />
          <div className="provider-actions">
            <button type="submit" className="primary" disabled={!valid || busy}>
              Save
            </button>
            <button type="button" onClick={close} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {note && (
        <p className="muted" role="status">
          {note}
        </p>
      )}
      <Problem text={error} />
    </div>
  )
}

/** Members only: the typed email unlocks the button. */
function DeleteAccount({ me }: { me: Me }) {
  const id = useId()
  const client = useQueryClient()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.deleteAccount(typed)
      // The session is already gone on the server: only the browser is reset.
      endSession(client)
    } catch (e) {
      setError(authErrorMessage(e))
      setBusy(false)
    }
  }
  return (
    <form
      className="provider-card danger-card"
      aria-label="Delete account"
      onSubmit={(e) => {
        e.preventDefault()
        if (typed === me.email && !busy) void remove()
      }}
    >
      <h2>Delete account</h2>
      <p className="muted small">
        This removes your account, sessions and all of your notes, lessons, providers and chats. It cannot be undone.
      </p>
      <label className="field" htmlFor={id}>
        Type {me.email} to confirm
      </label>
      <input id={id} value={typed} autoComplete="off" disabled={busy} onChange={(e) => setTyped(e.target.value)} />
      <div className="provider-actions">
        <button type="submit" disabled={typed !== me.email || busy}>
          Delete account
        </button>
      </div>
      <Problem text={error} />
    </form>
  )
}

/** Profile > General. */
export function ProfileGeneral() {
  const me = useMe()
  if (!me) return null
  return (
    <div className="profile-stack">
      <p className="muted">Signed in as {displayName(me)}.</p>
      <AvatarSection me={me} />
      <DetailsForm me={me} />
      <EmailSection me={me} />
      <TimeZoneForm />
      {me.role === 'member' && <DeleteAccount me={me} />}
    </div>
  )
}
