import { useEffect, useState } from 'react'
import { api, type Note, type Roadmap } from '../api'
import { setLeaveGuard } from '../lib/route'
import { DISCARD_PROMPT, NoteEditor } from './NoteEditor'
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
  const [editing, setEditing] = useState(false)
  const [editorDirty, setEditorDirty] = useState(false)
  // Bumped after a page save, so the frame reloads the stored page.
  const [version, setVersion] = useState(0)

  const run = async (action: () => Promise<unknown>) => {
    setError(null)
    try {
      await action()
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  const titleDirty = title !== note.title
  const canSaveTitle = title.trim() !== '' && title.trim() !== note.title

  const rename = () => {
    if (canSaveTitle) void run(() => api.rename(note.id, title.trim()))
  }

  // Unsaved page edits: any navigation away (Back, the list, links) asks first.
  useEffect(() => {
    if (!editorDirty) return
    setLeaveGuard(() => window.confirm(DISCARD_PROMPT))
    return () => setLeaveGuard(null)
  }, [editorDirty])

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
          onKeyDown={(e) => {
            if (e.key === 'Enter') rename()
            if (e.key === 'Escape') setTitle(note.title)
          }}
        />
        {titleDirty && (
          <span className="title-actions">
            <button type="button" className="primary" aria-label="Save title" disabled={!canSaveTitle} onClick={rename}>
              Save
            </button>
            <button type="button" aria-label="Cancel title change" onClick={() => setTitle(note.title)}>
              Cancel
            </button>
          </span>
        )}
        <NodePicker
          roadmaps={roadmaps}
          label="Roadmap node"
          value={note.node_id && !note.node_missing ? note.node_id : null}
          onChange={(node) => void run(() => api.link(note.id, node))}
        />
        {note.node_missing && (
          <span className="tag warn">Linked node {note.node_id} no longer exists</span>
        )}
        <div className="note-actions">
        {!editing && (
          <button type="button" onClick={() => setEditing(true)}>
            Edit page
          </button>
        )}
        {!editing && (
          <a
            className="button-link"
            href={api.printUrl(note.id)}
            target="_blank"
            rel="noopener noreferrer"
            title="Opens the page in a new tab with the print dialog: choose Save as PDF"
          >
            Export PDF
          </a>
        )}
        {note.archived_at ? (
          <button type="button" onClick={() => void run(() => api.setArchived(note.id, false))}>
            Restore
          </button>
        ) : (
          <button type="button" onClick={() => void run(() => api.setArchived(note.id, true))}>
            Archive
          </button>
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
        </div>
      </header>
      {note.archived_at && (
        <p className="archived-banner" role="status">
          This note is archived.
          <button type="button" aria-label="Restore this note" onClick={() => void run(() => api.setArchived(note.id, false))}>
            Restore
          </button>
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {editing ? (
        <NoteEditor
          note={note}
          onSaved={async () => {
            setVersion((v) => v + 1)
            await onChanged()
          }}
          onClose={() => setEditing(false)}
          onDirtyChange={setEditorDirty}
        />
      ) : (
        /* No allow-same-origin: the page runs in an opaque origin and cannot reach the app. */
        <iframe
          key={version}
          className="original"
          title={`Original page: ${note.title}`}
          src={api.originalUrl(note.id)}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
        />
      )}
    </article>
  )
}
