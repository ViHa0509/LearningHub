import { useState } from 'react'
import type { Note } from '../api'
import { useAllRoadmaps, useDomains, useNotes, useRefreshNotes } from '../hooks'
import { domainOf } from '../lib/grouping'
import { navigate, useRoute } from '../lib/route'
import { useTheme } from '../lib/theme'
import { AgentPanel } from './AgentPanel'
import { HomePage } from './HomePage'
import { ImportDialog } from './ImportDialog'
import { LearnedList } from './LearnedList'
import { LessonPage } from './LessonPage'
import { NoteView } from './NoteView'
import { RoadmapMap } from './RoadmapMap'
import { TopBar } from './TopBar'

export function AppShell() {
  const route = useRoute()
  const [theme, setTheme] = useTheme()
  const domains = useDomains()
  const notes = useNotes()
  const { roadmaps, ready: roadmapsReady } = useAllRoadmaps()
  const refresh = useRefreshNotes()

  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  // The node last opened from the list or the map; the map highlights it when shown again.
  const [lastNodeId, setLastNodeId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const openNote = route.page === 'note' ? (notes.data?.find((n) => n.id === route.id) ?? null) : null
  const selectedNodeId =
    route.page === 'lesson'
      ? `${route.domain}/${route.node}`
      : route.page === 'note'
        ? (openNote?.node_id ?? null)
        : lastNodeId

  const openNoteFromList = (note: Note) => {
    setLastNodeId(note.node_id && !note.node_missing ? note.node_id : null)
    navigate({ page: 'note', id: note.id })
  }

  const openLesson = (fullId: string) => {
    setLastNodeId(fullId)
    const [domain, node] = fullId.split('/')
    navigate({ page: 'lesson', domain, node })
  }

  const leaveNote = (note: Note | null) => {
    if (note?.node_id && !note.node_missing) navigate({ page: 'roadmap', domain: domainOf(note.node_id) })
    else navigate({ page: 'home' })
  }

  const columns = [leftOpen ? 'minmax(240px, 22%)' : '44px', '1fr', rightOpen ? 'minmax(300px, 30%)' : '44px']

  let center: React.ReactNode = null
  if (route.page === 'home') {
    center = domains.data && <HomePage domains={domains.data} />
  } else if (route.page === 'roadmap') {
    center = domains.data && (
      <RoadmapMap
        domains={domains.data}
        domainId={route.domain}
        selectedNodeId={selectedNodeId}
        onSelectDomain={(domain) => navigate({ page: 'roadmap', domain })}
        onSelectNode={openLesson}
      />
    )
  } else if (route.page === 'lesson') {
    center = <LessonPage key={`${route.domain}/${route.node}`} domain={route.domain} node={route.node} notes={notes.data ?? []} />
  } else if (openNote) {
    center = (
      <NoteView
        key={openNote.id}
        note={openNote}
        roadmaps={roadmaps}
        onClose={() => leaveNote(openNote)}
        onChanged={refresh}
        onDeleted={() => leaveNote(null)}
      />
    )
  } else if (notes.data) {
    center = (
      <section className="lesson-page" aria-label="Note not found">
        <h1>Note not found</h1>
        <p className="muted">It may have been deleted.</p>
        <a href="#/">Back to home</a>
      </section>
    )
  }

  return (
    <div className="app-frame">
      <TopBar theme={theme} onThemeChange={setTheme} />
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
              selectedNoteId={route.page === 'note' ? route.id : null}
              selectedNodeId={selectedNodeId}
              onOpenNote={openNoteFromList}
              onImport={() => setImporting(true)}
            />
          )}
          {leftOpen && notes.isError && <p className="error">Could not load notes. Is the backend running?</p>}
        </aside>

        <main className="pane center" aria-label="Content">
          {center}
          {domains.isError && <p className="error">Could not load roadmaps. Is the backend running?</p>}
        </main>

        <AgentPanel open={rightOpen} onToggle={() => setRightOpen(!rightOpen)} />
      </div>

      {importing && <ImportDialog roadmaps={roadmaps} onClose={() => setImporting(false)} onChanged={refresh} />}
    </div>
  )
}
