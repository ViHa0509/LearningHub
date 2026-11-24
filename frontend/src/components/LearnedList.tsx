import { useEffect, useRef, useState, type DragEvent } from 'react'
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
const UNSORTED = 'unsorted'

/** One line after Archive or after a drop; `previous` is the link a drop replaced. */
type Undo =
  | { kind: 'archived'; id: string; title: string }
  | { kind: 'moved'; id: string; title: string; target: string; previous: string | null; canUndo: boolean }

/** The note being dragged and the drop target under the pointer (a node `full_id` or 'unsorted'). */
interface Drag {
  note: Note
  over: string | null
}

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
  const [undo, setUndo] = useState<Undo | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [renamingCat, setRenamingCat] = useState<{ from: string; draft: string } | null>(null)
  const [grouping, setGrouping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const triggers = useRef(new Map<string, HTMLButtonElement>())
  const undoTimer = useRef<number | undefined>(undefined)

  const dragTimer = useRef<number | undefined>(undefined)

  useEffect(
    () => () => {
      window.clearTimeout(undoTimer.current)
      window.clearTimeout(dragTimer.current)
    },
    [],
  )

  const showUndo = (next: Undo) => {
    setUndo(next)
    window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS)
  }

  const knownNodes = new Set(roadmaps.flatMap((r) => r.nodes.map((n) => n.full_id)))
  /** Where the list shows the note now: its node, or Unsorted for no link or a missing node. */
  const placeOf = (note: Note) =>
    note.node_id === null || note.node_missing || !knownNodes.has(note.node_id) ? UNSORTED : note.node_id

  const startDrag = (e: DragEvent<HTMLElement>, note: Note) => {
    e.dataTransfer.setData('application/x-learninghub-note', note.id)
    e.dataTransfer.effectAllowed = 'move'
    setMenuFor(null)
    // Chromium ends a drag when the DOM changes inside dragstart, so the state is set a tick later.
    window.clearTimeout(dragTimer.current)
    dragTimer.current = window.setTimeout(() => setDrag({ note, over: null }), 0)
  }

  const endDrag = () => {
    window.clearTimeout(dragTimer.current)
    setDrag(null)
  }

  const canDropOn = (key: string) => drag !== null && placeOf(drag.note) !== key

  const dropProps = (key: string, title: string) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!canDropOn(key)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDrag((d) => (d && d.over !== key ? { ...d, over: key } : d))
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setDrag((d) => (d && d.over === key ? { ...d, over: null } : d))
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      // The note comes from state: dataTransfer can be filled by another page.
      const note = drag?.note
      endDrag()
      if (note && placeOf(note) !== key) void drop(note, key === UNSORTED ? null : key, title)
    },
  })

  const drop = async (note: Note, target: string | null, targetTitle: string) => {
    setMenuFor(null)
    if (await run(() => api.link(note.id, target), 'Move failed')) {
      showUndo({
        kind: 'moved',
        id: note.id,
        title: note.title,
        target: targetTitle,
        previous: note.node_id,
        canUndo: !note.node_missing,
      })
    }
  }

  const undoMove = async (line: Extract<Undo, { kind: 'moved' }>) => {
    if (await run(() => api.link(line.id, line.previous), 'Undo failed')) setUndo(null)
  }

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
      showUndo({ kind: 'archived', id: note.id, title: note.title })
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

  const groupWithAi = async () => {
    setGrouping(true)
    await run(() => api.categorize(), 'Grouping failed')
    setGrouping(false)
  }

  const saveCategory = async () => {
    if (!renamingCat) return
    const { from, draft } = renamingCat
    setRenamingCat(null)
    await run(() => api.renameCategory(from, draft.trim()), 'Rename failed')
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
      {undo.kind === 'archived' ? `Archived ‘${undo.title}’.` : `Moved ‘${undo.title}’ to ${undo.target}.`}
      {(undo.kind === 'archived' || undo.canUndo) && (
        <>
          {' '}
          <button
            type="button"
            className="link"
            onClick={() => void (undo.kind === 'archived' ? restore({ id: undo.id }) : undoMove(undo))}
          >
            Undo
          </button>
        </>
      )}
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

  const grouped = groupNotes(notes, roadmaps, filter, { allTopics: drag !== null })

  const hasCategories = grouped.unsorted.some((g) => g.category !== null)
  const draftName = renamingCat?.draft.trim() ?? ''
  const canSaveCategory = draftName !== '' && draftName.length <= 40 && draftName !== renamingCat?.from

  const item = (note: Note) => {
    const highlighted = note.id === selectedNoteId || (!!selectedNodeId && note.node_id === selectedNodeId)
    const menuOpen = menuFor === note.id
    const draggable = renaming?.id !== note.id
    return (
      <li
        key={note.id}
        className={highlighted ? 'note-item highlighted' : 'note-item'}
        draggable={draggable}
        onDragStart={draggable ? (e) => startDrag(e, note) : undefined}
        onDragEnd={draggable ? endDrag : undefined}
      >
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
            {note.source === 'agent' && (
              <span className="tag agent" title="Saved by the learning agent">
                agent
              </span>
            )}
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
            <div
              key={node.full_id}
              className={drag?.over === node.full_id ? 'node-group drop-target' : 'node-group'}
              aria-label={`${domain.title} > ${node.title}`}
              role="group"
              {...dropProps(node.full_id, node.title)}
            >
              <h4>{node.title}</h4>
              {nodeNotes.length > 0 ? <ul>{nodeNotes.map(item)}</ul> : <p className="muted drop-hint">Drop here</p>}
            </div>
          ))}
        </section>
      ))}
      {(grouped.unsorted.length > 0 || drag) && (
        <section
          aria-label="Unsorted"
          className={drag?.over === UNSORTED ? 'domain-group drop-target' : 'domain-group'}
          {...dropProps(UNSORTED, 'Unsorted')}
        >
          <div className="group-head">
            <h3>Unsorted</h3>
            <button
              type="button"
              disabled={grouping}
              title="Sends the titles and the start of each unsorted note to the Note sorter agent. Running it again regroups every unsorted note, including groups you renamed."
              onClick={() => void groupWithAi()}
            >
              {grouping ? 'Grouping…' : 'Group with AI'}
            </button>
          </div>
          {grouped.unsorted.length === 0 && <p className="muted drop-hint">Drop here</p>}
          {grouped.unsorted.length > 0 && !hasCategories && <ul>{grouped.unsorted[0].notes.map(item)}</ul>}
          {hasCategories &&
            grouped.unsorted.map(({ category, notes: groupNotes }) => {
              const name = category ?? 'Other'
              return (
                <div key={name} className="node-group" role="group" aria-label={`Unsorted > ${name}`}>
                  {category !== null && renamingCat?.from === category ? (
                    <form
                      className="rename-form"
                      aria-label={`Rename group ${category}`}
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (canSaveCategory) void saveCategory()
                      }}
                    >
                      <input
                        className="rename-input"
                        aria-label="New name"
                        autoFocus
                        value={renamingCat.draft}
                        onChange={(e) => setRenamingCat({ from: category, draft: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            // Cancels the rename only, not the phone drawer around the list.
                            e.stopPropagation()
                            setRenamingCat(null)
                          }
                        }}
                      />
                      <button type="submit" className="primary" disabled={!canSaveCategory}>
                        Save
                      </button>
                      <button type="button" onClick={() => setRenamingCat(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <div className="group-head">
                      <h4>{name}</h4>
                      {category !== null && (
                        <button
                          type="button"
                          aria-label={`Rename group ${category}`}
                          onClick={() => setRenamingCat({ from: category, draft: category })}
                        >
                          Rename
                        </button>
                      )}
                    </div>
                  )}
                  <ul>{groupNotes.map(item)}</ul>
                </div>
              )
            })}
        </section>
      )}
      {grouped.domains.length === 0 && grouped.unsorted.length === 0 && !drag && (
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
