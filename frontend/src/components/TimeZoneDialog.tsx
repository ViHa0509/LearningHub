import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { api, queryKeys, type Me } from '../api'
import { authErrorMessage } from '../lib/auth'
import { browserZone } from '../lib/time'
import { dismissTimeZone, timeZoneDismissed, zoneChoices } from '../lib/timezonePrompt'

interface SelectProps {
  id: string
  value: string
  onChange: (zone: string) => void
  disabled?: boolean
}

/** The time zones the browser knows, as a select (the stored or the browser's zone is always listed). */
export function TimeZoneSelect({ id, value, onChange, disabled }: SelectProps) {
  const choices = useMemo(() => zoneChoices(value), [value])
  return (
    <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {choices.map((zone) => (
        <option key={zone} value={zone}>
          {zone}
        </option>
      ))}
    </select>
  )
}

/**
 * Opens over the signed-in app when the user has no time zone yet: proposes the browser's zone.
 * Save stores it; "Not now" and Escape close it without saving and keep it closed for this browser
 * session (the next sign-in asks again).
 */
export function TimeZoneDialog({ user }: { user: Me }) {
  const client = useQueryClient()
  const [dismissed, setDismissed] = useState(timeZoneDismissed)
  const [zone, setZone] = useState(browserZone)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectId = useId()
  const select = useRef<HTMLDivElement>(null)
  const open = user.timezone === null && !dismissed

  const notNow = () => {
    dismissTimeZone()
    setDismissed(true)
  }
  const notNowRef = useRef(notNow)
  useEffect(() => {
    notNowRef.current = notNow
  })

  useEffect(() => {
    if (!open) return
    select.current?.querySelector('select')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') notNowRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const save = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const next = await api.setTimezone(zone)
      client.setQueryData(queryKeys.me, next)
    } catch (e) {
      setError(authErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${selectId}-title`}
        className="dialog timezone-dialog"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <h2 id={`${selectId}-title`}>Your time zone</h2>
        <p className="muted">Times in the app are shown in this time zone. You can change it later in Settings.</p>
        <div ref={select} className="timezone-field">
          <label className="field" htmlFor={selectId}>
            Time zone
          </label>
          <TimeZoneSelect id={selectId} value={zone} onChange={setZone} disabled={busy} />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={notNow} disabled={busy}>
            Not now
          </button>
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
