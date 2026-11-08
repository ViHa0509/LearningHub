import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, queryKeys, type AgentStep, type ChatPage, type Effort } from '../../api'
import type { ReadyAttachment } from '../../lib/attachments'

/** One user message: what the user typed, what is sent, its files and the agent that answers it. */
export interface Turn {
  display: string
  content: string
  attachments: ReadyAttachment[]
  agentId: string
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
}

let seq = 0

interface Options {
  /** The provider override for the assistant ('' = the agent default). */
  providerId: string
  effort: Effort
  page: ChatPage
}

export function useAgentChat({ providerId, effort, page }: Options) {
  const client = useQueryClient()
  const [entries, setEntries] = useState<Entry[]>([])
  const [busy, setBusy] = useState(false)

  const send = async (turn: Turn, base: Entry[] = entries) => {
    if (busy || (!turn.content.trim() && turn.attachments.length === 0)) return
    // Failed questions stay visible but are not sent again as history; attachments go only with their turn.
    const history = base.filter((e) => !e.error).map((e) => ({ role: e.role, content: e.content }))
    const question: Entry = { id: ++seq, role: 'user', content: turn.content, turn }
    setEntries([...base, question])
    setBusy(true)
    try {
      const answer = await api.chat({
        agent_id: turn.agentId,
        // The picker is for the chat; other agents use their own assignment.
        ...(turn.agentId === 'assistant' && providerId ? { provider_id: providerId } : {}),
        messages: [...history, { role: 'user', content: turn.content }],
        page,
        effort,
        ...(turn.attachments.length > 0
          ? { attachments: turn.attachments.map(({ name, text }) => ({ name, text })) }
          : {}),
      })
      setEntries((current) => [
        ...current,
        {
          id: ++seq,
          role: 'assistant',
          content: answer.reply,
          steps: answer.steps,
          answeredBy: {
            name: answer.provider.name,
            model: answer.provider.model,
            fallback: answer.fallback_used,
            effort: answer.effort ?? effort,
          },
        },
      ])
      await Promise.all(
        answer.changed_lessons.map((nodeId) => {
          const [domain, node] = nodeId.split('/')
          return client.invalidateQueries({ queryKey: queryKeys.lesson(domain, node) })
        }),
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The agent request failed'
      setEntries((current) => current.map((entry) => (entry.id === question.id ? { ...entry, error: message } : entry)))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Sends a turn again. A failed question is taken out and sent at the end; for an answer, the
   * question before it is sent again and the conversation from that question on is replaced.
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
        void send(question.turn, entries.slice(0, i))
        return
      }
    }
  }

  return { entries, busy, send, retry, clear: () => setEntries([]) }
}
