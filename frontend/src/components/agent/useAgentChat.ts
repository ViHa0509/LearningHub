import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { api, queryKeys, type AgentStep, type ChatPage, type ChatSessionDetail, type Effort } from '../../api'
import type { ReadyAttachment } from '../../lib/attachments'

/** One user message: what the user typed, what is sent, its files and the agent that answers it. */
export interface Turn {
  display: string
  content: string
  attachments: ReadyAttachment[]
  agentId: string
  /** A message read back from a stored chat: the names of its files (their text is not stored). */
  fileNames?: string[]
}

export interface Entry {
  id: number
  role: 'user' | 'assistant'
  /** The text sent as history (the expanded skill message for a user turn). */
  content: string
  turn?: Turn
  steps?: AgentStep[]
  error?: string
  /** Who answered, whether the fallback did, and with which effort. */
  answeredBy?: { name: string; model: string; fallback: boolean; effort: Effort }
  /** The id of the stored message; a question that failed has none. */
  messageId?: string
}

let seq = 0

/** Which chat is open, remembered per browser (guarded: storage may be blocked). */
const SESSION_KEY = 'lh.agent.session'

function readSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function saveSession(id: string | null) {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id)
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // The chat still works; it is just not shown again after a reload.
  }
}

/** A stored chat as the panel shows it: like the live conversation it once was. */
function toEntries(detail: ChatSessionDetail): Entry[] {
  return detail.messages.map((m) =>
    m.role === 'user'
      ? {
          id: ++seq,
          role: 'user',
          content: m.content,
          messageId: m.id,
          turn: {
            display: m.display ?? m.content,
            content: m.content,
            attachments: [],
            agentId: m.agent_id ?? 'assistant',
            fileNames: m.attachments,
          },
        }
      : {
          id: ++seq,
          role: 'assistant',
          content: m.content,
          messageId: m.id,
          steps: m.steps,
          answeredBy: m.provider
            ? { name: m.provider.name, model: m.provider.model, fallback: m.fallback_used, effort: m.effort ?? 'medium' }
            : undefined,
        },
  )
}

interface Options {
  effort: Effort
  page: ChatPage
}

export function useAgentChat({ effort, page }: Options) {
  const client = useQueryClient()
  const [entries, setEntries] = useState<Entry[]>([])
  const [busy, setBusy] = useState(false)
  // A stored chat is being read.
  const [loading, setLoading] = useState(() => readSession() !== null)
  // The stored chat this conversation belongs to; null until its first answer.
  const [sessionId, setSessionId] = useState<string | null>(null)
  const session = useRef<string | null>(null)

  const setSession = (id: string | null) => {
    session.current = id
    setSessionId(id)
    saveSession(id)
  }

  const newChat = () => {
    setEntries([])
    setSession(null)
  }

  /** Shows a stored chat; the next message continues it. A chat that is gone starts a new one. */
  const open = async (id: string) => {
    if (busy || loading) return
    setLoading(true)
    try {
      show(await read(id))
    } catch {
      show(null)
    }
  }

  const read = (id: string) =>
    client.fetchQuery({ queryKey: queryKeys.chatSession(id), queryFn: () => api.chatSession(id), staleTime: 0 })

  /** Puts a stored chat on screen; null (it is gone, or not this user's) starts a new chat. */
  const show = (detail: ChatSessionDetail | null) => {
    setEntries(detail ? toEntries(detail) : [])
    setSession(detail ? detail.id : null)
    setLoading(false)
  }

  // After a reload the chat that was open is shown again (`loading` starts true for it).
  const restore = useEffectEvent((live: () => boolean) => {
    const remembered = readSession()
    if (!remembered) return
    read(remembered).then(
      (detail) => live() && show(detail),
      () => live() && show(null),
    )
  })
  useEffect(() => {
    let mounted = true
    restore(() => mounted)
    return () => {
      mounted = false
    }
  }, [])

  /** `retryFrom`: the stored question this turn replaces (with everything after it). */
  const send = async (turn: Turn, base: Entry[] = entries, retryFrom?: string) => {
    if (busy || loading || (!turn.content.trim() && turn.attachments.length === 0)) return
    const question: Entry = { id: ++seq, role: 'user', content: turn.content, turn }
    setEntries([...base, question])
    setBusy(true)
    const current = session.current
    try {
      // The server holds the conversation of a stored chat: only the new message is sent.
      const answer = await api.chat({
        agent_id: turn.agentId,
        messages: [{ role: 'user', content: turn.content, display: turn.display }],
        page,
        effort,
        ...(current ? { session_id: current } : {}),
        ...(current && retryFrom ? { retry_from: retryFrom } : {}),
        ...(turn.attachments.length > 0
          ? { attachments: turn.attachments.map(({ name, text }) => ({ name, text })) }
          : {}),
      })
      setSession(answer.session.id)
      setEntries((list) => [
        ...list.map((entry) => (entry.id === question.id ? { ...entry, messageId: answer.user_message_id } : entry)),
        {
          id: ++seq,
          role: 'assistant',
          content: answer.reply,
          steps: answer.steps,
          messageId: answer.assistant_message_id,
          answeredBy: {
            name: answer.provider.name,
            model: answer.provider.model,
            fallback: answer.fallback_used,
            effort: answer.effort ?? effort,
          },
        },
      ])
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.chatSessions }),
        ...answer.changed_lessons.map((nodeId) => {
          const [domain, node] = nodeId.split('/')
          return client.invalidateQueries({ queryKey: queryKeys.lesson(domain, node) })
        }),
      ])
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The agent request failed'
      // The chat was deleted elsewhere: what is on screen goes on as a new chat when sent again.
      if (current && message === 'chat session not found') setSession(null)
      setEntries((list) => list.map((entry) => (entry.id === question.id ? { ...entry, error: message } : entry)))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Sends a turn again. A failed question is taken out and sent at the end; for an answer, the
   * question before it is sent again and the conversation from that question on is replaced
   * (in the stored chat too).
   */
  const retry = (entryId: number) => {
    const index = entries.findIndex((e) => e.id === entryId)
    if (index < 0) return
    const entry = entries[index]
    if (entry.role === 'user' && entry.turn) {
      void send(entry.turn, entries.filter((e) => e.id !== entryId))
      return
    }
    for (let i = index - 1; i >= 0; i--) {
      const question = entries[i]
      if (question.role === 'user' && question.turn) {
        void send(question.turn, entries.slice(0, i), question.messageId)
        return
      }
    }
  }

  /** A chat was deleted in History: when it is the open one, the panel starts a new chat. */
  const forget = (id: string) => {
    if (session.current === id) newChat()
  }

  return { entries, busy, loading, sessionId, send, retry, open, newChat, forget }
}
