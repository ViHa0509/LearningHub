import { useState } from 'react'
import { ApiError, api, type TopicInput } from '../api'
import { slugify } from '../lib/homeTab'
import { useUnsavedGuard } from '../lib/unsavedGuard'

interface Row {
  key: number
  title: string
  slug: string
  description: string
  parent: string
  /** Saved before: its slug is what notes link to, so it cannot change. */
  locked: boolean
  slugTouched: boolean
}

interface Props {
  area: string
  areaTitle: string
  /** The topics saved now, in order. */
  saved: TopicInput[]
  /** The topics to start from (the saved ones, or an agent's proposal); the saved ones when absent. */
  initial?: TopicInput[]
  onSaved: () => void | Promise<void>
  onCancel: () => void
}

let rowSeq = 0

const toInput = (r: Row): TopicInput => ({
  slug: r.slug.trim(),
  title: r.title.trim(),
  description: r.description.trim() || null,
  parent: r.parent || null,
})

const signature = (topics: TopicInput[]) =>
  JSON.stringify(topics.map((t) => [t.slug, t.title, t.description || null, t.parent || null]))

/** The messages of a refused save: the API's list of {msg}, or its single message. */
function problemsOf(error: unknown): string[] {
  if (error instanceof ApiError) {
    const detail = (error.body as { detail?: unknown } | undefined)?.detail
    if (Array.isArray(detail)) {
      const msgs = (detail as { msg?: string; field?: string }[])
        .map((d) => (d.msg ?? '').replace(/^Value error, /, ''))
        .filter(Boolean)
      if (msgs.length) return msgs
    }
    return [error.message]
  }
  return ['Could not save the topics.']
}

/** The topic editor of an area: rows of title, slug, parent, description; Save replaces the whole list. */
export function TopicEditor({ area, areaTitle, saved, initial, onSaved, onCancel }: Props) {
  const [rows, setRows] = useState<Row[]>(() => {
    const locked = new Set(saved.map((t) => t.slug))
    return (initial ?? saved).map((t) => ({
      key: ++rowSeq,
      title: t.title,
      slug: t.slug,
      description: t.description ?? '',
      parent: t.parent ?? '',
      locked: locked.has(t.slug),
      slugTouched: true,
    }))
  })
  const [problems, setProblems] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const dirty = signature(rows.map(toInput)) !== signature(saved)
  const guard = useUnsavedGuard(dirty)

  const change = (key: number, patch: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const move = (index: number, by: number) =>
    setRows((list) => {
      const next = [...list]
      const to = index + by
      if (to < 0 || to >= next.length) return list
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })
  const remove = (row: Row) =>
    setRows((list) => list.filter((r) => r.key !== row.key).map((r) => (r.parent === row.slug ? { ...r, parent: '' } : r)))
  const add = () =>
    setRows((list) => [
      ...list,
      { key: ++rowSeq, title: '', slug: '', description: '', parent: '', locked: false, slugTouched: false },
    ])

  const save = async () => {
    setSaving(true)
    setProblems([])
    try {
      await api.saveTopics(area, rows.map(toInput))
      guard.markClean()
      await onSaved()
    } catch (e) {
      setProblems(problemsOf(e))
    } finally {
      setSaving(false)
    }
  }

  const name = (r: Row, i: number) => r.title.trim() || `topic ${i + 1}`

  return (
    <form
      className="topic-editor"
      aria-label={`Topics of ${areaTitle}`}
      onSubmit={(e) => {
        e.preventDefault()
        if (dirty && !saving) void save()
      }}
    >
      <h2>Edit topics of {areaTitle}</h2>
      {rows.length === 0 && <p className="muted">No topics yet. Add the first one.</p>}
      <ol className="topic-rows">
        {rows.map((r, i) => (
          <li key={r.key} className="topic-row" aria-label={`Topic ${i + 1}`}>
            <label>
              Title
              <input
                aria-label={`Title of topic ${i + 1}`}
                value={r.title}
                maxLength={80}
                onChange={(e) =>
                  change(r.key, {
                    title: e.target.value,
                    ...(!r.locked && !r.slugTouched ? { slug: slugify(e.target.value) } : {}),
                  })
                }
              />
            </label>
            <label>
              Slug
              <input
                aria-label={`Slug of topic ${i + 1}`}
                value={r.slug}
                maxLength={40}
                readOnly={r.locked}
                onChange={(e) => change(r.key, { slug: e.target.value, slugTouched: true })}
              />
            </label>
            <label>
              Parent
              <select aria-label={`Parent of topic ${i + 1}`} value={r.parent} onChange={(e) => change(r.key, { parent: e.target.value })}>
                <option value="">No parent</option>
                {rows
                  .filter((o) => o.key !== r.key && o.slug.trim() !== '')
                  .map((o) => (
                    <option key={o.key} value={o.slug.trim()}>
                      {o.title.trim() || o.slug.trim()}
                    </option>
                  ))}
              </select>
            </label>
            <label className="topic-description">
              Description
              <input
                aria-label={`Description of topic ${i + 1}`}
                value={r.description}
                maxLength={300}
                onChange={(e) => change(r.key, { description: e.target.value })}
              />
            </label>
            <div className="topic-row-actions">
              <button type="button" aria-label={`Move ${name(r, i)} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <span aria-hidden="true">↑</span>
              </button>
              <button
                type="button"
                aria-label={`Move ${name(r, i)} down`}
                disabled={i === rows.length - 1}
                onClick={() => move(i, 1)}
              >
                <span aria-hidden="true">↓</span>
              </button>
              <button type="button" className="danger" aria-label={`Remove ${name(r, i)}`} onClick={() => remove(r)}>
                Remove
              </button>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" onClick={add}>
        <span aria-hidden="true">+ </span>Add topic
      </button>
      {problems.length > 0 && (
        <ul role="alert" className="error topic-problems">
          {problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!dirty || saving}>
          Save
        </button>
      </div>
    </form>
  )
}
