import { useEffect, useRef, useState } from 'react'
import { api, type Me } from '../api'
import { authErrorMessage, displayName, initials, useLogout } from '../lib/auth'
import { Icon } from './Icon'

export function Avatar({ user }: { user: Me }) {
  const [failed, setFailed] = useState<string | null>(null)
  // A picture that does not load falls back to the initials until the address changes.
  if (user.avatar_url && failed !== user.avatar_url) {
    return (
      <img
        className="avatar"
        src={user.avatar_url}
        alt=""
        width="28"
        height="28"
        onError={() => setFailed(user.avatar_url)}
      />
    )
  }
  return (
    <span className="avatar" aria-hidden="true">
      {initials(user)}
    </span>
  )
}

/** The avatar and name in the top bar, opening Settings, Log out and (unverified) Verify your email. */
export function AccountMenu({ user }: { user: Me }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
  const [sending, setSending] = useState(false)
  const logout = useLogout()
  const box = useRef<HTMLDivElement>(null)
  const name = displayName(user)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const resend = async () => {
    setSending(true)
    try {
      const answer = await api.resendVerification()
      setNote({ text: answer.message, error: false })
    } catch (error) {
      setNote({ text: authErrorMessage(error), error: true })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="account" ref={box}>
      <button
        type="button"
        className="account-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu: ${name}`}
        onClick={() => setOpen(!open)}
      >
        <Avatar user={user} />
        <span className="account-name">{name}</span>
      </button>
      {open && (
        <div className="account-popover">
          <p className="account-email muted">{user.email}</p>
          <p className="account-role muted small">{user.role === 'admin' ? 'Admin' : 'Member'}</p>
          <div role="menu" aria-label="Account">
            {!user.email_verified && (
              <button type="button" role="menuitem" className="account-verify" disabled={sending} onClick={resend}>
                Verify your email
              </button>
            )}
            <a role="menuitem" href="#/profile" onClick={() => setOpen(false)}>
              Profile
            </a>
            <a role="menuitem" href="#/settings" onClick={() => setOpen(false)}>
              <Icon name="settings" />
              Settings
            </a>
            <a role="menuitem" className="account-lab" href="#/a2ui-lab" onClick={() => setOpen(false)}>
              A2UI Lab
            </a>
            <button type="button" role="menuitem" onClick={() => void logout()}>
              Log out
            </button>
          </div>
          {note && (
            <p className={note.error ? 'account-note error' : 'account-note muted'} role="status">
              {note.text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
