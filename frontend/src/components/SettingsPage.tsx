import type { ProviderOut, ProviderRef } from '../api'
import { useAgents, useProviders, useProviderTypes, useSharedStatus } from '../hooks'
import { typeLabel } from '../lib/providers'
import { WithdrawnWarning } from './SharedProvider'
import { sharedProviders, usageLine } from '../lib/shared'
import { StatusBadge } from './StatusBadge'

export function SettingsPage() {
  const providers = useProviders()
  const types = useProviderTypes()
  const shared = useSharedStatus().data
  const sharedOn = sharedProviders(useAgents().data)
  return (
    <section className="settings-page" aria-label="Settings">
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
      {shared?.withdrawn && <WithdrawnWarning />}
      {providers.data && providers.data.length === 0 && (
        <p className="muted" role="status">
          {shared?.mode === 'shared'
            ? 'You have no provider of your own yet. Add one to use your own key instead of the shared one.'
            : 'No providers yet. Add one to use the agent.'}
        </p>
      )}
      <div className="provider-cards">
        {shared?.mode === 'shared' &&
          sharedOn.map((p) => <SharedProviderCard key={p.id} provider={p} usage={usageLine(shared)} />)}
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

/** The admin's shared configuration as a member sees it: read-only, nothing secret, no link. */
function SharedProviderCard({ provider, usage }: { provider: ProviderRef; usage: string }) {
  return (
    <article className="provider-card shared-card" aria-label={provider.name}>
      <header className="provider-header">
        <h2>{provider.name}</h2>
        <span className="tag shared">Public</span>
      </header>
      <p className="provider-meta">{provider.model_name}</p>
      <p className="muted small">Shared by the admin</p>
      <p className="shared-usage">{usage}</p>
    </article>
  )
}

function ProviderCard({ provider, typeName, needsKey }: { provider: ProviderOut; typeName: string; needsKey: boolean }) {
  return (
    <article className="provider-card" aria-label={provider.name}>
      <header className="provider-header">
        <h2>
          <a href={`#/settings/providers/${provider.id}`}>{provider.name}</a>
        </h2>
        <span>
          <span className={provider.is_active ? 'tag on' : 'tag off'}>{provider.is_active ? 'Active' : 'Inactive'}</span>
          {provider.shared && <span className="tag shared">Public</span>}
        </span>
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
