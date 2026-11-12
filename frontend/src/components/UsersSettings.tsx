import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api, queryKeys, type AdminUser, type Invitation } from '../api'
import { authErrorMessage, useMe } from '../lib/auth'
import { useUnsavedGuard } from '../lib/unsavedGuard'
import { SettingsNav } from './SettingsNav'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const OUTBOX_NOTE = 'Email is not configured: the link was written to storage/outbox on the server.'

const day = (iso: string) => new Date(iso).toLocaleDateString()

/** Settings > Users (admin only): invite people, see pending invitations, manage members. */
export function UsersSettings() {
  const me = useMe()
  const users = useQuery({ queryKey: queryKeys.adminUsers, queryFn: api.adminUsers })
  const invitations = useQuery({ queryKey: queryKeys.adminInvitations, queryFn: api.adminInvitations })
  return (
    <section className="settings-page" aria-label="Users">
      <SettingsNav current="users" />
      <div className="settings-header">
        <h1>Users</h1>
      </div>
      <p className="muted">
        Accounts are by invitation only. Each person has their own notes, lessons and providers; roadmaps and news are
        shared.
      </p>
      <InviteForm />
      <PendingInvitations invitations={invitations.data} failed={invitations.isError} />
      <UsersTable users={users.data} failed={users.isError} selfId={me?.id ?? null} />
    </section>
  )
}

function InviteForm() {
  const client = useQueryClient()
  const status = useQuery({ queryKey: queryKeys.authStatus, queryFn: api.authStatus, staleTime: 60_000 })
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const address = email.trim()
  const valid = EMAIL.test(address)
  useUnsavedGuard(email !== '')

  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    setSent(null)
    setLink(null)
    setCopied(false)
    try {
      const invitation = await api.invite(address)
      setSent(invitation.email)
      setLink(invitation.invite_url ?? null)
      setEmail('')
      await client.invalidateQueries({ queryKey: queryKeys.adminInvitations })
    } catch (failure) {
      setError(authErrorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy. Select the link and copy it by hand.')
    }
  }

  const cancel = () => {
    setEmail('')
    setError(null)
  }

  return (
    <section className="provider-card" aria-label="Invite">
      <h2>Invite someone</h2>
      <form
        className="provider-card-form"
        onSubmit={(e) => void send(e)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel()
        }}
        noValidate
      >
        <label className="field" htmlFor="invite-email">
          Email
        </label>
        <input
          id="invite-email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setSent(null)
            setLink(null)
          }}
        />
        <div className="provider-actions">
          <button type="submit" className="primary" disabled={!valid || busy}>
            Send invitation
          </button>
          <button type="button" onClick={cancel} disabled={email === '' || busy}>
            Cancel
          </button>
        </div>
      </form>
      {sent && (
        <div role="status">
          <p>Invitation sent to {sent}</p>
          {link ? (
            <>
              <p className="muted small">No email server is set up: send this link to {sent}.</p>
              <label className="field" htmlFor="invite-link">
                Invitation link
              </label>
              <div className="copy-row">
                <input id="invite-link" type="text" readOnly value={link} />
                <button type="button" onClick={() => void copy(link)}>
                  Copy
                </button>
                {copied && <span className="muted small">Copied</span>}
              </div>
            </>
          ) : (
            status.data?.mail.mode === 'outbox' && <p className="muted small">{OUTBOX_NOTE}</p>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function PendingInvitations({ invitations, failed }: { invitations: Invitation[] | undefined; failed: boolean }) {
  const client = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const revoke = async (invitation: Invitation) => {
    if (!window.confirm(`Revoke the invitation for ${invitation.email}? The link stops working.`)) return
    setError(null)
    try {
      await api.revokeInvitation(invitation.id)
      await client.invalidateQueries({ queryKey: queryKeys.adminInvitations })
    } catch (failure) {
      setError(authErrorMessage(failure))
    }
  }

  return (
    <section className="agents-section" aria-label="Pending invitations">
      <h2>Pending invitations</h2>
      {failed && <p className="error">Could not load the invitations.</p>}
      {invitations && invitations.length === 0 && <p className="muted">No pending invitations.</p>}
      {invitations && invitations.length > 0 && (
        <ul className="plain-list">
          {invitations.map((invitation) => (
            <li key={invitation.id}>
              <span>{invitation.email}</span> <span className="muted small">expires {day(invitation.expires_at)}</span>{' '}
              <button type="button" onClick={() => void revoke(invitation)} aria-label={`Revoke ${invitation.email}`}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function UsersTable({ users, failed, selfId }: { users: AdminUser[] | undefined; failed: boolean; selfId: string | null }) {
  const client = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AdminUser | null>(null)

  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.adminUsers })

  const toggle = async (user: AdminUser) => {
    const action = user.disabled ? 'Enable' : 'Disable'
    const text = user.disabled
      ? `Enable ${user.email}? They can sign in again.`
      : `Disable ${user.email}? They are signed out at once and cannot sign in.`
    if (!window.confirm(text)) return
    setError(null)
    try {
      await api.setUserDisabled(user.id, !user.disabled)
      await refresh()
    } catch (failure) {
      setError(`${action} failed: ${authErrorMessage(failure)}`)
    }
  }

  return (
    <section className="agents-section" aria-label="All users">
      <h2>All users</h2>
      {failed && <p className="error">Could not load the users.</p>}
      {users && (
        <div className="users-table-scroll">
          <table className="users-table">
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Last seen</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const own = user.id === selfId
                return (
                  <tr key={user.id}>
                    <td>{user.email}</td>
                    <td>{user.display_name ?? ''}</td>
                    <td>{user.role === 'admin' ? 'Admin' : 'Member'}</td>
                    <td>{user.last_seen_at ? day(user.last_seen_at) : 'Never'}</td>
                    <td>{user.disabled ? 'Disabled' : 'Active'}</td>
                    <td>
                      {own ? (
                        <span className="tag on">You</span>
                      ) : user.role === 'member' ? (
                        <>
                          <button type="button" onClick={() => void toggle(user)} aria-label={`${user.disabled ? 'Enable' : 'Disable'} ${user.email}`}>
                            {user.disabled ? 'Enable' : 'Disable'}
                          </button>{' '}
                          <button type="button" onClick={() => setDeleting(user)} aria-label={`Delete ${user.email}`}>
                            Delete
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {deleting && (
        <DeleteBox
          user={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            setDeleting(null)
            await refresh()
          }}
        />
      )}
    </section>
  )
}

function DeleteBox({ user, onClose, onDeleted }: { user: AdminUser; onClose: () => void; onDeleted: () => Promise<void> }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const matches = typed.trim().toLowerCase() === user.email.toLowerCase()

  const remove = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!matches || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteUser(user.id, user.email)
      await onDeleted()
    } catch (failure) {
      setError(authErrorMessage(failure))
      setBusy(false)
    }
  }

  return (
    <div
      className="provider-card"
      role="dialog"
      aria-label={`Delete ${user.email}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <p>
        This deletes {user.email} and all their notes, lessons and providers. It cannot be undone. Type their email to
        confirm.
      </p>
      <form className="provider-card-form" onSubmit={(e) => void remove(e)}>
        <label className="field" htmlFor="delete-user-email">
          Type the email to confirm
        </label>
        <input
          id="delete-user-email"
          type="text"
          autoComplete="off"
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <div className="provider-actions">
          <button type="submit" className="primary" disabled={!matches || busy}>
            Delete user
          </button>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
