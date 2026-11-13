import { useEffect, useRef, useState } from 'react'
import { api, type Note, type Roadmap } from '../api'
import { setLeaveGuard } from '../lib/route'
import { ActionMenu } from './ActionMenu'
import { Icon } from './Icon'
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
  const [menuOpen, setMenuOpen] = useState(false)
  const moreButton = useRef<HTMLButtonElement>(null)

  const closeMenu = (restoreFocus: boolean) => {
    setMenuOpen(false)
    if (restoreFocus) moreButton.current?.focus()
  }

  /** A chosen menu action: the menu closes, the focus goes back to its button, the action runs. */
  const choose = (action: () => void) => {
    closeMenu(true)
    action()
  }

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
        <div className="note-fields">
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
        </div>
        <div className="note-actions">
          <button
            ref={moreButton}
            type="button"
            className="icon icon-only note-page-more"
            aria-label="More actions"
            title="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Icon name="more-vertical" />
          </button>
          {menuOpen && (
            <ActionMenu label="Note actions" onClose={closeMenu} triggerSelector=".note-page-more">
              {!editing && (
                <button type="button" role="menuitem" onClick={() => choose(() => setEditing(true))}>
                  <Icon name="edit" />
                  Edit page
                </button>
              )}
              {!editing && (
                <a
                  role="menuitem"
                  href={api.printUrl(note.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Opens the page in a new tab with the print dialog: choose Save as PDF"
                  onClick={() => setMenuOpen(false)}
                >
                  <Icon name="print" />
                  Export PDF
                </a>
              )}
              {note.archived_at ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => choose(() => void run(() => api.setArchived(note.id, false)))}
                >
                  <Icon name="archive" />
                  Restore
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => choose(() => void run(() => api.setArchived(note.id, true)))}
                >
                  <Icon name="archive" />
                  Archive
                </button>
              )}
              <div role="separator" className="menu-divider" />
              <button type="button" role="menuitem" className="danger" onClick={() => choose(() => setConfirming(true))}>
                <Icon name="trash" />
                Delete
              </button>
            </ActionMenu>
          )}
        </div>
      </header>
      {confirming && (
        <p className="note-confirm" role="alertdialog" aria-label="Confirm delete">
          Delete this note and its original file?
          <button type="button" className="danger" onClick={() => void remove()}>
            Yes, delete
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </p>
      )}
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
        <PageFrame key={version} note={note} />
      )}
    </article>
  )
}

/** The stored page in its isolated frame; until it has loaded, a loading indicator on the app's background. */
function PageFrame({ note }: { note: Note }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="original-wrap" data-loaded={loaded}>
      {!loaded && (
        <p className="page-loading muted" role="status">
          <span className="spinner" aria-hidden="true" />
          Loading page…
        </p>
      )}
      {/* No allow-same-origin: the page runs in an opaque origin and cannot reach the app. */}
      <iframe
        className="original"
        title={`Original page: ${note.title}`}
        src={api.originalUrl(note.id)}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
      />
    </div>
  )
}
