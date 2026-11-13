import { useEffect, useRef, useState } from 'react'
import { api, type Note, type Roadmap } from '../api'
import { groupNotes } from '../lib/grouping'
import { ActionMenu } from './ActionMenu'
import { Icon } from './Icon'
import { NodePicker } from './NodePicker'

interface Props {
  notes: Note[]
  /** Archived notes, newest archived first. */
  archivedNotes?: Note[]
  roadmaps: Roadmap[]
  selectedNoteId: string | null
  selectedNodeId: string | null
  onOpenNote: (note: Note) => void
  onImport: () => void
  /** Called after any change, to refresh every query that depends on notes. */
  onChanged?: () => Promise<void>
}

const UNDO_MS = 8000

export function LearnedList({
  notes,
  archivedNotes = [],
  roadmaps,
  selectedNoteId,
  selectedNodeId,
  onOpenNote,
  onImport,
  onChanged,
}: Props) {
  const [filter, setFilter] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null)
  const [moving, setMoving] = useState<{ note: Note; target: string | null } | null>(null)
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const triggers = useRef(new Map<string, HTMLButtonElement>())
  const undoTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(undoTimer.current), [])

  const run = async (action: () => Promise<unknown>, failure: string) => {
    setError(null)
    try {
      await action()
      await onChanged?.()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : failure)
      return false
    }
  }

  // Deferred, so the keystroke that ended a rename is not replayed on the trigger.
  const focusTrigger = (id: string) => window.setTimeout(() => triggers.current.get(id)?.focus(), 0)

  const closeMenu = (restoreFocus: boolean) => {
    const id = menuFor
    setMenuFor(null)
    if (restoreFocus && id) triggers.current.get(id)?.focus()
  }

  const archive = async (note: Note) => {
    setMenuFor(null)
    if (await run(() => api.setArchived(note.id, true), 'Archive failed')) {
      setUndo({ id: note.id, title: note.title })
      window.clearTimeout(undoTimer.current)
      undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS)
    }
  }

  const restore = async (note: { id: string }) => {
    if (await run(() => api.setArchived(note.id, false), 'Restore failed')) setUndo(null)
  }

  const saveRename = async (note: Note) => {
    const next = renaming?.draft.trim() ?? ''
    setRenaming(null)
    if (next && next !== note.title) await run(() => api.rename(note.id, next), 'Rename failed')
    focusTrigger(note.id)
  }

  const cancelRename = (note: Note) => {
    setRenaming(null)
    focusTrigger(note.id)
  }

  const saveMove = async () => {
    if (!moving) return
    const { note, target } = moving
    setMoving(null)
    await run(() => api.link(note.id, target), 'Move failed')
  }

  const remove = async (note: Note) => {
    setConfirmingId(null)
    await run(() => api.remove(note.id), 'Delete failed')
  }

  const needle = filter.trim().toLowerCase()
  const archivedShown = archivedNotes.filter((n) => n.title.toLowerCase().includes(needle))

  const undoLine = undo && (
    <p className="undo-line" role="status">
      Archived ‘{undo.title}’.{' '}
      <button type="button" className="link" onClick={() => void restore({ id: undo.id })}>
        Undo
      </button>
    </p>
  )

  const archivedSection = archivedNotes.length > 0 && (
    <section className="archived-section" aria-label="Archived">
      <h3>
        <button
          type="button"
          className="disclosure"
          aria-expanded={archivedOpen}
          onClick={() => setArchivedOpen(!archivedOpen)}
        >
          <Icon name="chevron-down" className={archivedOpen ? 'chev open' : 'chev'} /> Archived ({archivedNotes.length})
        </button>
      </h3>
      {archivedOpen && (
        <ul>
          {archivedShown.map((note) => (
            <li key={note.id} className="note-item archived">
              <button
                type="button"
                className="note-select"
                aria-pressed={note.id === selectedNoteId}
                onClick={() => onOpenNote(note)}
              >
                {note.title}
              </button>
              <div className="archived-actions">
              {confirmingId === note.id ? (
                <span className="confirm" role="alertdialog" aria-label={`Confirm delete ${note.title}`}>
                  Delete?
                  <button type="button" className="danger" onClick={() => void remove(note)}>
                    Yes, delete
                  </button>
                  <button type="button" onClick={() => setConfirmingId(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <>
                  <button type="button" aria-label={`Restore ${note.title}`} onClick={() => void restore(note)}>
                    <Icon name="restore" />
                    Restore
                  </button>
                  <button
                    type="button"
                    className="danger"
                    aria-label={`Delete ${note.title}`}
                    onClick={() => setConfirmingId(note.id)}
                  >
                    <Icon name="trash" />
                    Delete
                  </button>
                </>
              )}
              </div>
            </li>
          ))}
          {archivedShown.length === 0 && <li className="muted">No archived note matches “{filter}”.</li>}
        </ul>
      )}
    </section>
  )

  if (notes.length === 0) {
    return (
      <div className="learned-list">
        <div className="empty-state">
          <h2>Nothing learned yet</h2>
          <p>
            Import the HTML pages Claude generated for your research. Each one becomes a note you can
            place on a roadmap node and find again later.
          </p>
          <button type="button" className="primary" onClick={onImport}>
            Import HTML or PDF files
          </button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {undoLine}
        {archivedSection}
      </div>
    )
  }

  const grouped = groupNotes(notes, roadmaps, filter)

  const item = (note: Note) => {
    const highlighted = note.id === selectedNoteId || (!!selectedNodeId && note.node_id === selectedNodeId)
    const menuOpen = menuFor === note.id
    return (
      <li key={note.id} className={highlighted ? 'note-item highlighted' : 'note-item'}>
        {renaming?.id === note.id ? (
          <form
            className="rename-form"
            aria-label={`Rename ${note.title}`}
            onSubmit={(e) => {
              e.preventDefault()
              void saveRename(note)
            }}
          >
            <input
              className="rename-input"
              aria-label="New title"
              autoFocus
              value={renaming.draft}
              onChange={(e) => setRenaming({ id: note.id, draft: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  // Cancels the rename only, not the phone drawer around the list.
                  e.stopPropagation()
                  cancelRename(note)
                }
              }}
            />
            <button
              type="submit"
              className="primary"
              disabled={!renaming.draft.trim() || renaming.draft.trim() === note.title}
            >
              Save
            </button>
            <button type="button" onClick={() => cancelRename(note)}>
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="note-select"
            aria-pressed={highlighted}
            onClick={() => onOpenNote(note)}
          >
            {note.title}
            {note.node_missing && <span className="tag warn" title={`Node ${note.node_id} no longer exists`}>missing node</span>}
          </button>
        )}
        <button
          type="button"
          className="icon note-more"
          aria-label={`More actions for ${note.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          ref={(el) => {
            if (el) triggers.current.set(note.id, el)
            else triggers.current.delete(note.id)
          }}
          onClick={() => setMenuFor(menuOpen ? null : note.id)}
        >
          <Icon name="more" />
        </button>
        {menuOpen && (
          <NoteMenu
            onClose={closeMenu}
            onRename={() => {
              setMenuFor(null)
              setRenaming({ id: note.id, draft: note.title })
            }}
            onMove={() => {
              setMenuFor(null)
              setMoving({ note, target: note.node_missing ? null : note.node_id })
            }}
            onArchive={() => void archive(note)}
          />
        )}
      </li>
    )
  }

  return (
    <div className="learned-list">
      <div className="list-toolbar">
        <input
          type="search"
          placeholder="Filter by title"
          aria-label="Filter by title"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <button type="button" onClick={onImport}>
          <Icon name="import" />
          Import
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {undoLine}
      {grouped.domains.map((domain) => (
        <section key={domain.domainId} aria-label={domain.title} className="domain-group">
          <h3>{domain.title}</h3>
          {domain.nodes.map(({ node, notes: nodeNotes }) => (
            <div key={node.full_id} className="node-group" aria-label={`${domain.title} > ${node.title}`} role="group">
              <h4>{node.title}</h4>
              <ul>{nodeNotes.map(item)}</ul>
            </div>
          ))}
        </section>
      ))}
      {grouped.unsorted.length > 0 && (
        <section aria-label="Unsorted" className="domain-group">
          <h3>Unsorted</h3>
          <ul>{grouped.unsorted.map(item)}</ul>
        </section>
      )}
      {grouped.domains.length === 0 && grouped.unsorted.length === 0 && (
        <p className="muted">No note title matches “{filter}”.</p>
      )}
      {archivedSection}
      {moving && (
        <div className="dialog-backdrop">
          <div role="dialog" aria-modal="true" aria-label="Move to node" className="dialog move-dialog">
            <h2>Move “{moving.note.title}”</h2>
            <NodePicker
              roadmaps={roadmaps}
              label="Destination node"
              emptyLabel="Unsorted"
              value={moving.target}
              onChange={(target) => setMoving({ ...moving, target })}
            />
            <div className="dialog-actions">
              <button type="button" onClick={() => setMoving(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={moving.target === (moving.note.node_missing ? null : moving.note.node_id)}
                onClick={() => void saveMove()}
              >
                Move
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface MenuProps {
  onClose: (restoreFocus: boolean) => void
  onRename: () => void
  onMove: () => void
  onArchive: () => void
}

function NoteMenu({ onClose, onRename, onMove, onArchive }: MenuProps) {
  return (
    <ActionMenu label="Note actions" onClose={onClose} triggerSelector=".note-more">
      <button type="button" role="menuitem" onClick={onRename}>
        <Icon name="edit" />
        Rename
      </button>
      <button type="button" role="menuitem" onClick={onMove}>
        <Icon name="move" />
        Move to node
      </button>
      <button type="button" role="menuitem" onClick={onArchive}>
        <Icon name="archive" />
        Archive
      </button>
    </ActionMenu>
  )
}
