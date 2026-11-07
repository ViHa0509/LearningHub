import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, queryKeys, type Roadmap } from './api'

export function useDomains() {
  return useQuery({ queryKey: queryKeys.domains, queryFn: api.domains })
}

export function useNotes() {
  return useQuery({ queryKey: queryKeys.notes, queryFn: api.notes })
}

export function useArchivedNotes() {
  return useQuery({ queryKey: queryKeys.archivedNotes, queryFn: api.archivedNotes })
}

/** Every domain's roadmap, in domain order; `ready` once all of them are loaded. */
export function useAllRoadmaps(): { roadmaps: Roadmap[]; ready: boolean } {
  const domains = useDomains()
  const results = useQueries({
    queries: (domains.data ?? []).map((d) => ({
      queryKey: queryKeys.roadmap(d.id),
      queryFn: () => api.roadmap(d.id),
    })),
  })
  if (!domains.data || results.some((r) => !r.data)) return { roadmaps: [], ready: false }
  return { roadmaps: results.map((r) => r.data as Roadmap), ready: true }
}

/** Refresh everything that depends on notes after an import, link, archive or delete. */
export function useRefreshNotes() {
  const client = useQueryClient()
  return async () => {
    await Promise.all([
      // The ['notes'] prefix covers the archived list too.
      client.invalidateQueries({ queryKey: queryKeys.notes }),
      client.invalidateQueries({ queryKey: queryKeys.domains }),
      client.invalidateQueries({ queryKey: ['counts'] }),
    ])
  }
}

export function useProviders() {
  return useQuery({ queryKey: queryKeys.providers, queryFn: api.providers })
}

export function useProviderTypes() {
  return useQuery({ queryKey: queryKeys.providerTypes, queryFn: api.providerTypes, staleTime: Infinity })
}

export function useAgents() {
  return useQuery({ queryKey: queryKeys.agents, queryFn: api.agents })
}

/**
 * Refresh providers (list and single) and agents after any change to them. After a delete, pass the
 * deleted id: its detail query is dropped and never refetched.
 */
export function useRefreshProviders() {
  const client = useQueryClient()
  return async (deletedId?: string) => {
    if (deletedId) client.removeQueries({ queryKey: queryKeys.provider(deletedId), exact: true })
    await Promise.all([
      client.invalidateQueries({
        queryKey: queryKeys.providers,
        predicate: (q) => !deletedId || q.queryKey[1] !== deletedId,
      }),
      client.invalidateQueries({ queryKey: queryKeys.agents }),
    ])
  }
}
