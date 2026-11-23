import { useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { api, queryKeys, type AnswerLanguage, type Effort, type Me } from '../api'
import { EFFORTS } from '../lib/agentPrefs'
import { authErrorMessage, useMe } from '../lib/auth'
import { useUnsavedGuard } from '../lib/unsavedGuard'

const LANGUAGES: { id: AnswerLanguage; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'en', label: 'English' },
  { id: 'vi', label: 'Vietnamese' },
]

function PreferencesForm({ me }: { me: Me }) {
  const client = useQueryClient()
  const langId = useId()
  const effortId = useId()
  const [language, setLanguage] = useState<AnswerLanguage | null>(null)
  const [effort, setEffort] = useState<Effort | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stored = me.preferences
  const lang = language ?? stored.answer_language
  const eff = effort ?? stored.default_effort
  const dirty = lang !== stored.answer_language || eff !== stored.default_effort
  useUnsavedGuard(dirty)
  const cancel = () => {
    setLanguage(null)
    setEffort(null)
    setError(null)
  }
  const save = async () => {
    if (!dirty || busy) return
    setBusy(true)
    setError(null)
    try {
      client.setQueryData(queryKeys.me, await api.setPreferences({ answer_language: lang, default_effort: eff }))
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
      aria-label="Preferences"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      onKeyDown={(e) => e.key === 'Escape' && cancel()}
    >
      <label className="field" htmlFor={langId}>
        Answer language
      </label>
      <select
        id={langId}
        value={lang}
        disabled={busy}
        onChange={(e) => {
          setSaved(false)
          setLanguage(e.target.value as AnswerLanguage)
        }}
      >
        {LANGUAGES.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
      <p className="muted small">
        {lang === 'auto' ? 'Auto answers in the language you write in.' : `The agent answers in ${LANGUAGES.find((l) => l.id === lang)?.label}.`}
      </p>
      <label className="field" htmlFor={effortId}>
        Default effort
      </label>
      <select
        id={effortId}
        value={eff}
        disabled={busy}
        onChange={(e) => {
          setSaved(false)
          setEffort(e.target.value as Effort)
        }}
      >
        {EFFORTS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <p className="muted small">The effort a new chat starts with, on every device.</p>
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
  )
}

/** Profile > Preferences. */
export function ProfilePreferences() {
  const me = useMe()
  return me ? <PreferencesForm me={me} /> : null
}
