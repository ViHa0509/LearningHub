import { useState } from 'react'
import type { Note } from '../api'
import { useAllRoadmaps, useDomains, useNotes, useRefreshNotes } from '../hooks'
import { domainOf } from '../lib/grouping'
import { AgentPanel } from './AgentPanel'
import { ImportDialog } from './ImportDialog'
import { LearnedList } from './LearnedList'
import { NoteView } from './NoteView'
import { RoadmapMap } from './RoadmapMap'

export function AppShell() {
  const domains = useDomains()
  const notes = useNotes()
  const { roadmaps, ready: roadmapsReady } = useAllRoadmaps()
  const refresh = useRefreshNotes()

  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [domainId, setDomainId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [openNoteId, setOpenNoteId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const currentDomain = domainId ?? domains.data?.[0]?.id ?? null
  const openNote = notes.data?.find((n) => n.id === openNoteId) ?? null

  const selectNote = (note: Note) => {
    setSelectedNoteId(note.id)
    if (note.node_id && !note.node_missing) {
      setDomainId(domainOf(note.node_id))
      setSelectedNodeId(note.node_id)
    } else {
      setSelectedNodeId(null)
    }
  }

  const selectNode = (fullId: string) => {
    setSelectedNodeId(fullId)
    setSelectedNoteId(null)
  }

  const selectDomain = (id: string) => {
    setDomainId(id)
    setSelectedNodeId(null)
  }

  const columns = [leftOpen ? 'minmax(240px, 22%)' : '44px', '1fr', rightOpen ? 'minmax(300px, 30%)' : '44px']

  return (
    <div className="app-shell" style={{ gridTemplateColumns: columns.join(' ') }}>
      <aside className="pane left" aria-label="Learned items" data-collapsed={!leftOpen}>
        <div className="pane-header">
          {leftOpen && <h2>Learned</h2>}
          <button
            type="button"
            className="icon"
            aria-expanded={leftOpen}
            aria-label={leftOpen ? 'Collapse learned list' : 'Expand learned list'}
            onClick={() => setLeftOpen(!leftOpen)}
          >
            {leftOpen ? '«' : '»'}
          </button>
        </div>
        {/* Wait for roadmaps too, so notes do not flash under "Unsorted" before grouping. */}
        {leftOpen && notes.data && roadmapsReady && (
          <LearnedList
            notes={notes.data}
            roadmaps={roadmaps}
            selectedNoteId={selectedNoteId}
            selectedNodeId={selectedNodeId}
            onSelectNote={selectNote}
            onOpenNote={(note) => {
              selectNote(note)
              setOpenNoteId(note.id)
            }}
            onImport={() => setImporting(true)}
          />
        )}
        {leftOpen && notes.isError && <p className="error">Could not load notes. Is the backend running?</p>}
      </aside>

      <main className="pane center" aria-label="Roadmap">
        {openNote ? (
          <NoteView
            key={openNote.id}
            note={openNote}
            roadmaps={roadmaps}
            onClose={() => setOpenNoteId(null)}
            onChanged={refresh}
            onDeleted={() => {
              setOpenNoteId(null)
              setSelectedNoteId(null)
            }}
          />
        ) : (
          currentDomain &&
          domains.data && (
            <RoadmapMap
              domains={domains.data}
              domainId={currentDomain}
              selectedNodeId={selectedNodeId}
              onSelectDomain={selectDomain}
              onSelectNode={selectNode}
            />
          )
        )}
        {domains.isError && <p className="error">Could not load roadmaps. Is the backend running?</p>}
      </main>

      <AgentPanel open={rightOpen} onToggle={() => setRightOpen(!rightOpen)} />

      {importing && (
        <ImportDialog roadmaps={roadmaps} onClose={() => setImporting(false)} onChanged={refresh} />
      )}
    </div>
  )
}
