import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, queryKeys, type Roadmap } from './api'

export function useDomains() {
  return useQuery({ queryKey: queryKeys.domains, queryFn: api.domains })
}

export function useNotes() {
  return useQuery({ queryKey: queryKeys.notes, queryFn: api.notes })
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

/** Refresh everything that depends on notes after an import, link or delete. */
export function useRefreshNotes() {
  const client = useQueryClient()
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.notes }),
      client.invalidateQueries({ queryKey: ['counts'] }),
    ])
  }
}
