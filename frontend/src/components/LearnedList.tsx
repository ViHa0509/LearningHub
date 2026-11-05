import { useState } from 'react'
import type { Note, Roadmap } from '../api'
import { groupNotes } from '../lib/grouping'

interface Props {
  notes: Note[]
  roadmaps: Roadmap[]
  selectedNoteId: string | null
  selectedNodeId: string | null
  onSelectNote: (note: Note) => void
  onOpenNote: (note: Note) => void
  onImport: () => void
}

export function LearnedList({
  notes,
  roadmaps,
  selectedNoteId,
  selectedNodeId,
  onSelectNote,
  onOpenNote,
  onImport,
}: Props) {
  const [filter, setFilter] = useState('')

  if (notes.length === 0) {
    return (
      <div className="empty-state">
        <h2>Nothing learned yet</h2>
        <p>
          Import the HTML pages Claude generated for your research. Each one becomes a note you can
          place on a roadmap node and find again later.
        </p>
        <button type="button" className="primary" onClick={onImport}>
          Import HTML files
        </button>
      </div>
    )
  }

  const grouped = groupNotes(notes, roadmaps, filter)

  const item = (note: Note) => {
    const highlighted = note.id === selectedNoteId || (!!selectedNodeId && note.node_id === selectedNodeId)
    return (
      <li key={note.id} className={highlighted ? 'note-item highlighted' : 'note-item'}>
        <button
          type="button"
          className="note-select"
          aria-pressed={highlighted}
          onClick={() => onSelectNote(note)}
          onDoubleClick={() => onOpenNote(note)}
        >
          {note.title}
          {note.node_missing && <span className="tag warn" title={`Node ${note.node_id} no longer exists`}>missing node</span>}
        </button>
        <button
          type="button"
          className="icon"
          aria-label={`Open ${note.title}`}
          onClick={() => onOpenNote(note)}
        >
          Open
        </button>
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
          Import
        </button>
      </div>
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
    </div>
  )
}
