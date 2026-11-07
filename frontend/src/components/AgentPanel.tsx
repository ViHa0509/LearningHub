import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import { api, queryKeys, type AgentStep, type ChatPage, type ProviderOut } from '../api'
import { useAgents, useProviders } from '../hooks'
import { providerLabel } from '../lib/providers'

export interface AgentRequest {
  id: number
  text: string
  /** The agent that should answer; the assistant when absent. */
  agentId?: string
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
  /** Who answered, and whether the fallback did. */
  answeredBy?: { name: string; model: string; fallback: boolean }
}

const CHOICE_KEY = 'learninghub.agent'
const DEFAULT = ''

function readChoice(): string {
  try {
    const value = (JSON.parse(localStorage.getItem(CHOICE_KEY) ?? '{}') as { provider_id?: unknown }).provider_id
    return typeof value === 'string' ? value : DEFAULT
  } catch {
    return DEFAULT
  }
}

function saveChoice(providerId: string) {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify({ provider_id: providerId }))
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}

export function AgentPanel({ open, onToggle, page, request }: Props) {
  const providers = useProviders()
  const agents = useAgents()
  const available = (providers.data ?? []).filter((p) => p.is_active)
  // What "Agent default" means right now: the assistant's resolved provider.
  const defaultProvider = agents.data?.find((a) => a.id === 'assistant')?.effective ?? available[0] ?? null

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
      {open && providers.data && available.length === 0 && <NotConfigured />}
      {/* Kept mounted while collapsed, so the conversation survives a collapse. */}
      {providers.data && available.length > 0 && (
        <Chat hidden={!open} providers={available} defaultProvider={defaultProvider} page={page} request={request} />
      )}
    </aside>
  )
}

function NotConfigured() {
  return (
    <div className="agent-note" role="status">
      <p>
        <strong>No AI provider is configured.</strong>
      </p>
      <p>
        <a className="button-link primary" href="#/settings">
          Open settings
        </a>{' '}
        <span className="muted">and add a provider - the agent works at once.</span>
      </p>
    </div>
  )
}

function Chat({
  hidden,
  providers,
  defaultProvider,
  page,
  request,
}: {
  hidden: boolean
  providers: ProviderOut[]
  defaultProvider: { name: string; model_name: string } | null
  page: ChatPage
  request: AgentRequest | null
}) {
  const client = useQueryClient()
  const [choice, setChoice] = useState(readChoice)
  // A saved choice that is no longer active falls back to the agent default.
  const providerId = providers.some((p) => p.id === choice) ? choice : DEFAULT
  const [entries, setEntries] = useState<Entry[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const handled = useRef<number | null>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [entries, busy])

  const choose = (next: string) => {
    setChoice(next)
    saveChoice(next)
  }

  const send = async (text: string, agentId = 'assistant') => {
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
        agent_id: agentId,
        // The picker is for the chat; other agents use their own assignment.
        ...(agentId === 'assistant' && providerId ? { provider_id: providerId } : {}),
        messages: [...history, { role: 'user', content: question }],
        page,
      })
      setEntries((current) => [
        ...current,
        {
          role: 'assistant',
          content: answer.reply,
          steps: answer.steps,
          answeredBy: { name: answer.provider.name, model: answer.provider.model, fallback: answer.fallback_used },
        },
      ])
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
    void send(next.text, next.agentId)
  })
  useEffect(() => {
    if (request) sendRequest(request)
  }, [request])

  return (
    <div className="agent-chat" hidden={hidden}>
      <div className="agent-toolbar">
        <select aria-label="Provider" value={providerId} onChange={(e) => choose(e.target.value)}>
          <option value={DEFAULT}>
            {defaultProvider ? `Agent default (${providerLabel(defaultProvider)})` : 'Agent default'}
          </option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
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
            {entry.answeredBy && (
              <p className="agent-caption muted">
                {entry.answeredBy.name} · {entry.answeredBy.model}
                {entry.answeredBy.fallback ? ' (fallback)' : ''}
              </p>
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
