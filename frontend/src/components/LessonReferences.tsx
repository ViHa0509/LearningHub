import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, queryKeys, type ResourceItem } from '../api'
import { useNodeResources, useResourceSync } from '../hooks'
import { Icon } from './Icon'

/** Group headings per reference type; another type is shown by its name. */
const TYPE_LABELS: Record<string, string> = {
  official: 'Official',
  course: 'Courses',
  book: 'Books',
  article: 'Articles',
  opensource: 'Open source',
  video: 'Videos',
  roadmap: 'Roadmaps',
  podcast: 'Podcasts',
}

/** The items grouped by type, keeping the API order of types and of items. */
function groupByType(items: ResourceItem[]): [string, ResourceItem[]][] {
  const groups = new Map<string, ResourceItem[]>()
  for (const item of items) {
    const group = groups.get(item.type)
    if (group) group.push(item)
    else groups.set(item.type, [item])
  }
  return [...groups.entries()]
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

interface Props {
  domain: string
  node: string
  /** Asks the lesson writer to draft the lesson from these references; absent without a provider. */
  onDraftFromReferences?: () => void
}

/** The node's reference links synced from roadmap.sh, with a sync button while there are none. */
export function LessonReferences({ domain, node, onDraftFromReferences }: Props) {
  const resources = useNodeResources(domain, node)
  const items = resources.data?.items ?? []
  const empty = resources.isSuccess && items.length === 0

  return (
    <section aria-label="References" className="lesson-section lesson-references">
      <div className="section-header">
        <h2>References</h2>
        {items.length > 0 && onDraftFromReferences && (
          <button type="button" onClick={onDraftFromReferences}>
            <Icon name="sparkle" /> Draft lesson from references
          </button>
        )}
      </div>
      {resources.isPending && <p className="muted">Loading…</p>}
      {resources.isError && <p className="error">Could not load the references.</p>}
      {items.length > 0 && resources.data && (
        <>
          {groupByType(items).map(([type, group]) => (
            <div key={type} className="reference-group">
              <h3>{TYPE_LABELS[type] ?? type}</h3>
              <ul className="reference-list">
                {group.map((item) => (
                  <li key={item.url}>
                    {/* noopener noreferrer: the opened page gets no handle on the app. */}
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      {item.title}
                    </a>
                    {hostOf(item.url) && <span className="muted reference-host"> {hostOf(item.url)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="reference-source muted">
            Source:{' '}
            <a href={resources.data.source_url} target="_blank" rel="noopener noreferrer">
              roadmap.sh
            </a>
            {resources.data.synced_at && ` · synced ${formatDate(resources.data.synced_at)}`}
          </p>
        </>
      )}
      {empty && <ReferencesEmpty domain={domain} />}
    </section>
  )
}

function ReferencesEmpty({ domain }: { domain: string }) {
  const client = useQueryClient()
  const sync = useResourceSync(domain)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const start = async () => {
    setStarting(true)
    setStartError(null)
    try {
      const status = await api.startResourceSync(domain)
      // Polling starts from this answer; the hook refreshes the links when the sync is done.
      client.setQueryData(queryKeys.resourceSync(domain), status)
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'The sync could not start')
    } finally {
      setStarting(false)
    }
  }

  if (sync.isPending) return <p className="muted">No references synced yet.</p>
  if (sync.data === null) return <p className="muted">No references for this roadmap yet.</p>

  const running = sync.data?.state === 'running'
  const failed = sync.data?.state === 'failed'
  const error = startError ?? (failed ? (sync.data?.error ?? 'The sync failed.') : null)

  return (
    <div className="references-empty">
      <p className="muted">
        {sync.data?.state === 'done' ? 'The last sync found no references for this topic.' : 'No references synced yet.'}
      </p>
      {running ? (
        <p className="muted" role="status">
          Syncing references…
        </p>
      ) : (
        <button type="button" onClick={() => void start()} disabled={starting || sync.isError}>
          <Icon name="retry" /> Sync references
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          Sync failed: {error}
        </p>
      )}
      {sync.isError && <p className="error">Could not read the sync status.</p>}
    </div>
  )
}
