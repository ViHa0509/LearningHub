import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ChatPage, Me, Note, ProposedTopics } from '../api'
import {
  useAllRoadmaps,
  useArchivedNotes,
  useDomains,
  useNotes,
  useAgentReady,
  useRefreshNotes,
  useServiceHealth,
  type ServiceHealth,
} from '../hooks'
import { useAuth } from '../lib/auth'
import { forgetReturn, parseAuthRoute, rememberReturn, returnRoute, useHash } from '../lib/authRoute'
import { domainOf } from '../lib/grouping'
import { usePaneWidths } from '../lib/paneWidths'
import { PaneHandle } from './PaneHandle'
import { isSettings, navigate, useRoute } from '../lib/route'
import { useScreenClass, type ScreenClass } from '../lib/useScreenClass'
import { useTheme, type Theme } from '../lib/theme'
import { forgetTimeZoneDismissal } from '../lib/timezonePrompt'
import { AgentPanel, type AgentRequest } from './AgentPanel'
import { AuthPages } from './AuthPages'
import { TimeZoneDialog } from './TimeZoneDialog'
import { ProfilePage } from './ProfilePage'
import { ProfileNav } from './ProfileNav'
import { SettingsNav } from './SettingsNav'
import { AgentsSettings } from './AgentsSettings'
import { AgentToolsSettings } from './AgentToolsSettings'
import { ConnectionsSettings } from './ConnectionsSettings'
import { DataSettings } from './DataSettings'
import { SignInSettings } from './SignInSettings'
import { AdminOnly } from './AdminOnly'
import { UsersSettings } from './UsersSettings'
import { HomePage } from './HomePage'
import { ImportDialog } from './ImportDialog'
import { LearnedList } from './LearnedList'
import { LessonPage } from './LessonPage'
import { NewsPage } from './NewsPage'
import { ExamPage } from './ExamPage'
import { NoteView } from './NoteView'
import { PracticePage } from './PracticePage'
import { AGENT_PANEL_ID, LEARNED_OPENER_ID, LEARNED_PANEL_ID, PanelFrame } from './PanelFrame'
import { RoadmapMap } from './RoadmapMap'
import { ProviderPage } from './ProviderPage'
import { ServiceUnavailable } from './ServiceUnavailable'
import { SettingsPage } from './SettingsPage'
import { TopBar } from './TopBar'

// The A2UI renderer, zod and markdown-it load only when the lab is opened.
const A2uiLabPage = lazy(() => import('./a2ui/A2uiLabPage'))

/**
 * The session gate. Without a required session (auth_required false) the app shows as it always
 * did. With one, `GET /api/auth/me` decides: no session shows the login page in place of the app,
 * on the same address, so signing in returns to the same page. `#/auth/...` addresses always show
 * the auth pages (links from emails, OAuth errors).
 */
export function AppShell() {
  const hash = useHash()
  const [theme, setTheme] = useTheme()
  const health = useServiceHealth()
  const auth = useAuth()
  const authRoute = parseAuthRoute(hash)
  const signedInUser = auth.me ?? null

  // An app page without a session: the login page shows in its place; come back here after.
  const needsLogin = auth.required && auth.me === null && !authRoute
  useEffect(() => {
    if (needsLogin) rememberReturn(hash)
  }, [needsLogin, hash])

  // Signing out (or an ended session) forgets that the time zone question was put off.
  useEffect(() => {
    if (auth.required && auth.me === null) forgetTimeZoneDismissal()
  }, [auth.required, auth.me])

  // Signed in already on the login or create page: go on to the app.
  const onEntryPage = authRoute?.page === 'login' || authRoute?.page === 'create' || authRoute?.page === 'signup'
  useEffect(() => {
    if (onEntryPage && signedInUser) {
      const target = returnRoute()
      forgetReturn()
      window.location.hash = target
    }
  }, [onEntryPage, signedInUser])

  // Nothing of the app shows (and no data is asked for) until the status, and the session when
  // one is required, are known.
  const statusLoading = !auth.status && !auth.statusFailed
  const meLoading = auth.required && auth.me === undefined && !auth.meFailed
  // Auth pages wait only for the status (owner, providers, mail): a page that posts a token
  // must not be unmounted and mounted again while `me` loads.
  const loading = statusLoading || (!authRoute && meLoading)

  if (authRoute || needsLogin || loading) {
    return (
      <div className="app-frame">
        {health.state === 'down' ? (
          <ServiceUnavailable health={health} />
        ) : loading ? (
          <main className="auth-page" aria-busy="true">
            <p className="app-loading muted" role="status">
              <span className="spinner" aria-hidden="true"></span>Loading…
            </p>
          </main>
        ) : (
          <AuthPages
            route={authRoute ?? { page: auth.status?.has_owner === false ? 'create' : 'login', params: new URLSearchParams() }}
            status={auth.status}
            next={authRoute ? returnRoute() : hash || '#/'}
          />
        )}
      </div>
    )
  }

  return <MainApp theme={theme} onThemeChange={setTheme} health={health} user={signedInUser} />
}

interface MainProps {
  theme: Theme
  onThemeChange: (theme: Theme) => void
  health: ServiceHealth
  /** The signed-in Owner when the app requires a session; null otherwise (no avatar menu). */
  user: Me | null
}

/** Which panels are open on entering a screen class (and when it changes). */
function panelDefaults(screenClass: ScreenClass) {
  return { left: screenClass !== 'phone', right: screenClass === 'desktop' }
}

function MainApp({ theme, onThemeChange, health, user }: MainProps) {
  const route = useRoute()
  const domains = useDomains()
  const notes = useNotes()
  const archived = useArchivedNotes()
  const { roadmaps, ready: roadmapsReady } = useAllRoadmaps()
  const refresh = useRefreshNotes()

  const screenClass = useScreenClass()
  const [leftOpen, setLeftOpen] = useState(() => panelDefaults(screenClass).left)
  const [rightOpen, setRightOpen] = useState(() => panelDefaults(screenClass).right)
  // A change of screen class resets the panels to that class's defaults; within a class the user's
  // choice stands. Done while rendering, so no frame shows the old state in the new layout.
  const [shownClass, setShownClass] = useState(screenClass)
  if (shownClass !== screenClass) {
    const defaults = panelDefaults(screenClass)
    setShownClass(screenClass)
    setLeftOpen(defaults.left)
    setRightOpen(defaults.right)
  }
  const phone = screenClass === 'phone'
  // On a tablet and a phone at most one side panel is open: opening one closes the other.
  const setLeft = (open: boolean) => {
    setLeftOpen(open)
    if (open && screenClass !== 'desktop') setRightOpen(false)
  }
  const setRight = (open: boolean) => {
    setRightOpen(open)
    if (open && screenClass !== 'desktop') setLeftOpen(false)
  }
  // The node last opened from the list or the map; the map highlights it when shown again.
  const [lastNodeId, setLastNodeId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [agentRequest, setAgentRequest] = useState<AgentRequest | null>(null)
  // Topics the outline agent proposed: the editor of their area opens filled with them.
  const [proposal, setProposal] = useState<ProposedTopics | null>(null)
  const reviewTopics = (proposed: ProposedTopics) => {
    setProposal(proposed)
    navigate({ page: 'roadmap', domain: proposed.area })
  }
  const agentAvailable = useAgentReady()

  const page: ChatPage =
    route.page === 'roadmap'
      ? { kind: 'roadmap', domain: route.domain }
      : route.page === 'lesson'
        ? { kind: 'lesson', domain: route.domain, node: route.node }
        : route.page === 'note'
          ? { kind: 'note', note_id: route.id }
          : { kind: 'home' }

  const askAgent = (text: string, agentId?: string, prefill = false) => {
    setRight(true)
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
    if (phone) setLeftOpen(false)
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

  // The left column lists the sections of Settings and of Profile; the Learned list elsewhere.
  const leftKind = isSettings(route) ? 'settings' : route.page === 'profile' ? 'profile' : 'learned'
  const leftTitle = { settings: 'Settings', profile: 'Profile', learned: 'Learned' }[leftKind]
  const leftNoun = { settings: 'settings sections', profile: 'profile sections', learned: 'learned list' }[leftKind]

  const shellRef = useRef<HTMLDivElement>(null)
  const [resizing, setResizing] = useState(false)
  const panes = usePaneWidths(shellRef, leftOpen, rightOpen)
  const columns = phone ? ['1fr'] : panes.columns
  const handle = (side: 'left' | 'right') => (
    <PaneHandle
      side={side}
      value={panes.value(side)}
      max={panes.max(side)}
      onChange={(width) => panes.set(side, width)}
      onReset={() => panes.set(side, null)}
      onDragging={setResizing}
    />
  )

  let center: React.ReactNode = null
  if (route.page === 'home') {
    center = domains.data && <HomePage />
  } else if (route.page === 'roadmap') {
    center = domains.data && (
      <RoadmapMap
        domains={domains.data}
        domainId={route.domain}
        selectedNodeId={selectedNodeId}
        onSelectDomain={(domain) => navigate({ page: 'roadmap', domain })}
        onSelectNode={openLesson}
        proposal={proposal}
        onProposalTaken={() => setProposal(null)}
        onDraft={
          agentAvailable
            ? () => askAgent(`Propose the topics of this area (${route.domain}).`, 'outline')
            : undefined
        }
      />
    )
  } else if (route.page === 'practice') {
    center = <PracticePage key={route.area} area={route.area} />
  } else if (route.page === 'exam') {
    center = <ExamPage key={route.id} id={route.id} />
  } else if (route.page === 'news') {
    // The chat sees the News page as home: the agent has no news context.
    center = <NewsPage onAskAgent={(text) => askAgent(text, undefined, true)} />
  } else if (route.page === 'a2ui-lab') {
    center = (
      <Suspense
        fallback={
          <p className="list-loading muted" role="status">
            <span className="spinner" aria-hidden="true"></span>Loading…
          </p>
        }
      >
        <A2uiLabPage />
      </Suspense>
    )
  } else if (route.page === 'settings') {
    center = <SettingsPage />
  } else if (route.page === 'sign-in-settings') {
    center = (
      <AdminOnly>
        <SignInSettings />
      </AdminOnly>
    )
  } else if (route.page === 'users-settings') {
    center = (
      <AdminOnly>
        <UsersSettings />
      </AdminOnly>
    )
  } else if (route.page === 'data-settings') {
    center = <DataSettings />
  } else if (route.page === 'profile') {
    center = <ProfilePage section={route.section} />
  } else if (route.page === 'agents-settings') {
    center = <AgentsSettings />
  } else if (route.page === 'agent-tools-settings') {
    center = <AgentToolsSettings />
  } else if (route.page === 'connections-settings') {
    center = <ConnectionsSettings />
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
      <TopBar
        theme={theme}
        onThemeChange={onThemeChange}
        user={user}
        screenClass={screenClass}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => setLeft(!leftOpen)}
        onToggleRight={() => setRight(!rightOpen)}
        leftPanelId={LEARNED_PANEL_ID}
        leftLabel={leftTitle}
        rightPanelId={AGENT_PANEL_ID}
      />
      {health.state === 'down' && <ServiceUnavailable health={health} />}
      {/* Hidden, not unmounted, during an outage: open drafts and the chat survive until it is back. */}
      <div
        ref={shellRef}
        className="app-shell"
        data-resizing={resizing}
        style={{ gridTemplateColumns: columns.join(' ') }}
        data-drawer-open={phone && (leftOpen || rightOpen)}
        hidden={health.state === 'down'}
      >
        {phone && (leftOpen || rightOpen) && (
          <div
            className="drawer-scrim"
            aria-hidden="true"
            onClick={() => {
              setLeftOpen(false)
              setRightOpen(false)
            }}
          />
        )}
        <PanelFrame
          id={LEARNED_PANEL_ID}
          className="pane left"
          asideLabel={leftKind === 'learned' ? 'Learned items' : leftTitle}
          drawerLabel={leftTitle}
          drawer={phone}
          open={leftOpen}
          onClose={() => setLeftOpen(false)}
          openerId={LEARNED_OPENER_ID}
        >
          <div className="pane-header">
            {leftOpen && <h2>{leftTitle}</h2>}
            {phone ? (
              <button type="button" className="icon" data-drawer-close="" aria-label={`Close ${leftNoun}`} onClick={() => setLeftOpen(false)}>
                ×
              </button>
            ) : (
              <button
                type="button"
                className="icon"
                aria-expanded={leftOpen}
                aria-label={leftOpen ? `Collapse ${leftNoun}` : `Expand ${leftNoun}`}
                onClick={() => setLeft(!leftOpen)}
              >
                {leftOpen ? '«' : '»'}
              </button>
            )}
          </div>
          {/* Wait for roadmaps too, so notes do not flash under "Unsorted" before grouping. */}
          {leftOpen && leftKind === 'settings' && <SettingsNav route={route} onPick={phone ? () => setLeftOpen(false) : undefined} />}
          {leftOpen && leftKind === 'profile' && <ProfileNav route={route} onPick={phone ? () => setLeftOpen(false) : undefined} />}
          {leftOpen && leftKind === 'learned' && notes.data && roadmapsReady && (
            <LearnedList
              notes={notes.data}
              archivedNotes={archived.data ?? []}
              roadmaps={roadmaps}
              selectedNoteId={route.page === 'note' ? route.id : null}
              selectedNodeId={route.page === 'lesson' ? selectedNodeId : null}
              onOpenNote={openNoteFromList}
              onImport={() => {
                setImporting(true)
                if (phone) setLeftOpen(false)
              }}
              onChanged={refresh}
            />
          )}
          {leftOpen && leftKind === 'learned' && !notes.isError && !(notes.data && roadmapsReady) && (
            <p className="list-loading muted">Loading your notes…</p>
          )}
          {leftOpen && leftKind === 'learned' && notes.isError && <p className="error">Could not load notes.</p>}
        </PanelFrame>

        <main className="pane center" aria-label="Content">
          {center}
          {domains.isError && <p className="error">Could not load roadmaps.</p>}
        </main>

        <AgentPanel
          open={rightOpen}
          onToggle={() => setRight(!rightOpen)}
          page={page}
          request={agentRequest}
          drawer={phone}
          onReviewTopics={reviewTopics}
        />
        {!phone && leftOpen && handle('left')}
        {!phone && rightOpen && handle('right')}
      </div>

      {user && <TimeZoneDialog user={user} />}
      {importing && <ImportDialog roadmaps={roadmaps} onClose={() => setImporting(false)} onChanged={refresh} />}
    </div>
  )
}
