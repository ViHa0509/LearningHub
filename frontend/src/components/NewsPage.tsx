import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import type { NewsItem, NewsRefreshStatus } from '../api'
import { useNews, useNewsRefresh } from '../hooks'
import { Icon } from './Icon'
import { BlurFade } from './magicui/blur-fade'
import { NumberTicker } from './magicui/number-ticker'

/** How long the text filter waits after the last key before it asks the server. */
const FILTER_DELAY_MS = 300

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`

const formatDay = (date: Date) => date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

const formatClock = (date: Date) => date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

/** "Today", "Yesterday", or the date (e.g. "Nov 5, 2026"). */
function dayLabel(date: Date, now: Date): string {
  if (dayKey(date) === dayKey(now)) return 'Today'
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday'
  return formatDay(date)
}

/** The items (already newest first) in day groups, keeping their order. */
function groupByDay(items: NewsItem[], now: Date): { key: string; label: string; items: NewsItem[] }[] {
  const groups: { key: string; label: string; items: NewsItem[] }[] = []
  for (const item of items) {
    const date = new Date(item.published_at)
    const key = dayKey(date)
    const last = groups[groups.length - 1]
    if (last?.key === key) last.items.push(item)
    else groups.push({ key, label: dayLabel(date, now), items: [item] })
  }
  return groups
}

/** When the news was last refreshed, said briefly: "just now", "12 min ago", "9:30 AM" or a date. */
function describeRefresh(iso: string, now: Date): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (dayKey(date) === dayKey(now)) return formatClock(date)
  return `${formatDay(date)}, ${formatClock(date)}`
}

interface Props {
  /** Puts the text in the agent chat input (not sent) and opens the panel. */
  onAskAgent: (text: string) => void
}

/** AI news from the configured feeds: day groups, source and text filters, refresh. */
export function NewsPage({ onAskAgent }: Props) {
  const [source, setSource] = useState('')
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), FILTER_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text])

  const news = useNews({ source: source || undefined, q: q || undefined })
  const { status: refresh, start } = useNewsRefresh()
  const [startError, setStartError] = useState<string | null>(null)

  const startRefresh = () =>
    start().then(
      () => setStartError(null),
      (e: unknown) => setStartError(e instanceof Error ? e.message : 'The refresh could not start'),
    )

  const first = news.data?.pages[0]
  const sources = first?.sources ?? []
  const total = sources.reduce((n, s) => n + s.count, 0)
  const running = refresh.data?.state === 'running'

  // Opening the page after an hour without refresh (or with nothing stored) refreshes once per visit.
  const autoStarted = useRef(false)
  const needsRefresh = !!first && (first.stale || total === 0)
  const statusKnown = refresh.isSuccess
  const autoStart = useEffectEvent(() => {
    if (autoStarted.current) return
    autoStarted.current = true
    if (!running) void startRefresh()
  })
  useEffect(() => {
    if (needsRefresh && statusKnown) autoStart()
  }, [needsRefresh, statusKnown])

  // "Today" and relative times are measured from the last answer, so rendering stays pure.
  const now = new Date(Math.max(news.dataUpdatedAt, refresh.dataUpdatedAt))
  const seen = new Set<string>()
  const items = (news.data?.pages ?? []).flatMap((page) => page.items).filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
  const filtered = source !== '' || q !== ''

  return (
    <section className="news-page" aria-label="AI news">
      <header className="news-header">
        <div>
          <h1>AI news</h1>
          <p className="muted">Headlines from the AI labs and research sites you follow, newest first.</p>
          {first?.last_refresh_at && (
            <p className="muted news-refreshed">Last refreshed {describeRefresh(first.last_refresh_at, now)}</p>
          )}
        </div>
        <button type="button" onClick={() => void startRefresh()} disabled={running || !statusKnown}>
          <Icon name="retry" /> Refresh
        </button>
      </header>

      <RefreshStatus status={refresh.data} startError={startError} />
      {refresh.isError && <p className="error">Could not read the refresh status.</p>}

      <div className="news-filters">
        {sources.length > 0 && (
          <div className="chip-list news-chips" role="group" aria-label="Sources">
            <button type="button" className="chip" aria-pressed={source === ''} onClick={() => setSource('')}>
              All{' '}
              <span className="chip-count">
                <NumberTicker value={total} />
              </span>
            </button>
            {sources.map((s) => (
              <button
                key={s.id}
                type="button"
                className="chip"
                aria-pressed={source === s.id}
                onClick={() => setSource(s.id)}
              >
                {s.name}{' '}
                <span className="chip-count">
                  <NumberTicker value={s.count} />
                </span>
              </button>
            ))}
          </div>
        )}
        <label className="news-search">
          <Icon name="search" />
          <input
            type="search"
            aria-label="Filter news"
            placeholder="Filter news"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      </div>

      {news.isPending && <p className="muted">Loading…</p>}
      {news.isError && <p className="error">Could not load the news.</p>}
      {news.isSuccess && items.length === 0 && (
        <div className="news-empty">
          {filtered ? (
            <p className="muted">No news matches these filters.</p>
          ) : (
            <>
              <p>No news yet.</p>
              <p className="muted">{running ? 'The sources are being read now.' : 'Refresh to read the sources.'}</p>
            </>
          )}
        </div>
      )}

      {groupByDay(items, now).map((group) => (
        <section key={group.key} className="news-day" aria-label={group.label}>
          <h2>{group.label}</h2>
          <ul className="news-list">
            {group.items.map((item, index) => (
              <NewsCard key={item.id} item={item} index={index} onAskAgent={onAskAgent} />
            ))}
          </ul>
        </section>
      ))}

      {news.hasNextPage && (
        <button
          type="button"
          className="news-more"
          onClick={() => void news.fetchNextPage()}
          disabled={news.isFetchingNextPage}
        >
          {news.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  )
}

/** Items fade in one after the other for the first ten of a day, then at once. */
const FADE_STEP_S = 0.04
const FADE_STAGGERED = 10

function NewsCard({
  item,
  index,
  onAskAgent,
}: {
  item: NewsItem
  index: number
  onAskAgent: (text: string) => void
}) {
  const titleId = useId()
  const published = new Date(item.published_at)
  return (
    <BlurFade as="li" className="news-item" delay={index < FADE_STAGGERED ? index * FADE_STEP_S : 0}>
      <div className="news-meta muted">
        <span>{item.source_name}</span>
        {!Number.isNaN(published.getTime()) && (
          <>
            <span aria-hidden="true"> · </span>
            <time dateTime={item.published_at}>{formatClock(published)}</time>
          </>
        )}
      </div>
      {/* Feed text is untrusted: rendered as text only; noopener noreferrer gives the page no handle on the app. */}
      <p className="news-title" id={titleId}>
        <a href={item.url} target="_blank" rel="noopener noreferrer">
          {item.title}
        </a>
      </p>
      {item.summary && <p className="news-summary">{item.summary}</p>}
      <button
        type="button"
        className="news-ask"
        aria-describedby={titleId}
        onClick={() => onAskAgent(`Explain this news for me: ${item.title} (${item.url})`)}
      >
        <Icon name="sparkle" /> Ask the agent
      </button>
    </BlurFade>
  )
}

function RefreshStatus({ status, startError }: { status: NewsRefreshStatus | undefined; startError: string | null }) {
  if (startError) {
    return (
      <p className="error" role="alert">
        Refresh failed: {startError}
      </p>
    )
  }
  if (!status) return null
  if (status.state === 'running') {
    const all = status.sources.length
    const read = status.sources.filter((s) => s.ok !== null).length
    return (
      <p className="muted news-status" role="status">
        Refreshing news…{all > 0 && ` (${read} of ${all} sources)`}
      </p>
    )
  }
  if (status.state !== 'done' && status.state !== 'failed') return null
  const failed = status.sources.filter((s) => s.ok === false)
  if (failed.length === 0 && !status.error) return null
  return (
    <div className="news-warning">
      <p>{status.error ? `The refresh failed: ${status.error}` : 'Some sources could not be read:'}</p>
      {failed.length > 0 && (
        <ul aria-label="Failed sources">
          {failed.map((s) => (
            <li key={s.id}>
              {s.name}: {s.error ?? 'unknown error'}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
