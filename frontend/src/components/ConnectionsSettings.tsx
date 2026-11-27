import { useEffect, useState } from 'react'
import { api, ApiError, type GithubStatus, type KhStatus } from '../api'

/** The GitHub card: an optional token that raises GitHub's rate limit for the roadmap.sh tools. */
function GithubCard() {
  const [info, setInfo] = useState<GithubStatus | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api
      .github()
      .then((out) => live && setInfo(out))
      .catch(() => live && setError('Could not load the GitHub token.'))
    return () => {
      live = false
    }
  }, [])

  const cancel = () => {
    setToken('')
    setError(null)
    setReplacing(false)
  }

  const save = async () => {
    if (!token.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      setInfo(await api.saveGithub(token.trim()))
      setToken('')
      setReplacing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request failed') // the field keeps its text
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm('Remove the GitHub token? The assistant goes back to the anonymous GitHub limit.')) return
    setBusy(true)
    setError(null)
    try {
      await api.removeGithub()
      setInfo({ saved: false, hint: null })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request failed')
    } finally {
      setBusy(false)
    }
  }

  const showField = info !== null && (!info.saved || replacing)
  return (
    <div className="provider-cards">
      <article className="provider-card" aria-label="GitHub">
        <header className="provider-header">
          <h3 className="agent-name">GitHub</h3>
        </header>
        {!info && !error && <p className="muted small">Loading…</p>}
        {showField && (
          <>
            <p className="muted small">
              Optional. The assistant reads roadmap.sh&apos;s public repository on GitHub; a token raises GitHub&apos;s
              limit of 60 requests per hour. A fine-grained token with no permissions is enough.
            </p>
            <label className="field">
              GitHub token
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save()
                  else if (e.key === 'Escape') cancel()
                }}
              />
            </label>
            <div className="provider-actions">
              <button type="button" className="primary" onClick={() => void save()} disabled={busy || !token.trim()}>
                Save
              </button>
              <button type="button" onClick={cancel} disabled={busy}>
                Cancel
              </button>
            </div>
          </>
        )}
        {info?.saved && !replacing && (
          <>
            <p>Token saved ({info.hint})</p>
            <div className="provider-actions">
              <button type="button" onClick={() => setReplacing(true)} disabled={busy}>
                Replace
              </button>
              <button type="button" onClick={() => void remove()} disabled={busy}>
                Remove
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </article>
    </div>
  )
}

/** Settings > Agents > Connections: the outside services the agents read as the user. */
export function ConnectionsSettings() {
  return (
    <section className="settings-page" aria-label="Connections">
      <div className="settings-header">
        <h1>Connections</h1>
      </div>
      <section className="agents-section" aria-label="Connections">
        <p className="muted">Link outside services, so the agents can read them as you.</p>
        <KhCard />
        <GithubCard />
      </section>
    </section>
  )
}

const KH_FAILED = {
  expired: 'The sign-in expired before it was finished.',
  denied: 'The sign-in was refused.',
}

/** The Knowledge Hub card: not set up, disconnected, waiting for the sign-in, connected, or failed. */
function KhCard() {
  const [info, setInfo] = useState<KhStatus | null>(null)
  const [interval, setIntervalSeconds] = useState(5)
  const [round, setRound] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api
      .kh()
      .then((out) => {
        if (!live) return
        setInfo(out)
        if (out.pending) setIntervalSeconds(out.pending.interval)
      })
      .catch(() => live && setError('Could not load the Knowledge Hub connection.'))
    return () => {
      live = false
    }
  }, [])

  const waiting = info?.status === 'pending'
  // One check per interval while waiting; leaving the page (or finishing) clears the timer.
  useEffect(() => {
    if (!waiting) return
    let live = true
    const timer = setTimeout(() => {
      api
        .khPoll()
        .then((out) => {
          if (!live) return
          if (out.status === 'pending') {
            if (out.interval) setIntervalSeconds(out.interval)
            setRound((n) => n + 1)
          } else if (out.status === 'connected') {
            setInfo({
              available: true,
              status: 'connected',
              email: out.email,
              pending: null,
            })
          } else {
            setInfo({
              available: true,
              status: 'disconnected',
              email: null,
              pending: null,
            })
            setFailure(`${KH_FAILED[out.status]}${out.reason ? ` ${out.reason}` : ''}`)
          }
        })
        .catch((e) => {
          if (!live) return
          if (e instanceof ApiError && e.status === 404) {
            setInfo({
              available: true,
              status: 'disconnected',
              email: null,
              pending: null,
            })
          } else setRound((n) => n + 1)
        })
    }, interval * 1000)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [waiting, interval, round])

  const act = async (run: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await run()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request failed')
    } finally {
      setBusy(false)
    }
  }

  const connect = () =>
    act(async () => {
      setFailure(null)
      const pending = await api.khConnect()
      setIntervalSeconds(pending.interval)
      setInfo({ available: true, status: 'pending', email: null, pending })
    })

  const stop = () =>
    act(async () => {
      await api.khDisconnect()
      setInfo({
        available: true,
        status: 'disconnected',
        email: null,
        pending: null,
      })
    })

  const disconnect = () => {
    if (!window.confirm('Disconnect Knowledge Hub? The agents can no longer search it for you.')) return
    void stop()
  }

  return (
    <div className="provider-cards">
      <article className="provider-card" aria-label="Knowledge Hub">
        <header className="provider-header">
          <h3 className="agent-name">Knowledge Hub</h3>
        </header>
        {!info && !error && <p className="muted small">Loading…</p>}
        {info && !info.available && <p className="muted">The Knowledge Hub connector is not set up on this server.</p>}
        {info?.available && info.status === 'disconnected' && (
          <>
            <p className="muted small">
              Connect your Knowledge Hub account so the agents can search what you may read there. They never write to
              it.
            </p>
            {failure && (
              <p className="error" role="alert">
                {failure}
              </p>
            )}
            <div className="provider-actions">
              <button type="button" className="primary" onClick={() => void connect()} disabled={busy}>
                Connect
              </button>
            </div>
          </>
        )}
        {info?.status === 'pending' && info.pending && (
          <>
            <p className="muted small">Open the sign-in page and enter this code if it asks for one:</p>
            <p>
              <code aria-label="Sign-in code">{info.pending.user_code}</code>
            </p>
            <p className="muted small" role="status">
              Waiting for you to sign in…
            </p>
            <div className="provider-actions">
              <a
                className="button-link"
                href={info.pending.verification_uri_complete ?? info.pending.verification_uri}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open sign-in page
              </a>
              <button type="button" onClick={() => void stop()} disabled={busy}>
                Cancel
              </button>
            </div>
          </>
        )}
        {info?.status === 'connected' && (
          <>
            <p>Connected as {info.email}</p>
            <div className="provider-actions">
              <button type="button" onClick={disconnect} disabled={busy}>
                Disconnect
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </article>
    </div>
  )
}
