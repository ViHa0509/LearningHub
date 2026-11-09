import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, api, queryKeys, type OAuthProvider, type SignInProvider } from '../api'
import { useUnsavedGuard } from '../lib/unsavedGuard'
import { SettingsNav } from './SettingsNav'

const SOURCE_TEXT = { app: 'Set in the app', env: 'From the environment' } as const

interface Guide {
  label: string
  linkText: string
  href: string
  steps: (publicUrl: string) => string[]
}

const GUIDES: Record<OAuthProvider, Guide> = {
  github: {
    label: 'GitHub',
    linkText: 'GitHub developer settings',
    href: 'https://github.com/settings/developers',
    steps: (publicUrl) => [
      `Open GitHub developer settings, choose "New OAuth App" and set the Homepage URL to ${publicUrl}.`,
      'Paste the callback URL below as the Authorization callback URL, then copy the Client ID and a new Client secret here.',
    ],
  },
  google: {
    label: 'Google',
    linkText: 'Google Cloud credentials',
    href: 'https://console.cloud.google.com/apis/credentials',
    steps: () => [
      'Open Google Cloud credentials and choose "Create credentials -> OAuth client ID -> Web application".',
      'Add the callback URL below as an Authorized redirect URI, then copy the Client ID and Client secret here.',
    ],
  },
}

const ORDER: OAuthProvider[] = ['github', 'google']

/** Settings > Sign-in: the GitHub and Google client setup, saved in the app. */
export function SignInSettings() {
  const settings = useQuery({ queryKey: queryKeys.signInSettings, queryFn: api.signInSettings })
  return (
    <section className="settings-page" aria-label="Sign-in">
      <SettingsNav current="sign-in" />
      <div className="settings-header">
        <h1>Sign-in</h1>
      </div>
      <p className="muted">
        Set up Continue with GitHub and Continue with Google. Saved values apply at once, without a restart, and win
        over the environment. Secrets are stored encrypted and never shown again.
      </p>
      {settings.isError && <p className="error">Could not load the sign-in settings.</p>}
      {settings.data && (
        <div className="provider-cards">
          {ORDER.map((name) => (
            <ProviderCard
              key={name}
              name={name}
              provider={settings.data.providers[name]}
              publicUrl={settings.data.public_url}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ProviderCard({ name, provider, publicUrl }: { name: OAuthProvider; provider: SignInProvider; publicUrl: string }) {
  const client = useQueryClient()
  const guide = GUIDES[name]
  const [clientId, setClientId] = useState(provider.client_id ?? '')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = clientId !== (provider.client_id ?? '') || secret !== ''
  useUnsavedGuard(dirty)
  const idField = `${name}-client-id`
  const secretField = `${name}-client-secret`

  const changed = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await action()
      // The login page offers the provider (or not) from the auth status.
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.signInSettings }),
        client.invalidateQueries({ queryKey: queryKeys.authStatus }),
      ])
      return true
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'The request failed')
      return false
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!dirty || busy) return
    const body = { client_id: clientId.trim(), ...(secret ? { client_secret: secret } : {}) }
    const ok = await changed(async () => {
      const next = await api.saveSignIn(name, body)
      setClientId(next.providers[name].client_id ?? '')
    })
    if (ok) {
      setSecret('')
      setSaved(true)
    }
  }

  const cancel = () => {
    setClientId(provider.client_id ?? '')
    setSecret('')
    setError(null)
  }

  const remove = async () => {
    if (!window.confirm(`Remove the ${guide.label} sign-in settings saved in the app?`)) return
    await changed(async () => {
      await api.removeSignIn(name)
      const next = await api.signInSettings()
      setClientId(next.providers[name].client_id ?? '')
      setSecret('')
    })
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(provider.callback_url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy. Select the address and copy it by hand.')
    }
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') cancel()
  }

  return (
    <article className="provider-card" aria-label={guide.label}>
      <header className="provider-header">
        <h2>{guide.label}</h2>
        <span className={provider.source ? 'tag on' : 'tag off'}>
          {provider.source ? SOURCE_TEXT[provider.source] : 'Not configured'}
        </span>
      </header>

      <ol className="steps">
        {guide.steps(publicUrl).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="small">
        <a href={guide.href} target="_blank" rel="noreferrer">
          {guide.linkText}
        </a>
      </p>

      <label className="field" htmlFor={`${name}-callback`}>
        Callback URL
      </label>
      <div className="copy-row">
        <input id={`${name}-callback`} type="text" readOnly value={provider.callback_url} />
        <button type="button" onClick={() => void copy()}>
          Copy
        </button>
        {copied && (
          <span className="muted small" role="status">
            Copied
          </span>
        )}
      </div>

      <form
        className="provider-card-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        onKeyDown={onKeyDown}
      >
        <label className="field" htmlFor={idField}>
          Client ID
        </label>
        <input id={idField} type="text" autoComplete="off" value={clientId} onChange={(e) => setClientId(e.target.value)} />
        <label className="field" htmlFor={secretField}>
          Client secret
        </label>
        <input
          id={secretField}
          type="password"
          autoComplete="new-password"
          value={secret}
          placeholder={provider.secret_hint ? `Saved: ${provider.secret_hint}` : ''}
          onChange={(e) => setSecret(e.target.value)}
        />
        <div className="provider-actions">
          <button type="submit" className="primary" disabled={!dirty || busy}>
            Save
          </button>
          <button type="button" onClick={cancel} disabled={!dirty || busy}>
            Cancel
          </button>
          {provider.source === 'app' && (
            <button type="button" onClick={() => void remove()} disabled={busy}>
              Remove
            </button>
          )}
          {saved && !dirty && <span className="muted">Saved.</span>}
        </div>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </article>
  )
}
