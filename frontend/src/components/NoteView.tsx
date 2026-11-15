import { useEffect, useRef, useState } from 'react'
import { api, type Note, type Roadmap } from '../api'
import { domainOf } from '../lib/grouping'
import { routeHash, setLeaveGuard } from '../lib/route'
import { ActionMenu } from './ActionMenu'
import { Icon } from './Icon'
import { DISCARD_PROMPT, NoteEditor } from './NoteEditor'
import { NodePicker } from './NodePicker'

const UNDO_MS = 8000

type Undo =
  | { kind: 'title'; previous: string; current: string }
  | { kind: 'link'; previous: string | null; current: string | null }

interface Props {
  note: Note
  roadmaps: Roadmap[]
  onClose: () => void
  onChanged: () => Promise<void>
  onDeleted: () => void
}

export function NoteView({ note, roadmaps, onClose, onChanged, onDeleted }: Props) {
  const [title, setTitle] = useState(note.title)
  const [renaming, setRenaming] = useState(false)
  const [undo, setUndo] = useState<Undo | null>(null)
  const undoTimer = useRef<number | undefined>(undefined)
  const titleInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editorDirty, setEditorDirty] = useState(false)
  // Bumped after a page save, so the frame reloads the stored page.
  const [version, setVersion] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const savedNode = note.node_id && !note.node_missing ? note.node_id : null
  const [pickedNode, setPickedNode] = useState<string | null>(savedNode)
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

  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setError(null)
    try {
      await action()
      await onChanged()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      return false
    }
  }

  const showUndo = (next: Undo | null) => {
    window.clearTimeout(undoTimer.current)
    setUndo(next)
    if (next) undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS)
  }
  useEffect(() => () => window.clearTimeout(undoTimer.current), [])

  const nodeTitle = (id: string | null) => {
    if (!id) return 'Unlinked'
    for (const roadmap of roadmaps) {
      const node = roadmap.nodes.find((n) => n.full_id === id)
      if (node) return node.title
    }
    return id
  }

  // A saved link change (or another note) resets the pending pick (state adjusted during render).
  const [pickedFor, setPickedFor] = useState({ id: note.id, node: savedNode })
  if (pickedFor.id !== note.id || pickedFor.node !== savedNode) {
    setPickedFor({ id: note.id, node: savedNode })
    setPickedNode(savedNode)
  }

  const linkDirty = pickedNode !== savedNode

  const canSaveTitle = title.trim() !== '' && title.trim() !== note.title

  const startRename = () => {
    setTitle(note.title)
    setRenaming(true)
  }
  const cancelRename = () => {
    setRenaming(false)
    setTitle(note.title)
  }

  useEffect(() => {
    if (!renaming) return
    titleInput.current?.focus()
    titleInput.current?.select()
  }, [renaming])

  const rename = async () => {
    if (!canSaveTitle) return
    const previous = note.title
    const next = title.trim()
    if (await run(() => api.rename(note.id, next))) {
      setRenaming(false)
      showUndo({ kind: 'title', previous, current: next })
    }
  }

  const saveLink = async () => {
    const previous = savedNode
    const next = pickedNode
    if (await run(() => api.link(note.id, next))) showUndo({ kind: 'link', previous, current: next })
  }

  const undoChange = async () => {
    if (!undo) return
    const last = undo
    showUndo(null)
    await run(() => (last.kind === 'title' ? api.rename(note.id, last.previous) : api.link(note.id, last.previous)))
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
          {renaming ? (
            <>
              <input
                ref={titleInput}
                className="title-input"
                aria-label="Note title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void rename()
                  if (e.key === 'Escape') cancelRename()
                }}
              />
              <span className="title-actions">
                <button type="button" className="primary" aria-label="Save title" disabled={!canSaveTitle} onClick={() => void rename()}>
                  Save
                </button>
                <button type="button" aria-label="Cancel title change" onClick={cancelRename}>
                  Cancel
                </button>
              </span>
            </>
          ) : (
            <>
              <h1 className="note-title" title={note.title}>
                {note.title}
              </h1>
              <button type="button" className="icon icon-only" aria-label="Rename" title="Rename" onClick={startRename}>
                <Icon name="edit" />
              </button>
            </>
          )}
          <label className="link-field" onKeyDown={(e) => e.key === 'Escape' && setPickedNode(savedNode)}>
            <span className="muted">Linked to</span>
            <NodePicker roadmaps={roadmaps} label="Linked to" value={pickedNode} onChange={setPickedNode} />
          </label>
          {linkDirty && (
            <span className="title-actions">
              <button type="button" className="primary" aria-label="Save link" onClick={() => void saveLink()}>
                Save link
              </button>
              <button type="button" aria-label="Cancel link change" onClick={() => setPickedNode(savedNode)}>
                Cancel link change
              </button>
            </span>
          )}
          {savedNode && (
            <a
              className="open-lesson"
              href={routeHash({ page: 'lesson', domain: domainOf(savedNode), node: savedNode.slice(savedNode.indexOf('/') + 1) })}
            >
              Open lesson
            </a>
          )}
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
              <button type="button" role="menuitem" onClick={() => choose(startRename)}>
                <Icon name="edit" />
                Rename
              </button>
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
      {undo && (
        <p className="undo-line" role="status">
          {undo.kind === 'title'
            ? `Renamed to ‘${undo.current}’.`
            : undo.current
              ? `Linked to ${nodeTitle(undo.current)}.`
              : 'Unlinked.'}{' '}
          <button type="button" className="link" onClick={() => void undoChange()}>
            Undo
          </button>
        </p>
      )}
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
