import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, queryKeys, type AgentProvider, type ProviderTest } from '../api'
import { useProviders } from '../hooks'

const OTHER = '__other__'

export function SettingsPage() {
  const providers = useProviders()
  return (
    <section className="settings-page" aria-label="Settings">
      <h1>AI providers</h1>
      <p className="muted">
        Paste a key to use the agent; it works at once, no restart needed. Keys are stored encrypted on this
        computer and never sent back to the browser. Usage is billed by the provider: set a spend limit in
        the provider's console.
      </p>
      {providers.isError && <p className="error">Could not load the providers. Is the backend running?</p>}
      <div className="provider-cards">
        {providers.data?.map((p) => <ProviderCard key={p.id} provider={p} />)}
      </div>
    </section>
  )
}

function statusText(p: AgentProvider): string {
  if (p.key_error) return `Saved key cannot be read: ${p.key_error}`
  if (!p.configured) return 'Not configured'
  const where =
    p.source === 'app'
      ? p.overrides_env
        ? 'Saved in app (overrides backend/.env)'
        : 'Saved in app'
      : 'From backend/.env'
  const what = p.key_hint ? ` · key ${p.key_hint}` : p.base_url ? ` · ${p.base_url}` : ''
  return `${where}${what}${p.enabled ? '' : ' · switched off'}`
}

function ProviderCard({ provider }: { provider: AgentProvider }) {
  const client = useQueryClient()
  const isUrl = provider.id === 'ollama'
  const inCatalog = provider.models.includes(provider.model)
  const [secret, setSecret] = useState('')
  const [url, setUrl] = useState(provider.base_url ?? '')
  const [choice, setChoice] = useState(inCatalog ? provider.model : OTHER)
  const [custom, setCustom] = useState(inCatalog ? '' : provider.model)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [test, setTest] = useState<ProviderTest | null>(null)

  const refresh = (next: AgentProvider) => {
    client.setQueryData<AgentProvider[]>(queryKeys.providers, (old) =>
      old?.map((p) => (p.id === next.id ? next : p)),
    )
  }

  const run = async (action: () => Promise<AgentProvider>) => {
    setBusy(true)
    setError(null)
    setSaved(false)
    setTest(null)
    try {
      refresh(await action())
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saving failed')
      return false
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    const model = choice === OTHER ? custom.trim() : choice
    const ok = await run(() =>
      api.saveProvider(provider.id, {
        ...(isUrl ? { base_url: url.trim() } : { api_key: secret.trim() }),
        model: model === provider.default_model ? '' : model,
      }),
    )
    if (ok) {
      setSecret('')
      setSaved(true)
    }
  }

  const runTest = async () => {
    setBusy(true)
    setError(null)
    setTest(null)
    try {
      setTest(await api.testProvider(provider.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test failed')
    } finally {
      setBusy(false)
    }
  }

  const fieldId = `provider-${provider.id}`
  const nothingToSave = !provider.configured && (isUrl ? !url.trim() : !secret.trim())

  return (
    <article className="provider-card" aria-label={provider.label}>
      <header className="provider-header">
        <h2>{provider.label}</h2>
        <label className="switch" title={provider.configured ? undefined : 'Save a key first'}>
          <input
            type="checkbox"
            checked={provider.enabled}
            disabled={busy || !provider.configured}
            onChange={(e) => void run(() => api.saveProvider(provider.id, { enabled: e.target.checked }))}
          />
          On
        </label>
      </header>
      <p className={provider.available ? 'provider-status ok' : 'provider-status'} role="status">
        {statusText(provider)}
      </p>

      {isUrl ? (
        <label className="field" htmlFor={`${fieldId}-url`}>
          Server URL
          <input
            id={`${fieldId}-url`}
            type="url"
            placeholder="http://localhost:11434"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
      ) : (
        <label className="field" htmlFor={`${fieldId}-key`}>
          API key
          <input
            id={`${fieldId}-key`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={provider.key_hint ? `Saved (${provider.key_hint}) - paste to replace` : 'Paste your key'}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </label>
      )}

      <label className="field" htmlFor={`${fieldId}-model`}>
        Model
        <select id={`${fieldId}-model`} value={choice} onChange={(e) => setChoice(e.target.value)}>
          {provider.models.map((m) => (
              <option key={m} value={m}>
                {m}
                {m === provider.default_model ? ' (default)' : ''}
              </option>
            ))}
          <option value={OTHER}>Other model id…</option>
        </select>
      </label>
      {choice === OTHER && (
        <label className="field" htmlFor={`${fieldId}-custom`}>
          Model id
          <input
            id={`${fieldId}-custom`}
            placeholder="e.g. claude-sonnet-5-5"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        </label>
      )}

      <div className="provider-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void save()}
          disabled={busy || nothingToSave || (choice === OTHER && !custom.trim())}
        >
          Save
        </button>
        <button type="button" onClick={() => void runTest()} disabled={busy || !provider.configured}>
          Test
        </button>
        {provider.source === 'app' && (
          <button
            type="button"
            className="danger"
            onClick={() => void run(() => api.removeProvider(provider.id))}
            disabled={busy}
          >
            Remove
          </button>
        )}
        {busy && <span className="muted">Working…</span>}
        {saved && <span className="muted">Saved.</span>}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {test && (
        <p className={test.ok ? 'test-result ok' : 'test-result error'} role="alert">
          {test.ok
            ? `Test passed: ${test.model} answered in ${test.latency_ms} ms.`
            : `Test failed (${test.model}): ${test.message}`}
        </p>
      )}
      {!isUrl && (
        <p className="muted small">
          Or set <code>{provider.setting}</code> in <code>backend/.env</code>.
        </p>
      )}
    </article>
  )
}
