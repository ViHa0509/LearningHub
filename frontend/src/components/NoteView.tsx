import { useState } from 'react'
import { api, type Note, type Roadmap } from '../api'
import { NodePicker } from './NodePicker'

interface Props {
  note: Note
  roadmaps: Roadmap[]
  onClose: () => void
  onChanged: () => Promise<void>
  onDeleted: () => void
}

export function NoteView({ note, roadmaps, onClose, onChanged, onDeleted }: Props) {
  const [title, setTitle] = useState(note.title)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const run = async (action: () => Promise<unknown>) => {
    setError(null)
    try {
      await action()
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  const rename = () => {
    const next = title.trim()
    if (next && next !== note.title) void run(() => api.rename(note.id, next))
  }

  const remove = async () => {
    setError(null)
    try {
      await api.remove(note.id)
      await onChanged()
      onDeleted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
      setConfirming(false)
    }
  }

  return (
    <article className="note-view" aria-label={`Note: ${note.title}`}>
      <header className="note-header">
        <button type="button" onClick={onClose}>
          ← Back
        </button>
        <input
          className="title-input"
          aria-label="Note title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => e.key === 'Enter' && rename()}
        />
        <NodePicker
          roadmaps={roadmaps}
          label="Roadmap node"
          value={note.node_id && !note.node_missing ? note.node_id : null}
          onChange={(node) => void run(() => api.link(note.id, node))}
        />
        {note.node_missing && (
          <span className="tag warn">Linked node {note.node_id} no longer exists</span>
        )}
        {confirming ? (
          <span className="confirm" role="alertdialog" aria-label="Confirm delete">
            Delete this note and its original file?
            <button type="button" className="danger" onClick={() => void remove()}>
              Yes, delete
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" className="danger" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {/* No allow-same-origin: the page runs in an opaque origin and cannot reach the app. */}
      <iframe
        className="original"
        title={`Original page: ${note.title}`}
        src={api.originalUrl(note.id)}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
      />
    </article>
  )
}
