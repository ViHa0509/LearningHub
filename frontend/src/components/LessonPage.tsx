import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import Markdown from 'react-markdown'
import { api, queryKeys, type Note, type RoadmapNode } from '../api'
import { routeHash } from '../lib/route'

interface Props {
  domain: string
  node: string
  notes: Note[]
  /** Asks the agent to draft this lesson; absent when no provider is configured. */
  onDraft?: () => void
}

export function LessonPage({ domain, node, notes, onDraft }: Props) {
  const roadmap = useQuery({ queryKey: queryKeys.roadmap(domain), queryFn: () => api.roadmap(domain) })
  const mapLink = routeHash({ page: 'roadmap', domain })

  if (roadmap.isPending) return <p className="page-status muted">Loading…</p>
  const current = roadmap.data?.nodes.find((n) => n.id === node)
  if (!roadmap.data || !current) {
    return (
      <section className="lesson-page" aria-label="Lesson not found">
        <h1>Lesson not found</h1>
        <p className="muted">
          There is no topic <code>{`${domain}/${node}`}</code> in the roadmaps.
        </p>
        {roadmap.data ? <a href={mapLink}>Back to the {roadmap.data.title} roadmap</a> : <a href="#/">Back to home</a>}
      </section>
    )
  }

  const byId = new Map(roadmap.data.nodes.map((n) => [n.id, n]))
  const ancestors: RoadmapNode[] = []
  for (let parent = current.parent; parent; parent = byId.get(parent)?.parent ?? null) {
    const p = byId.get(parent)
    if (p) ancestors.unshift(p)
  }
  const children = roadmap.data.nodes.filter((n) => n.parent === current.id)
  const linked = notes.filter((n) => n.node_id === current.full_id)

  return (
    <article className="lesson-page" aria-label={`Lesson: ${current.title}`}>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a href={mapLink}>{roadmap.data.title}</a>
        {ancestors.map((a) => (
          <span key={a.id}>
            {' › '}
            <a href={routeHash({ page: 'lesson', domain, node: a.id })}>{a.title}</a>
          </span>
        ))}
        <span aria-current="page">{` › ${current.title}`}</span>
      </nav>
      <header className="lesson-header">
        <h1>{current.title}</h1>
        <a className="back-link" href={mapLink}>
          ← Back to map
        </a>
      </header>
      {current.description && <p className="lesson-description">{current.description}</p>}

      {children.length > 0 && (
        <section aria-label="Subtopics" className="lesson-section">
          <h2>Subtopics</h2>
          <ul className="chip-list">
            {children.map((c) => (
              <li key={c.id}>
                <a className="chip" href={routeHash({ page: 'lesson', domain, node: c.id })}>
                  {c.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Your notes" className="lesson-section">
        <h2>Your notes</h2>
        {linked.length === 0 ? (
          <p className="muted">No notes are linked to this topic yet.</p>
        ) : (
          <ul className="lesson-notes">
            {linked.map((n) => (
              <li key={n.id}>
                <a href={routeHash({ page: 'note', id: n.id })}>{n.title}</a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <LessonContent key={current.full_id} domain={domain} node={node} onDraft={onDraft} />

      <p className="further-reading">
        Further reading:{' '}
        <a href={`https://roadmap.sh/${domain}`} target="_blank" rel="noreferrer noopener">
          {roadmap.data.title} on roadmap.sh ↗
        </a>
      </p>
    </article>
  )
}

function LessonContent({ domain, node, onDraft }: { domain: string; node: string; onDraft?: () => void }) {
  const client = useQueryClient()
  const lesson = useQuery({ queryKey: queryKeys.lesson(domain, node), queryFn: () => api.lesson(domain, node) })
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (draft === null) return
    setSaving(true)
    setError(null)
    try {
      const saved = await api.saveLesson(domain, node, draft)
      client.setQueryData(queryKeys.lesson(domain, node), saved)
      setDraft(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saving failed')
    } finally {
      setSaving(false)
    }
  }

  const body = lesson.data?.body ?? ''

  return (
    <section aria-label="Lesson" className="lesson-section lesson-content">
      <div className="section-header">
        <h2>Lesson</h2>
        {draft === null && lesson.data && (
          <button type="button" onClick={() => setDraft(body)}>
            {body ? 'Edit lesson' : 'Write lesson'}
          </button>
        )}
      </div>
      {lesson.isError && <p className="error">Could not load the lesson.</p>}
      {draft !== null ? (
        <div className="lesson-editor">
          <textarea
            aria-label="Lesson text (Markdown)"
            value={draft}
            rows={14}
            onChange={(e) => setDraft(e.target.value)}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={() => void save()} disabled={saving}>
              Save lesson
            </button>
          </div>
        </div>
      ) : body ? (
        <div className="markdown" data-testid="lesson-body">
          {/* react-markdown never renders raw HTML from the text (no rehype-raw). */}
          <Markdown>{body}</Markdown>
        </div>
      ) : (
        lesson.data && (
          <div className="empty-lesson">
            <p className="muted">
              No lesson yet. Write down what you learned about this topic, or ask the agent to draft it.
            </p>
            {onDraft && (
              <button type="button" onClick={onDraft}>
                Draft with agent
              </button>
            )}
          </div>
        )
      )}
    </section>
  )
}
