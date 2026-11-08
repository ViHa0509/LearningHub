import { useState } from 'react'
import { api, type AgentOut, type ProviderOut } from '../api'
import { useAgents, useProviders, useProviderTypes, useRefreshProviders } from '../hooks'
import { providerLabel, typeLabel } from '../lib/providers'
import { backFromSettings, routeHash } from '../lib/route'
import { StatusBadge } from './StatusBadge'

export function SettingsPage() {
  const providers = useProviders()
  const types = useProviderTypes()
  return (
    <section className="settings-page" aria-label="Settings">
      <a className="back-link" href={routeHash(backFromSettings())}>
        ← Back
      </a>
      <div className="settings-header">
        <h1>AI providers</h1>
        <a className="button-link primary" href="#/settings/providers/new">
          Add provider
        </a>
      </div>
      <p className="muted">
        Each provider is a named configuration of a model service. Keys are stored encrypted on this computer
        and never sent back to the browser. Usage is billed by the provider: set a spend limit in the
        provider's console.
      </p>
      {providers.isError && <p className="error">Could not load the providers.</p>}
      {providers.data && providers.data.length === 0 && (
        <p className="muted" role="status">
          No providers yet. Add one to use the agent.
        </p>
      )}
      <div className="provider-cards">
        {providers.data?.map((p) => (
          <ProviderCard key={p.id} provider={p} typeName={typeLabel(types.data, p.provider_type)} />
        ))}
      </div>
      {providers.data && <AgentsSection providers={providers.data} />}
    </section>
  )
}

function ProviderCard({ provider, typeName }: { provider: ProviderOut; typeName: string }) {
  return (
    <article className="provider-card" aria-label={provider.name}>
      <header className="provider-header">
        <h2>
          <a href={`#/settings/providers/${provider.id}`}>{provider.name}</a>
        </h2>
        <span className={provider.is_active ? 'tag on' : 'tag off'}>{provider.is_active ? 'Active' : 'Inactive'}</span>
      </header>
      <p className="provider-meta">
        {typeName} · {provider.model_name}
      </p>
      <p className="provider-status">
        <StatusBadge status={provider.last_test?.status} />
      </p>
      <p className="muted small">
        {provider.used_by.length === 0
          ? 'Not used by any agent'
          : `Used by ${provider.used_by.map((u) => `${u.agent_name} (${u.role})`).join(', ')}`}
      </p>
    </article>
  )
}

function AgentsSection({ providers }: { providers: ProviderOut[] }) {
  const agents = useAgents()
  return (
    <section className="agents-section" aria-label="Agents">
      <h2>Agents</h2>
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

function AgentCard({ agent, providers }: { agent: AgentOut; providers: ProviderOut[] }) {
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
        <h3 className="agent-name">{agent.name}</h3>
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
        {agent.effective && agent.effective.provider_type !== 'claude-code'
          ? 'Internet search needs a Claude Code provider; it has no effect with the current one.'
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
