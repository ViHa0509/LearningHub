import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'
import { api, queryKeys, type HealthReason, type Roadmap } from './api'
import { onFailure } from './lib/failures'

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

/** A node's references (links synced from roadmap.sh). */
export function useNodeResources(domain: string, node: string) {
  return useQuery({ queryKey: queryKeys.resources(domain, node), queryFn: () => api.resources(domain, node) })
}

/** How often the sync status is read while a sync runs. */
export const RESOURCE_SYNC_POLL_MS = 1_500

/**
 * The domain's resource sync status (null: the domain has no mapping), read every 1.5 s while a sync
 * runs. When a running sync ends, the domain's references are refreshed.
 */
export function useResourceSync(domain: string, enabled = true) {
  const client = useQueryClient()
  const status = useQuery({
    queryKey: queryKeys.resourceSync(domain),
    queryFn: () => api.resourceSyncStatus(domain),
    enabled,
    refetchInterval: (query) => (query.state.data?.state === 'running' ? RESOURCE_SYNC_POLL_MS : false),
  })
  const state = status.data?.state
  const previous = useRef(state)
  useEffect(() => {
    if (previous.current === 'running' && state === 'done') {
      void client.invalidateQueries({ queryKey: queryKeys.domainResources(domain) })
    }
    previous.current = state
  }, [state, domain, client])
  return status
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

/** How often the health check runs while the service answers, and while it does not. */
export const HEALTH_INTERVAL_OK = 30_000
export const HEALTH_INTERVAL_DOWN = 5_000

export interface ServiceHealth {
  /** `ok` until a health check has actually failed, so one slow request never shows the outage page. */
  state: 'ok' | 'down'
  reason: HealthReason
  /** When the last health check finished; null before the first one. */
  lastChecked: Date | null
  /** When the next automatic check runs; null before the first one. */
  nextRetryAt: Date | null
  /** A health check is running now. */
  checking: boolean
  retryNow: () => void
}

/**
 * The service's health: checked when the app starts, every 30 s while it answers, every 5 s while it
 * does not, and at once after any API request fails with a network error or a 5xx answer. When it
 * comes back, every other query is refetched.
 */
export function useServiceHealth(): ServiceHealth {
  const client = useQueryClient()
  const { data, dataUpdatedAt, isFetching, refetch } = useQuery({
    queryKey: queryKeys.health,
    queryFn: api.health,
    // The timer below decides when to check again.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const down = data?.state === 'down'
  const interval = down ? HEALTH_INTERVAL_DOWN : HEALTH_INTERVAL_OK

  // A running check is joined, not restarted.
  const check = useCallback(() => {
    void refetch({ cancelRefetch: false })
  }, [refetch])

  useEffect(() => {
    if (!dataUpdatedAt) return
    const timer = setTimeout(check, Math.max(0, dataUpdatedAt + interval - Date.now()))
    return () => clearTimeout(timer)
  }, [dataUpdatedAt, interval, check])

  useEffect(() => onFailure(check), [check])

  const wasDown = useRef(false)
  useEffect(() => {
    if (down) wasDown.current = true
    else if (data?.state === 'ok' && wasDown.current) {
      wasDown.current = false
      void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== queryKeys.health[0] })
    }
  }, [down, data, client])

  return {
    state: down ? 'down' : 'ok',
    reason: data?.state === 'down' ? data.reason : 'server',
    lastChecked: dataUpdatedAt ? new Date(dataUpdatedAt) : null,
    nextRetryAt: dataUpdatedAt ? new Date(dataUpdatedAt + interval) : null,
    checking: isFetching,
    retryNow: check,
  }
}
