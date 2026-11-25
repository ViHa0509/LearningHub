import { useEffect, useState } from 'react'
import { api, type AgentTool } from '../api'
import { useAgents, useAgentTools } from '../hooks'
import { useUnsavedGuard } from '../lib/unsavedGuard'

/** The agents that use tools, in display order; the name is used when GET /api/agents does not list the agent. */
const TOOL_AGENTS = [
  { id: 'assistant', name: 'Learning assistant' },
  { id: 'lesson-writer', name: 'Lesson writer' },
  { id: 'outline', name: 'Topic outline' },
  { id: 'a2ui', name: 'Interactive tutor' },
]

type Lists = Record<string, { attached: string[]; available: string[] }>

const same = (a: string[], b: string[]) => a.length === b.length && a.every((n) => b.includes(n))

/** Settings > Agents > Tools: which of its own tools each agent has attached. */
export function AgentToolsSettings() {
  const agents = useAgents()
  const catalog = useAgentTools()
  const [saved, setSaved] = useState<Lists | null>(null)
  const [draft, setDraft] = useState<Record<string, string[]>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let live = true
    Promise.all(TOOL_AGENTS.map((a) => api.agentToolSet(a.id)))
      .then((sets) => {
        if (!live) return
        setSaved(Object.fromEntries(sets.map((s) => [s.agent_id, s])))
        setDraft(Object.fromEntries(sets.map((s) => [s.agent_id, s.attached])))
      })
      .catch(() => live && setLoadFailed(true))
    return () => {
      live = false
    }
  }, [])

  const dirty = (id: string) => !!saved && !same(draft[id] ?? [], saved[id].attached)
  useUnsavedGuard(TOOL_AGENTS.some((a) => dirty(a.id)))

  const save = async (id: string) => {
    setBusy(id)
    setErrors((e) => ({ ...e, [id]: '' }))
    try {
      const out = await api.saveAgentToolSet(id, draft[id])
      setSaved((s) => ({ ...s, [id]: out }) as Lists)
      setDraft((d) => ({ ...d, [id]: out.attached }))
    } catch (e) {
      setErrors((all) => ({ ...all, [id]: e instanceof Error ? e.message : 'Saving failed' }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="settings-page" aria-label="Agent tools">
      <div className="settings-header">
        <h1>Tools</h1>
      </div>
      <p className="muted">
        Choose which tools each agent has. The tool ticks on the Agents page can still switch a tool off on one area.
      </p>
      {(loadFailed || agents.isError || catalog.isError) && <p className="error">Could not load the tools.</p>}
      <div className="provider-cards">
        {saved &&
          catalog.data &&
          TOOL_AGENTS.map((a) => (
            <ToolsCard
              key={a.id}
              id={a.id}
              name={agents.data?.find((x) => x.id === a.id)?.name ?? a.name}
              catalog={catalog.data}
              own={[...saved[a.id].attached, ...saved[a.id].available]}
              attached={draft[a.id] ?? []}
              dirty={dirty(a.id)}
              busy={busy === a.id}
              error={errors[a.id]}
              onChange={(next) => setDraft((d) => ({ ...d, [a.id]: next }))}
              onCancel={() => {
                setDraft((d) => ({ ...d, [a.id]: saved[a.id].attached }))
                setErrors((e) => ({ ...e, [a.id]: '' }))
              }}
              onSave={() => void save(a.id)}
            />
          ))}
      </div>
    </section>
  )
}

interface CardProps {
  id: string
  name: string
  catalog: AgentTool[]
  /** Every tool of the agent, attached or not. */
  own: string[]
  attached: string[]
  dirty: boolean
  busy: boolean
  error?: string
  onChange: (attached: string[]) => void
  onCancel: () => void
  onSave: () => void
}

function ToolsCard({ id, name, catalog, own, attached, dirty, busy, error, onChange, onCancel, onSave }: CardProps) {
  const [pick, setPick] = useState('')
  const rank = (n: string) => catalog.findIndex((t) => t.name === n)
  const inOrder = (names: string[]) => [...names].sort((a, b) => rank(a) - rank(b))
  const shown = inOrder(own.filter((n) => attached.includes(n)))
  const offered = inOrder(own.filter((n) => !attached.includes(n)))
  const choice = offered.includes(pick) ? pick : (offered[0] ?? '')

  return (
    <article className="provider-card" aria-label={name}>
      <header className="provider-header">
        <h2 className="agent-name">{name}</h2>
      </header>
      {shown.length === 0 ? (
        <p className="muted">No tools: this agent answers from the conversation only.</p>
      ) : (
        <ul className="agent-tool-list">
          {shown.map((n) => (
            <li key={n}>
              <span>
                <code>{n}</code> <span className="muted">{catalog.find((t) => t.name === n)?.description}</span>
              </span>
              <button
                type="button"
                aria-label={`Remove ${n} from ${name}`}
                onClick={() => onChange(attached.filter((x) => x !== n))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="agent-tool-add">
          <label className="field" htmlFor={`tools-${id}-add`}>
            Add tool
          </label>
          <select id={`tools-${id}-add`} value={choice} disabled={offered.length === 0} onChange={(e) => setPick(e.target.value)}>
            {offered.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button type="button" disabled={!choice} onClick={() => onChange([...attached, choice])}>
            Add
          </button>
      </div>
      <div className="provider-actions">
        <button type="button" className="primary" onClick={onSave} disabled={!dirty || busy}>
          Save
        </button>
        <button type="button" onClick={onCancel} disabled={!dirty || busy}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </article>
  )
}
