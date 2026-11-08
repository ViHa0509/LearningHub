import { useState } from 'react'
import type { ChatPage, Note } from '../api'
import { useAllRoadmaps, useArchivedNotes, useDomains, useNotes, useProviders, useRefreshNotes, useServiceHealth } from '../hooks'
import { domainOf } from '../lib/grouping'
import { navigate, useRoute } from '../lib/route'
import { useTheme } from '../lib/theme'
import { AgentPanel, type AgentRequest } from './AgentPanel'
import { HomePage } from './HomePage'
import { ImportDialog } from './ImportDialog'
import { LearnedList } from './LearnedList'
import { LessonPage } from './LessonPage'
import { NewsPage } from './NewsPage'
import { NoteView } from './NoteView'
import { RoadmapMap } from './RoadmapMap'
import { ProviderPage } from './ProviderPage'
import { ServiceUnavailable } from './ServiceUnavailable'
import { SettingsPage } from './SettingsPage'
import { TopBar } from './TopBar'

export function AppShell() {
  const route = useRoute()
  const [theme, setTheme] = useTheme()
  const domains = useDomains()
  const notes = useNotes()
  const archived = useArchivedNotes()
  const { roadmaps, ready: roadmapsReady } = useAllRoadmaps()
  const refresh = useRefreshNotes()
  const health = useServiceHealth()

  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  // The node last opened from the list or the map; the map highlights it when shown again.
  const [lastNodeId, setLastNodeId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [agentRequest, setAgentRequest] = useState<AgentRequest | null>(null)
  const providers = useProviders()
  const agentAvailable = (providers.data ?? []).some((p) => p.is_active)

  const page: ChatPage =
    route.page === 'roadmap'
      ? { kind: 'roadmap', domain: route.domain }
      : route.page === 'lesson'
        ? { kind: 'lesson', domain: route.domain, node: route.node }
        : route.page === 'note'
          ? { kind: 'note', note_id: route.id }
          : { kind: 'home' }

  const askAgent = (text: string, agentId?: string, prefill = false) => {
    setRightOpen(true)
    setAgentRequest((previous) => ({ id: (previous?.id ?? 0) + 1, text, agentId, prefill }))
  }

  const openNote = route.page === 'note'
      ? (notes.data?.find((n) => n.id === route.id) ?? archived.data?.find((n) => n.id === route.id) ?? null)
      : null
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
  } else if (route.page === 'news') {
    // The chat sees the News page as home: the agent has no news context.
    center = <NewsPage onAskAgent={(text) => askAgent(text, undefined, true)} />
  } else if (route.page === 'settings') {
    center = <SettingsPage />
  } else if (route.page === 'provider') {
    center = <ProviderPage key={route.id} id={route.id} />
  } else if (route.page === 'lesson') {
    const fullId = `${route.domain}/${route.node}`
    center = (
      <LessonPage
        key={fullId}
        domain={route.domain}
        node={route.node}
        notes={notes.data ?? []}
        onDraft={agentAvailable ? () => askAgent(`Draft this lesson (${fullId}).`, 'lesson-writer') : undefined}
        onDraftFromReferences={
          agentAvailable
            ? () => askAgent(`Draft this lesson from its references (${fullId}).`, 'lesson-writer')
            : undefined
        }
      />
    )
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
  } else if (notes.data && archived.data && !archived.isFetching) {
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
      {health.state === 'down' && <ServiceUnavailable health={health} />}
      {/* Hidden, not unmounted, during an outage: open drafts and the chat survive until it is back. */}
      <div className="app-shell" style={{ gridTemplateColumns: columns.join(' ') }} hidden={health.state === 'down'}>
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
              archivedNotes={archived.data ?? []}
              roadmaps={roadmaps}
              selectedNoteId={route.page === 'note' ? route.id : null}
              selectedNodeId={selectedNodeId}
              onOpenNote={openNoteFromList}
              onImport={() => setImporting(true)}
              onChanged={refresh}
            />
          )}
          {leftOpen && !notes.isError && !(notes.data && roadmapsReady) && (
            <p className="list-loading muted">Loading your notes…</p>
          )}
          {leftOpen && notes.isError && <p className="error">Could not load notes.</p>}
        </aside>

        <main className="pane center" aria-label="Content">
          {center}
          {domains.isError && <p className="error">Could not load roadmaps.</p>}
        </main>

        <AgentPanel open={rightOpen} onToggle={() => setRightOpen(!rightOpen)} page={page} request={agentRequest} />
      </div>

      {importing && <ImportDialog roadmaps={roadmaps} onClose={() => setImporting(false)} onChanged={refresh} />}
    </div>
  )
}
