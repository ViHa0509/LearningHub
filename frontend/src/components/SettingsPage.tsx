import type { ProviderOut } from '../api'
import { useProviders, useProviderTypes } from '../hooks'
import { typeLabel } from '../lib/providers'
import { SettingsNav } from './SettingsNav'
import { StatusBadge } from './StatusBadge'

export function SettingsPage() {
  const providers = useProviders()
  const types = useProviderTypes()
  return (
    <section className="settings-page" aria-label="Settings">
      <SettingsNav current="providers" />
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
          <ProviderCard
            key={p.id}
            provider={p}
            typeName={typeLabel(types.data, p.provider_type)}
            needsKey={!p.has_key && (types.data?.find((t) => t.type === p.provider_type)?.needs_key ?? false)}
          />
        ))}
      </div>
    </section>
  )
}

function ProviderCard({ provider, typeName, needsKey }: { provider: ProviderOut; typeName: string; needsKey: boolean }) {
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
      {needsKey && (
        <p className="error small" role="status">
          Needs its API key: <a href={`#/settings/providers/${provider.id}`}>enter it again</a>
        </p>
      )}
      <p className="muted small">
        {provider.used_by.length === 0
          ? 'Not used by any agent'
          : `Used by ${provider.used_by.map((u) => `${u.agent_name} (${u.role})`).join(', ')}`}
      </p>
    </article>
  )
}
