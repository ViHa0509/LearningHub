import { useEffect, useEffectEvent, useRef, useState, type DragEvent } from 'react'
import type { ChatPage, Effort } from '../api'
import { useAgents, useProviders } from '../hooks'
import {
  DEFAULT_PROVIDER,
  readEffort,
  readProviderChoice,
  saveEffort,
  saveProviderChoice,
} from '../lib/agentPrefs'
import { readAttachments, type Attachment, type ReadyAttachment } from '../lib/attachments'
import { expandSkill } from '../lib/skills'
import { AgentHeader } from './agent/AgentHeader'
import { Composer } from './agent/Composer'
import { MessageList } from './agent/MessageList'
import { useAgentChat } from './agent/useAgentChat'

export interface AgentRequest {
  id: number
  text: string
  /** The agent that should answer; the assistant when absent. */
  agentId?: string
}

interface Props {
  open: boolean
  onToggle: () => void
  page: ChatPage
  request: AgentRequest | null
}

const ASSISTANT = 'assistant'
const FALLBACK_AGENTS = [{ id: ASSISTANT, name: 'Learning assistant', description: 'Answers from your notes and lessons.' }]
/** What is sent when a message carries files but no text. */
const FILES_ONLY = 'Read the attached files.'

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

export function AgentPanel({ open, onToggle, page, request }: Props) {
  const providers = useProviders()
  const agents = useAgents()
  const available = (providers.data ?? []).filter((p) => p.is_active)
  const ready = available.length > 0
  // What "Agent default" means right now: the assistant's resolved provider.
  const defaultProvider = agents.data?.find((a) => a.id === ASSISTANT)?.effective ?? available[0] ?? null

  const [choice, setChoice] = useState(readProviderChoice)
  // A saved choice that is no longer active falls back to the agent default.
  const providerId = available.some((p) => p.id === choice) ? choice : DEFAULT_PROVIDER
  const [effort, setEffort] = useState<Effort>(readEffort)
  const [agentId, setAgentId] = useState(ASSISTANT)
  const chat = useAgentChat({ providerId, effort, page })

  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dropping, setDropping] = useState(false)
  const dragDepth = useRef(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const handled = useRef<number | null>(null)

  const agentList = agents.data?.length ? agents.data : FALLBACK_AGENTS
  const files = attachments.filter((a): a is ReadyAttachment => a.kind === 'ok')

  // The header names the provider that answers the chosen agent (the chat's choice applies to the assistant).
  const hintProvider =
    agentId === ASSISTANT
      ? (available.find((p) => p.id === providerId) ?? defaultProvider)
      : agents.data?.find((a) => a.id === agentId)?.effective
  const hint = hintProvider ? `via ${hintProvider.name}` : 'No provider'

  const chooseProvider = (next: string) => {
    setChoice(next)
    saveProviderChoice(next)
  }

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
    if (chat.busy || (!text && files.length === 0)) return
    // The conversation shows what the user typed; the request carries the expanded skill message.
    void chat.send({ display: text, content: text ? expandSkill(text) : FILES_ONLY, attachments: files, agentId })
    setDraft('')
    setAttachments([])
  }

  // A request from elsewhere in the app (e.g. "Draft with agent"), sent once per id.
  const sendRequest = useEffectEvent((next: AgentRequest) => {
    if (handled.current === next.id) return
    handled.current = next.id
    void chat.send({ display: next.text, content: next.text, attachments: [], agentId: next.agentId ?? ASSISTANT })
  })
  useEffect(() => {
    if (request && ready) sendRequest(request)
  }, [request, ready])

  return (
    <aside className="pane right agent-pane" aria-label="Agent" data-collapsed={!open}>
      <AgentHeader
        open={open}
        onToggle={onToggle}
        chat={
          ready
            ? {
                agents: agentList,
                agentId,
                onAgent: setAgentId,
                hint,
                canClear: !chat.busy && chat.entries.length > 0,
                onClear: chat.clear,
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
            providers={available}
            providerId={providerId}
            onProvider={chooseProvider}
            defaultProvider={defaultProvider}
            providerLocked={
              agentId === ASSISTANT
                ? null
                : 'This agent uses the provider assigned to it in Settings.'
            }
            busy={chat.busy}
            canSend={draft.trim() !== '' || files.length > 0}
            dropping={dropping}
            onSubmit={submit}
          />
        </div>
      )}
    </aside>
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
