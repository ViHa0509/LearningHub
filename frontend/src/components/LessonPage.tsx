import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import Markdown from 'react-markdown'
import { api, queryKeys, type Note, type RoadmapNode } from '../api'
import { routeHash } from '../lib/route'
import { Icon } from './Icon'
import { LessonReferences } from './LessonReferences'

interface Props {
  domain: string
  node: string
  notes: Note[]
  /** Asks the agent to draft this lesson; absent when no provider is configured. */
  onDraft?: () => void
  /** Asks the agent to draft this lesson from its references; absent when no provider is configured. */
  onDraftFromReferences?: () => void
}

export function LessonPage({ domain, node, notes, onDraft, onDraftFromReferences }: Props) {
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

      <LessonContent key={current.full_id} domain={domain} node={node} title={current.title} onDraft={onDraft} />

      <LessonReferences
        key={`refs-${current.full_id}`}
        domain={domain}
        node={node}
        onDraftFromReferences={onDraftFromReferences}
      />

      <p className="further-reading">
        Further reading:{' '}
        <a href={`https://roadmap.sh/${domain}`} target="_blank" rel="noreferrer noopener">
          {roadmap.data.title} on roadmap.sh ↗
        </a>
      </p>
    </article>
  )
}

interface LessonContentProps {
  domain: string
  node: string
  /** The lesson title: the document title (and so the suggested file name) while printing. */
  title: string
  onDraft?: () => void
}

function LessonContent({ domain, node, title, onDraft }: LessonContentProps) {
  const client = useQueryClient()
  const lesson = useQuery({ queryKey: queryKeys.lesson(domain, node), queryFn: () => api.lesson(domain, node) })
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [reading, setReading] = useState(false)
  /** The extraction's warning (no text layer, cut at the limit), shown until the edit ends. */
  const [pdfNote, setPdfNote] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const save = async () => {
    if (draft === null) return
    setSaving(true)
    setError(null)
    try {
      const saved = await api.saveLesson(domain, node, draft)
      client.setQueryData(queryKeys.lesson(domain, node), saved)
      setDraft(null)
      setPdfNote(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saving failed')
    } finally {
      setSaving(false)
    }
  }

  const body = lesson.data?.body ?? ''

  const importPdf = async (file: File) => {
    setReading(true)
    setPdfError(null)
    setPdfNote(null)
    try {
      const extracted = await api.extractPdf(file)
      if (!extracted.markdown.trim()) {
        setPdfNote(extracted.warning ?? 'The PDF has no text to import.')
        return
      }
      // The editor's text if it is open, else the saved lesson: never replace text without asking.
      const current = draft ?? body
      if (current.trim() && !window.confirm(`Replace the lesson text with the text of ${file.name}?`)) return
      setError(null)
      setDraft(extracted.markdown)
      setPdfNote(extracted.warning)
    } catch (e) {
      setPdfError(`Could not import ${file.name}: ${e instanceof Error ? e.message : 'the request failed'}`)
    } finally {
      setReading(false)
    }
  }

  const exportPdf = () => {
    const root = document.documentElement
    const previousTitle = document.title
    let restored = false
    const restore = () => {
      if (restored) return
      restored = true
      document.title = previousTitle
      root.classList.remove('printing-lesson')
      window.removeEventListener('afterprint', restore)
    }
    // The browser suggests the document title as the PDF's file name.
    document.title = title
    root.classList.add('printing-lesson')
    window.addEventListener('afterprint', restore)
    try {
      window.print()
    } finally {
      // print() blocks until the dialog closes in most browsers; afterprint covers the others.
      restore()
    }
  }

  const exportTitle =
    draft !== null
      ? 'Save or cancel the edit before exporting'
      : body
        ? 'Print the lesson or save it as a PDF'
        : 'The lesson is empty; write or import it first'

  return (
    <section aria-label="Lesson" className="lesson-section lesson-content">
      <div className="section-header">
        <h2>Lesson</h2>
        {lesson.data && (
          <div className="section-actions">
            {draft === null && (
              <button
                type="button"
                onClick={() => {
                  setPdfNote(null)
                  setPdfError(null)
                  setDraft(body)
                }}
              >
                {body ? 'Edit lesson' : 'Write lesson'}
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,.pdf"
              aria-label="PDF file"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                // Cleared, so the same file can be picked again.
                e.target.value = ''
                if (file) void importPdf(file)
              }}
            />
            <button type="button" onClick={() => fileInput.current?.click()} disabled={reading || saving}>
              <Icon name="import" /> Import PDF
            </button>
            <button type="button" onClick={exportPdf} disabled={!body || draft !== null} title={exportTitle}>
              <Icon name="print" /> Export PDF
            </button>
          </div>
        )}
      </div>
      {lesson.isError && <p className="error">Could not load the lesson.</p>}
      {(reading || pdfNote) && (
        <p className="muted pdf-note" role="status">
          {reading ? 'Reading PDF…' : pdfNote}
        </p>
      )}
      {pdfError && (
        <p className="error" role="alert">
          {pdfError}
        </p>
      )}
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
            <button
              type="button"
              onClick={() => {
                setDraft(null)
                setPdfNote(null)
              }}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="button" className="primary" onClick={() => void save()} disabled={saving || reading}>
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
              No lesson yet. Write down what you learned about this topic
              {onDraft ? ', or ask the agent to draft it.' : '.'}
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
