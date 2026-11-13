import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, queryKeys, type ChatSessionSummary } from '../../api'
import { Icon } from '../Icon'

interface Props {
  /** The chat that is open in the panel, marked in the list. */
  currentId: string | null
  /** The agent is working: the open chat cannot be switched. */
  busy: boolean
  onOpen: (id: string) => void
  /** Called after a chat was deleted on the server. */
  onDeleted: (id: string) => void
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const countOf = (n: number) => `${n} ${n === 1 ? 'message' : 'messages'}`

/** The user's past chats, newest activity first: open one, rename it, or delete it. */
export function HistoryList({ currentId, busy, onOpen, onDeleted }: Props) {
  const client = useQueryClient()
  const list = useQuery({ queryKey: queryKeys.chatSessions, queryFn: api.chatSessions })
  const [renaming, setRenaming] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.chatSessions })
  const failed = (e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong')

  const rename = useMutation({
    mutationFn: (item: { id: string; title: string }) => api.renameChatSession(item.id, item.title),
    onSuccess: async () => {
      setRenaming(null)
      await refresh()
    },
    onError: failed,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteChatSession(id),
    onSuccess: async (_, id) => {
      setDeleting(null)
      onDeleted(id)
      await refresh()
    },
    onError: failed,
  })

  const startRename = (item: ChatSessionSummary) => {
    setError(null)
    setDeleting(null)
    setRenaming(item.id)
    setTitle(item.title)
  }
  const save = (item: ChatSessionSummary) => {
    const next = title.trim()
    if (!next || next === item.title || rename.isPending) return
    setError(null)
    rename.mutate({ id: item.id, title: next })
  }

  const sessions = list.data?.sessions ?? []
  return (
    <section className="agent-history" aria-label="Chat history">
      <h3 className="agent-history-title">History</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {list.isPending && <p className="muted">Loading…</p>}
      {list.isError && <p className="error">Could not load the past chats.</p>}
      {list.data && sessions.length === 0 && <p className="muted">No past chats yet.</p>}
      <ul className="history-list">
        {sessions.map((item) => {
          const current = item.id === currentId
          if (renaming === item.id) {
            const changed = title.trim() !== '' && title.trim() !== item.title
            return (
              <li key={item.id} className="history-item editing">
                <input
                  aria-label="Chat title"
                  value={title}
                  maxLength={120}
                  autoFocus
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') save(item)
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
                <span className="history-edit-actions">
                  <button type="button" className="primary" disabled={!changed || rename.isPending} onClick={() => save(item)}>
                    Save
                  </button>
                  <button type="button" onClick={() => setRenaming(null)}>
                    Cancel
                  </button>
                </span>
              </li>
            )
          }
          return (
            <li key={item.id} className="history-item" data-current={current}>
              <button
                type="button"
                className="history-row"
                aria-current={current ? 'true' : undefined}
                disabled={busy}
                onClick={() => onOpen(item.id)}
              >
                <span className="history-name">{item.title}</span>
                <span className="history-meta muted">
                  {when(item.last_message_at)} · {countOf(item.message_count)}
                </span>
              </button>
              <button
                type="button"
                className="ghost icon-btn small"
                aria-label={`Rename ${item.title}`}
                title="Rename"
                onClick={() => startRename(item)}
              >
                <Icon name="edit" size={14} />
              </button>
              <button
                type="button"
                className="ghost icon-btn small"
                aria-label={`Delete ${item.title}`}
                title="Delete"
                disabled={busy && current}
                onClick={() => {
                  setError(null)
                  setRenaming(null)
                  setDeleting(item.id)
                }}
              >
                <Icon name="trash" size={14} />
              </button>
              {deleting === item.id && (
                <span className="history-confirm" role="alertdialog" aria-label="Confirm delete">
                  Delete this chat?
                  <button type="button" className="danger" disabled={remove.isPending} onClick={() => remove.mutate(item.id)}>
                    Yes, delete
                  </button>
                  <button type="button" onClick={() => setDeleting(null)}>
                    Cancel
                  </button>
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
