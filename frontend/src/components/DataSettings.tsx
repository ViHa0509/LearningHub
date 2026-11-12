import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, queryKeys, type RestoreResult } from '../api'
import { SettingsNav } from './SettingsNav'

const COUNT_LABELS: [keyof RestoreResult['counts'], string][] = [
  ['notes', 'notes'],
  ['files', 'files'],
  ['lessons', 'lessons'],
  ['providers', 'providers'],
]

const messageOf = (e: unknown) => (e instanceof Error ? e.message : 'The request failed')
const localTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '')

function ResultSummary({ title, result }: { title: string; result: RestoreResult }) {
  const parts = COUNT_LABELS.filter(([key]) => result.counts[key] !== undefined).map(
    ([key, label]) => `${result.counts[key]} ${label}`,
  )
  return (
    <div role="status">
      <p>
        {title}
        {parts.length > 0 && `: ${parts.join(', ')}.`}
      </p>
      {result.providers_needing_key.length > 0 && (
        <p>
          Enter the key again for: {result.providers_needing_key.join(', ')}. <a href="#/settings">Open AI providers</a>
        </p>
      )}
    </div>
  )
}

/** Settings > Data & sync: backup, restore and sync to another Learning Hub. */
export function DataSettings() {
  return (
    <section className="settings-page" aria-label="Data & sync">
      <SettingsNav current="data" />
      <div className="settings-header">
        <h1>Data &amp; sync</h1>
      </div>
      <div className="provider-cards">
        <BackupCard />
        <RestoreCard />
        <ReceiveCard />
        <SendCard />
      </div>
    </section>
  )
}

function BackupCard() {
  return (
    <article className="provider-card" aria-label="Backup">
      <header className="provider-header">
        <h2>Backup</h2>
      </header>
      <p className="muted small">
        A .zip with your notes and their files, lessons, links, AI provider settings and agent settings. API keys,
        passwords and sign-in secrets are not included.
      </p>
      <div className="provider-actions">
        <a className="button-link primary" href={api.backupUrl} download>
          Download backup
        </a>
      </div>
    </article>
  )
}

function RestoreCard() {
  const client = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [confirm, setConfirm] = useState('')
  const [progress, setProgress] = useState<{ part: number; parts: number } | null>(null)
  const restore = useMutation({
    mutationFn: (f: File) => {
      setProgress(null)
      return api.restoreBackup(f, setProgress)
    },
    // The data changed under every page.
    onSuccess: () => client.invalidateQueries(),
  })
  const ready = file !== null && confirm === 'REPLACE' && !restore.isPending

  return (
    <article className="provider-card" aria-label="Restore">
      <header className="provider-header">
        <h2>Restore</h2>
      </header>
      <p className="muted small">
        Replaces the notes, lessons, links and provider settings on this server with the backup&apos;s. An automatic
        backup of the replaced data is kept first.
      </p>
      <form
        className="provider-card-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && file) restore.mutate(file)
        }}
      >
        <label className="field" htmlFor="restore-file">
          Backup file
        </label>
        <input
          id="restore-file"
          type="file"
          accept=".zip"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null)
            restore.reset()
          }}
        />
        <label className="field" htmlFor="restore-confirm">
          Type REPLACE to confirm
        </label>
        <input
          id="restore-confirm"
          type="text"
          autoComplete="off"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <div className="provider-actions">
          <button type="submit" className="primary" disabled={!ready}>
            Restore
          </button>
          {restore.isPending && (
            <span className="muted" role="status">
              {progress ? `Uploading part ${progress.part} of ${progress.parts}` : 'Restoring…'}
            </span>
          )}
        </div>
      </form>
      {restore.data && <ResultSummary title="Restored" result={restore.data} />}
      {restore.isError && (
        <p className="error" role="alert">
          {messageOf(restore.error)}
        </p>
      )}
    </article>
  )
}

function ReceiveCard() {
  const client = useQueryClient()
  const status = useQuery({ queryKey: queryKeys.syncKey, queryFn: api.syncKeyStatus })
  // The key itself is shown once, from the answer of its creation; it is never read again.
  const [created, setCreated] = useState<{ key: string; expires_at: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.syncKey })
  const create = useMutation({
    mutationFn: api.createSyncKey,
    onSuccess: async (next) => {
      setError(null)
      setCopied(false)
      setCreated(next)
      await refresh()
    },
    onError: (e) => setError(messageOf(e)),
  })
  const revoke = useMutation({
    mutationFn: api.revokeSyncKey,
    onSuccess: async () => {
      setError(null)
      setCreated(null)
      await refresh()
    },
    onError: (e) => setError(messageOf(e)),
  })

  const copy = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.key)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy. Select the key and copy it by hand.')
    }
  }
  const askRevoke = () => {
    if (window.confirm('Revoke the sync key? Another Learning Hub can no longer send data here with it.')) {
      revoke.mutate()
    }
  }

  const expires = created?.expires_at ?? status.data?.expires_at ?? null
  const active = created !== null || status.data?.active === true

  return (
    <article className="provider-card" aria-label="Receive">
      <header className="provider-header">
        <h2>Receive</h2>
      </header>
      <p className="muted small">
        Create a sync key here, then enter this address and the key on the other Learning Hub to send its data to this
        one.
      </p>
      {created && (
        <>
          <label className="field" htmlFor="new-sync-key">
            Sync key
          </label>
          <div className="copy-row">
            <input id="new-sync-key" type="text" readOnly value={created.key} />
            <button type="button" onClick={() => void copy()}>
              Copy
            </button>
            {copied && (
              <span className="muted small" role="status">
                Copied
              </span>
            )}
          </div>
          <p className="muted small">Shown once. Copy it now.</p>
        </>
      )}
      {active && expires && (
        <p className="muted small">
          {created
            ? `Valid until ${localTime(expires)}; creating a new key replaces this one.`
            : `A sync key is active until ${localTime(expires)}.`}
        </p>
      )}
      {status.data && !active && <p className="muted small">No sync key is active.</p>}
      <div className="provider-actions">
        <button type="button" className="primary" onClick={() => create.mutate()} disabled={create.isPending}>
          Create sync key
        </button>
        {active && (
          <button type="button" onClick={askRevoke} disabled={revoke.isPending}>
            Revoke
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </article>
  )
}

function SendCard() {
  const [target, setTarget] = useState('')
  const [key, setKey] = useState('')
  const send = useMutation({
    mutationFn: ({ url, secret }: { url: string; secret: string }) => api.sendSync(url, secret),
    // The key is not kept after a send, whatever the outcome.
    onSettled: () => setKey(''),
  })
  const ready = target.trim() !== '' && key !== '' && !send.isPending

  return (
    <article className="provider-card" aria-label="Send">
      <header className="provider-header">
        <h2>Send</h2>
      </header>
      <p className="muted small">Send this server&apos;s data to another Learning Hub. It replaces the data there.</p>
      <form
        className="provider-card-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) send.mutate({ url: target.trim(), secret: key })
        }}
      >
        <label className="field" htmlFor="sync-target">
          Target address
        </label>
        <input
          id="sync-target"
          type="text"
          autoComplete="off"
          placeholder="https://hub.example.com"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <label className="field" htmlFor="sync-key">
          Sync key
        </label>
        <input
          id="sync-key"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <div className="provider-actions">
          <button type="submit" className="primary" disabled={!ready}>
            Send
          </button>
          {send.isPending && <span className="muted">Sending… this can take a while for large backups</span>}
        </div>
      </form>
      {send.data && <ResultSummary title="Sent" result={send.data} />}
      {send.isError && (
        <p className="error" role="alert">
          {messageOf(send.error)}
        </p>
      )}
    </article>
  )
}
