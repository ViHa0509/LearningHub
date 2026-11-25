import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api, queryKeys, type AgentOut, type AgentTool, type AreaAgentSettings, type ProviderOut } from '../api'
import { useAgents, useAgentTools, useAreaAgents, useProviders, useRefreshProviders, useSharedStatus } from '../hooks'
import { providerLabel } from '../lib/providers'
import { useUnsavedGuard } from '../lib/unsavedGuard'
import { WithdrawnWarning } from './SharedProvider'
import { sharedLine, usageLine } from '../lib/shared'
import { StatusBadge } from './StatusBadge'

const MAX_INSTRUCTIONS = 4000
const COUNTER_FROM = 3500
const ONLY_LABEL: Record<string, string> = {
  assistant: 'Learning assistant only',
  'lesson-writer': 'Lesson writer only',
  outline: 'Topic outline only',
}

/** Settings > Agents: the provider of each agent, and the instructions and tools of each area. */
export function AgentsSettings() {
  const providers = useProviders()
  return (
    <section className="settings-page" aria-label="Agents">
      <div className="settings-header">
        <h1>Agents</h1>
      </div>
      {providers.data && <AgentsSection providers={providers.data} />}
      <AreasSection />
    </section>
  )
}

function AgentsSection({ providers }: { providers: ProviderOut[] }) {
  const agents = useAgents()
  const shared = useSharedStatus().data
  return (
    <section className="agents-section" aria-label="Agent providers">
      {shared?.withdrawn && <WithdrawnWarning />}
      {shared?.mode === 'shared' && (
        <p className="shared-usage" role="status">
          {usageLine(shared)}
        </p>
      )}
      <p className="muted">
        Choose which provider each agent uses. The fallback takes over when the primary is rate limited, times
        out or is unavailable.
      </p>
      {agents.isError && <p className="error">Could not load the agents.</p>}
      <div className="provider-cards">
        {agents.data?.map((a) => (
          <AgentCard key={a.id} agent={a} providers={providers} />
        ))}
      </div>
    </section>
  )
}

/** An agent that runs on the admin's shared provider: what it uses, without controls. */
function SharedAgentCard({ agent }: { agent: AgentOut }) {
  return (
    <article className="provider-card" aria-label={agent.name}>
      <header className="provider-header">
        <h2 className="agent-name">{agent.name}</h2>
      </header>
      <p className="muted small">{agent.description}</p>
      <p className="agent-effective">{agent.effective ? sharedLine(agent.effective) : 'No shared provider is available.'}</p>
      <p className="muted small">Internet search: {agent.web_search ? 'on' : 'off'}</p>
    </article>
  )
}

function AgentCard({ agent, providers }: { agent: AgentOut; providers: ProviderOut[] }) {
  if (agent.effective_reason === 'shared') return <SharedAgentCard agent={agent} />
  return <OwnAgentCard agent={agent} providers={providers} />
}

function OwnAgentCard({ agent, providers }: { agent: AgentOut; providers: ProviderOut[] }) {
  const refresh = useRefreshProviders()
  const [primary, setPrimary] = useState(agent.primary?.id ?? '')
  const [fallback, setFallback] = useState(agent.fallback?.id ?? '')
  const [webSearch, setWebSearch] = useState(agent.web_search)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await api.assignAgent(agent.id, {
        primary_provider_id: primary || null,
        fallback_provider_id: fallback || null,
      })
      if (webSearch !== agent.web_search) await api.saveAgentSettings(agent.id, { web_search: webSearch })
      setSaved(true)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saving failed')
    } finally {
      setBusy(false)
    }
  }

  const id = `agent-${agent.id}`
  const primaryChoices = providers.filter((p) => p.is_active || p.id === primary)
  const fallbackChoices = providers.filter((p) => p.id !== primary)
  const inactive = (p: ProviderOut) => (p.is_active ? '' : ' (inactive)')

  return (
    <article className="provider-card" aria-label={agent.name}>
      <header className="provider-header">
        <h2 className="agent-name">{agent.name}</h2>
      </header>
      <p className="muted small">{agent.description}</p>

      <label className="field" htmlFor={`${id}-primary`}>
        Primary provider
      </label>
      <select id={`${id}-primary`} value={primary} onChange={(e) => setPrimary(e.target.value)}>
        <option value="">
          {agent.id === 'assistant' ? 'Default: first active provider' : 'Same as the Learning assistant'}
        </option>
        {primaryChoices.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {inactive(p)}
          </option>
        ))}
      </select>

      <label className="field" htmlFor={`${id}-fallback`}>
        Fallback provider
      </label>
      <select id={`${id}-fallback`} value={fallback} onChange={(e) => setFallback(e.target.value)}>
        <option value="">None</option>
        {fallbackChoices.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {inactive(p)}
          </option>
        ))}
      </select>

      <p className="agent-effective">
        {agent.effective ? (
          <>
            <span className="muted">Uses </span>
            <strong>{providerLabel(agent.effective)}</strong>
            {agent.effective_reason === 'assistant' && (
              <span className="muted"> (same as the Learning assistant)</span>
            )}{' '}
            <StatusBadge status={agent.effective.last_test_status} />
          </>
        ) : (
          <span className="muted">No active provider, so this agent cannot answer.</span>
        )}
      </p>

      <label className="check-field">
        <input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} />
        Internet search
      </label>
      <p className="muted small" id={`${id}-web-search-note`}>
        {agent.effective && agent.effective.provider_type === 'anthropic'
          ? "Lets the agent search the web with Anthropic's web search when your notes do not cover a question (billed per search on your Anthropic key)."
          : agent.effective && agent.effective.provider_type !== 'claude-code'
            ? 'Internet search needs a Claude Code or Anthropic provider; it has no effect with the current one.'
            : 'Lets the agent search the web (Claude Code WebSearch: titles and links only) when your notes do not cover a question.'}
      </p>

      <div className="provider-actions">
        <button type="button" className="primary" onClick={() => void save()} disabled={busy}>
          Save
        </button>
        {saved && <span className="muted">Saved.</span>}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </article>
  )
}

function AreasSection() {
  const areas = useAreaAgents()
  const tools = useAgentTools()
  return (
    <section className="agents-section" aria-label="Areas">
      <h2>Areas</h2>
      <p className="muted">
        Extra instructions and the tools the agents may use are set per area. They apply when the agent is
        opened on that area&apos;s roadmap, lessons or notes.
      </p>
      {(areas.isError || tools.isError) && <p className="error">Could not load the areas.</p>}
      <div>{tools.data && areas.data?.map((a) => <AreaCard key={a.domain_id} area={a} tools={tools.data} />)}</div>
    </section>
  )
}

const spaced = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, ' ')

function AreaCard({ area, tools }: { area: AreaAgentSettings; tools: AgentTool[] }) {
  const client = useQueryClient()
  const names = tools.map((t) => t.name)
  const savedTicked = new Set(area.tools ?? names)
  const [instructions, setInstructions] = useState(area.instructions)
  const [ticked, setTicked] = useState<Set<string>>(savedTicked)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const sameTools = names.every((n) => ticked.has(n) === savedTicked.has(n))
  const dirty = instructions !== area.instructions || !sameTools
  useUnsavedGuard(dirty)

  const id = `area-${area.domain_id}`
  const toggle = (name: string, on: boolean) => {
    const next = new Set(ticked)
    if (on) next.add(name)
    else next.delete(name)
    setTicked(next)
  }

  const cancel = () => {
    setInstructions(area.instructions)
    setTicked(new Set(savedTicked))
    setError(null)
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    setSaved(false)
    const chosen = names.filter((n) => ticked.has(n)).sort()
    try {
      const out = await api.saveAreaAgents(area.domain_id, {
        instructions,
        tools: chosen.length === names.length ? null : chosen,
      })
      client.setQueryData<AreaAgentSettings[]>(queryKeys.areaAgents, (old) =>
        old?.map((a) => (a.domain_id === out.domain_id ? out : a)),
      )
      setInstructions(out.instructions)
      setTicked(new Set(out.tools ?? names))
      setSaved(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saving failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="area-agent-card" aria-label={`Area: ${area.title}`}>
      <h3 className="agent-name">
        {area.title}
        {area.field_title && <span className="muted"> · {area.field_title}</span>}
      </h3>
      <label className="field" htmlFor={`${id}-instructions`}>
        Extra instructions for {area.title}
      </label>
      <textarea
        id={`${id}-instructions`}
        rows={4}
        maxLength={MAX_INSTRUCTIONS}
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
      />
      {instructions.length > COUNTER_FROM && (
        <p className="area-agent-counter muted small">
          {spaced(instructions.length)} / {MAX_INSTRUCTIONS}
        </p>
      )}
      <fieldset className="area-agent-tools">
        <legend>Tools for {area.title}</legend>
        {tools.map((t) => (
          <label key={t.name} className="check-field area-agent-tool">
            <input type="checkbox" checked={ticked.has(t.name)} onChange={(e) => toggle(t.name, e.target.checked)} />
            <span>
              <code>{t.name}</code> {t.description}
              {t.agents.length === 1 && ONLY_LABEL[t.agents[0]] && ` (${ONLY_LABEL[t.agents[0]]})`}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="provider-actions">
        <button type="button" className="primary" onClick={() => void save()} disabled={!dirty || busy}>
          Save
        </button>
        <button type="button" onClick={cancel} disabled={!dirty || busy}>
          Cancel
        </button>
        {saved && (
          <span className="muted" role="status">
            Saved
          </span>
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
