import type { AgentOut, ProviderRef, SharedStatus } from '../api'

/** "Uses Claude main (claude-sonnet-5-5), shared by the admin". */
export function sharedLine(provider: Pick<ProviderRef, 'name' | 'model_name'>): string {
  return `Uses ${provider.name} (${provider.model_name}), shared by the admin`
}

/** "3 of 10 requests used today". */
export function usageLine(status: Pick<SharedStatus, 'used_today' | 'daily_limit'>): string {
  return `${status.used_today} of ${status.daily_limit} requests used today`
}

/** The distinct shared providers the agents run on. */
export function sharedProviders(agents: AgentOut[] | undefined): ProviderRef[] {
  const seen = new Map<string, ProviderRef>()
  for (const a of agents ?? []) {
    if (a.effective_reason === 'shared' && a.effective) seen.set(a.effective.id, a.effective)
  }
  return [...seen.values()]
}
