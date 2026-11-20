import { useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { api, queryKeys } from '../api'
import { authErrorMessage, useMe } from '../lib/auth'
import { browserZone } from '../lib/time'
import { useUnsavedGuard } from '../lib/unsavedGuard'
import { SettingsNav } from './SettingsNav'
import { TimeZoneSelect } from './TimeZoneDialog'

/** Settings > Account: the time zone the app shows times in. */
export function AccountSettings() {
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
    <section className="settings-page" aria-label="Account">
      <SettingsNav current="account" />
      <div className="settings-header">
        <h1>Account</h1>
      </div>
      <form
        className="provider-card-form"
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
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  )
}
