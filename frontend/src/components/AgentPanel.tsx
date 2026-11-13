import { useEffect, useEffectEvent, useRef, useState, type DragEvent } from 'react'
import type { ChatPage, Effort } from '../api'
import { useAgents, useProviders } from '../hooks'
import { readEffort, saveEffort } from '../lib/agentPrefs'
import { readAttachments, type Attachment, type ReadyAttachment } from '../lib/attachments'
import { expandSkill } from '../lib/skills'
import { AgentHeader } from './agent/AgentHeader'
import { AGENT_OPENER_ID, AGENT_PANEL_ID, PanelFrame } from './PanelFrame'
import { Composer } from './agent/Composer'
import { HistoryList } from './agent/HistoryList'
import { MessageList } from './agent/MessageList'
import { useAgentChat } from './agent/useAgentChat'

export interface AgentRequest {
  id: number
  text: string
  /** The agent that should answer; the assistant when absent. */
  agentId?: string
  /** Put the text in the chat input for the user to send, instead of sending it. */
  prefill?: boolean
}

interface Props {
  open: boolean
  onToggle: () => void
  page: ChatPage
  request: AgentRequest | null
  /** On a phone the panel is a drawer over the page. */
  drawer?: boolean
}

const ASSISTANT = 'assistant'
const FALLBACK_AGENTS = [{ id: ASSISTANT, name: 'Learning assistant', description: 'Answers from your notes and lessons.' }]
/** What is sent when a message carries files but no text. */
const FILES_ONLY = 'Read the attached files.'

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

export function AgentPanel({ open, onToggle, page, request, drawer = false }: Props) {
  const providers = useProviders()
  const agents = useAgents()
  const available = (providers.data ?? []).filter((p) => p.is_active)
  const ready = available.length > 0
  const [effort, setEffort] = useState<Effort>(readEffort)
  const [agentId, setAgentId] = useState(ASSISTANT)
  const chat = useAgentChat({ effort, page })

  // History replaces the conversation and the input while it is open.
  const [historyOpen, setHistoryOpen] = useState(false)
  const working = chat.busy || chat.loading

  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dropping, setDropping] = useState(false)
  const dragDepth = useRef(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const handled = useRef<number | null>(null)

  const agentList = agents.data?.length ? agents.data : FALLBACK_AGENTS
  const files = attachments.filter((a): a is ReadyAttachment => a.kind === 'ok')

  // The header names the provider assigned to the chosen agent (Settings -> Agents decides).
  const hintProvider =
    agents.data?.find((a) => a.id === agentId)?.effective ?? (agentId === ASSISTANT ? available[0] : undefined)
  const hint = hintProvider ? `via ${hintProvider.name}` : 'No provider'

  const chooseEffort = (next: Effort) => {
    setEffort(next)
    saveEffort(next)
  }

  const addFiles = async (list: File[]) => {
    if (list.length === 0) return
    const items = await readAttachments(list, files.length)
    setAttachments((current) => [...current, ...items])
  }

  const submit = () => {
    const text = draft.trim()
    if (working || (!text && files.length === 0)) return
    // The conversation shows what the user typed; the request carries the expanded skill message.
    void chat.send({ display: text, content: text ? expandSkill(text) : FILES_ONLY, attachments: files, agentId })
    setDraft('')
    setAttachments([])
  }

  // A request to fill the input (e.g. "Ask the agent" on a news item): applied once per id, not sent.
  const [prefilled, setPrefilled] = useState<number | null>(null)
  if (request?.prefill && ready && prefilled !== request.id) {
    setPrefilled(request.id)
    if (request.agentId) setAgentId(request.agentId)
    setDraft(request.text)
  }

  // A request that is sent shows the conversation, not History.
  const [shownRequest, setShownRequest] = useState<number | null>(null)
  if (request && !request.prefill && ready && shownRequest !== request.id) {
    setShownRequest(request.id)
    setHistoryOpen(false)
  }

  // A request from elsewhere in the app (e.g. "Draft with agent"), sent once per id.
  const sendRequest = useEffectEvent((next: AgentRequest) => {
    if (handled.current === next.id) return
    handled.current = next.id
    if (next.prefill) {
      inputRef.current?.focus()
      return
    }
    void chat.send({ display: next.text, content: next.text, attachments: [], agentId: next.agentId ?? ASSISTANT })
  })
  useEffect(() => {
    if (request && ready) sendRequest(request)
  }, [request, ready])

  return (
    <PanelFrame
      id={AGENT_PANEL_ID}
      className="pane right agent-pane"
      asideLabel="Agent"
      drawerLabel="Agent"
      drawer={drawer}
      open={open}
      onClose={onToggle}
      openerId={AGENT_OPENER_ID}
    >
      <AgentHeader
        open={open}
        onToggle={onToggle}
        drawer={drawer}
        chat={
          ready
            ? {
                agents: agentList,
                agentId,
                onAgent: setAgentId,
                hint,
                canNew: !working && (chat.entries.length > 0 || chat.sessionId !== null),
                onNew: () => {
                  chat.newChat()
                  setHistoryOpen(false)
                  // The input is hidden behind History until the next render.
                  setTimeout(() => inputRef.current?.focus(), 0)
                },
                historyOpen,
                onHistory: () => setHistoryOpen(!historyOpen),
              }
            : null
        }
      />
      {open && providers.isError && <p className="agent-note error">Could not reach the backend.</p>}
      {open && providers.data && !ready && <NotConfigured />}
      {/* Kept mounted while collapsed, so the draft and attachments survive a collapse. */}
      {ready && (
        <div
          className="agent-chat"
          hidden={!open}
          onDragEnter={(e) => {
            if (!hasFiles(e)) return
            e.preventDefault()
            dragDepth.current += 1
            setDropping(true)
          }}
          onDragOver={(e) => {
            if (!hasFiles(e)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDragLeave={(e) => {
            if (!hasFiles(e)) return
            dragDepth.current = Math.max(0, dragDepth.current - 1)
            if (dragDepth.current === 0) setDropping(false)
          }}
          onDrop={(e) => {
            const dropped = Array.from(e.dataTransfer?.files ?? [])
            if (!hasFiles(e) && dropped.length === 0) return
            e.preventDefault()
            dragDepth.current = 0
            setDropping(false)
            void addFiles(dropped)
          }}
        >
          {historyOpen && open && (
            <HistoryList
              currentId={chat.sessionId}
              busy={working}
              onOpen={(id) => {
                setHistoryOpen(false)
                if (id !== chat.sessionId) void chat.open(id)
              }}
              onDeleted={chat.forget}
            />
          )}
          {/* Kept mounted behind History, so the draft and attachments survive. */}
          <div className="agent-chat-body" hidden={historyOpen}>
          <MessageList
            entries={chat.entries}
            busy={chat.busy}
            onRetry={chat.retry}
            onStarter={(text) => {
              setDraft(text)
              inputRef.current?.focus()
            }}
          />
          <Composer
            inputRef={inputRef}
            draft={draft}
            onDraft={setDraft}
            attachments={attachments}
            onAddFiles={(list) => void addFiles(list)}
            onRemoveAttachment={(id) => setAttachments((current) => current.filter((a) => a.id !== id))}
            effort={effort}
            onEffort={chooseEffort}
            busy={working}
            canSend={draft.trim() !== '' || files.length > 0}
            dropping={dropping}
            onSubmit={submit}
          />
          </div>
        </div>
      )}
    </PanelFrame>
  )
}

function NotConfigured() {
  return (
    <div className="agent-note" role="status">
      <p>
        <strong>No AI provider is configured.</strong>
      </p>
      <p>
        <a className="button-link primary" href="#/settings">
          Open settings
        </a>{' '}
        <span className="muted">and add a provider - the agent works at once.</span>
      </p>
    </div>
  )
}
