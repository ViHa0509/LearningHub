import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import { api, queryKeys, type AgentProvider, type AgentStep, type ChatPage } from '../api'
import { useProviders } from '../hooks'

export interface AgentRequest {
  id: number
  text: string
}

interface Props {
  open: boolean
  onToggle: () => void
  page: ChatPage
  request: AgentRequest | null
}

interface Entry {
  role: 'user' | 'assistant'
  content: string
  steps?: AgentStep[]
  error?: string
}

const CHOICE_KEY = 'learninghub.agent'

function readChoice(): { provider?: string; model?: string } {
  try {
    return JSON.parse(localStorage.getItem(CHOICE_KEY) ?? '{}') as { provider?: string; model?: string }
  } catch {
    return {}
  }
}

function saveChoice(provider: string, model: string) {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify({ provider, model }))
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}

export function AgentPanel({ open, onToggle, page, request }: Props) {
  const providers = useProviders()
  const available = (providers.data ?? []).filter((p) => p.available)

  return (
    <aside className="pane right" aria-label="Agent" data-collapsed={!open}>
      <div className="pane-header">
        <button
          type="button"
          className="icon"
          aria-expanded={open}
          aria-label={open ? 'Collapse agent panel' : 'Expand agent panel'}
          onClick={onToggle}
        >
          {open ? '»' : '«'}
        </button>
        {open && <h2>Agent</h2>}
      </div>
      {open && providers.isError && <p className="agent-note error">Could not reach the backend.</p>}
      {open && providers.data && available.length === 0 && <NotConfigured providers={providers.data} />}
      {/* Kept mounted while collapsed, so the conversation survives a collapse. */}
      {providers.data && available.length > 0 && (
        <Chat hidden={!open} providers={available} page={page} request={request} />
      )}
    </aside>
  )
}

function NotConfigured({ providers }: { providers: AgentProvider[] }) {
  return (
    <div className="agent-note" role="status">
      <p>
        <strong>No AI provider is configured.</strong>
      </p>
      <p className="muted">
        Add at least one of these settings to <code>backend/.env</code>, then restart the backend:
      </p>
      <ul className="settings-list">
        {providers.map((p) => (
          <li key={p.id}>
            <code>{p.setting}</code> <span className="muted">- {p.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Chat({
  hidden,
  providers,
  page,
  request,
}: {
  hidden: boolean
  providers: AgentProvider[]
  page: ChatPage
  request: AgentRequest | null
}) {
  const client = useQueryClient()
  const [providerId, setProviderId] = useState(() => {
    const saved = readChoice().provider
    return providers.some((p) => p.id === saved) ? (saved as string) : providers[0].id
  })
  const provider = providers.find((p) => p.id === providerId) ?? providers[0]
  const [model, setModel] = useState(() => {
    const saved = readChoice().model
    return saved && provider.models.includes(saved) ? saved : provider.default_model
  })
  const [entries, setEntries] = useState<Entry[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const handled = useRef<number | null>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [entries, busy])

  const choose = (nextProvider: string, nextModel?: string) => {
    const p = providers.find((x) => x.id === nextProvider) ?? providers[0]
    const m = nextModel && p.models.includes(nextModel) ? nextModel : p.default_model
    setProviderId(p.id)
    setModel(m)
    saveChoice(p.id, m)
  }

  const send = async (text: string) => {
    const question = text.trim()
    if (!question || busy) return
    // Failed questions stay visible but are not sent again as history.
    const history = entries
      .filter((e) => !e.error)
      .map((e) => ({ role: e.role, content: e.content }))
    const index = entries.length
    setEntries((current) => [...current, { role: 'user', content: question }])
    setDraft('')
    setBusy(true)
    try {
      const answer = await api.chat({
        provider: provider.id,
        model,
        messages: [...history, { role: 'user', content: question }],
        page,
      })
      setEntries((current) => [...current, { role: 'assistant', content: answer.reply, steps: answer.steps }])
      await Promise.all(
        answer.changed_lessons.map((nodeId) => {
          const [domain, node] = nodeId.split('/')
          return client.invalidateQueries({ queryKey: queryKeys.lesson(domain, node) })
        }),
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The agent request failed'
      setEntries((current) => current.map((entry, i) => (i === index ? { ...entry, error: message } : entry)))
    } finally {
      setBusy(false)
    }
  }

  // A request from elsewhere in the app (e.g. "Draft with agent"), sent once per id.
  const sendRequest = useEffectEvent((next: AgentRequest) => {
    if (handled.current === next.id) return
    handled.current = next.id
    void send(next.text)
  })
  useEffect(() => {
    if (request) sendRequest(request)
  }, [request])

  return (
    <div className="agent-chat" hidden={hidden}>
      <div className="agent-toolbar">
        <select aria-label="Provider" value={provider.id} onChange={(e) => choose(e.target.value)}>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <select aria-label="Model" value={model} onChange={(e) => choose(provider.id, e.target.value)}>
          {provider.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setEntries([])} disabled={busy || entries.length === 0}>
          Clear chat
        </button>
      </div>

      <div className="agent-messages" role="log" aria-label="Conversation">
        {entries.length === 0 && (
          <p className="muted agent-hint">
            Ask about what you learned, e.g. “What did I note about Redis eviction?” or, on a lesson page,
            “Draft this lesson”.
          </p>
        )}
        {entries.map((entry, i) => (
          <div key={i} className={`agent-message ${entry.role}`}>
            {entry.role === 'user' ? (
              <p className="user-text">{entry.content}</p>
            ) : (
              <div className="markdown">
                {/* No rehype-raw: HTML in model output is shown as text, never inserted. */}
                <Markdown>{entry.content}</Markdown>
              </div>
            )}
            {entry.steps && entry.steps.length > 0 && (
              <details className="agent-steps">
                <summary>
                  Used {entry.steps.length} {entry.steps.length === 1 ? 'tool' : 'tools'}
                </summary>
                <ul>
                  {entry.steps.map((s, j) => (
                    <li key={j}>{s.summary}</li>
                  ))}
                </ul>
              </details>
            )}
            {entry.error && (
              <p className="error" role="alert">
                {entry.error}
              </p>
            )}
          </div>
        ))}
        {busy && (
          <p className="muted agent-working" role="status">
            Agent is working…
          </p>
        )}
        <div ref={end} />
      </div>

      <form
        className="agent-input"
        onSubmit={(e) => {
          e.preventDefault()
          void send(draft)
        }}
      >
        <textarea
          aria-label="Message the agent"
          placeholder="Ask the agent… (Enter to send, Shift+Enter for a new line)"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(draft)
            }
          }}
        />
        <button type="submit" className="primary" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
