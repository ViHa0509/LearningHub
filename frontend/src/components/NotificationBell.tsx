import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { api, queryKeys, type AppNotification } from '../api'
import { useTime, type Time } from '../lib/time'
import { Icon } from './Icon'

const PAGE = 20
const CATEGORIES: Record<string, string> = {
  auth_failed: 'invalid key',
  invalid_key: 'invalid key',
  quota: 'quota used up',
  rate_limited: 'rate limited',
}

/** One text template per kind. Params are untrusted: they only ever go into React text, never into markup. */
function notificationText(kind: string, p: Record<string, unknown>, time: Time): string {
  const s = (key: string) => String(p[key] ?? '')
  switch (kind) {
    case 'new_member':
      return `New member: ${s('name')} (${s('email')}) joined`
    case 'lesson_ready':
      return `Lesson ready: ${s('title') || s('node')}`
    case 'shared_limit': {
      const resets = `resets ${time.dateTimeShort(s('resets_at'))}`
      return Number(p.used) >= Number(p.limit)
        ? `You reached the shared limit of ${s('limit')} requests; ${resets}`
        : `You used ${s('used')} of ${s('limit')} shared requests today; ${resets}`
    }
    case 'provider_problem': {
      const category = CATEGORIES[s('category')] ?? s('category').replace(/_/g, ' ')
      return `Provider '${s('name')}' failed (${category})${p.fallback ? '; the fallback answered' : ''}`
    }
    case 'kh_reconnect':
      return 'Knowledge Hub needs reconnecting'
    case 'field_published':
      return `New field published: ${s('title')}`
    case 'new_sign_in':
      return `New sign-in: ${s('browser')} on ${s('system')}, ${s('address')}`
    case 'restored':
      return `Data restored from a backup: ${s('notes')} notes, ${s('lessons')} lessons`
    default:
      return 'Notification'
  }
}

/** The bell in the top bar: unread count (polled) and a popover list that loads when it opens. */
export function NotificationBell() {
  const client = useQueryClient()
  const time = useTime()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const badgeId = useId()

  const unread = useQuery({
    queryKey: queryKeys.unreadCount,
    queryFn: api.unreadCount,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
  const list = useInfiniteQuery({
    queryKey: [...queryKeys.notifications, 'list'],
    queryFn: ({ pageParam }) => api.notifications(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length >= PAGE ? last[last.length - 1].created_at : undefined),
    enabled: open,
  })
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.notifications })
  const readAll = useMutation({ mutationFn: api.markAllNotificationsRead, onSuccess: refresh })

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = async (item: AppNotification) => {
    if (!item.read_at) {
      try {
        await api.markNotificationRead(item.id)
      } finally {
        void refresh()
      }
    }
    setOpen(false)
    // Only addresses inside the app: never another origin.
    if (item.link?.startsWith('#/')) window.location.hash = item.link
  }

  const count = unread.data?.count ?? 0
  const items = list.data?.pages.flat() ?? []
  return (
    <div className="bell" ref={box}>
      <button
        type="button"
        ref={button}
        className="top-icon-button bell-button"
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={count > 0 ? badgeId : undefined}
        onClick={() => setOpen(!open)}
      >
        <Icon name="bell" size={20} />
        {count > 0 && (
          <span className="bell-badge" id={badgeId}>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="bell-popover" role="dialog" aria-label="Notification list">
          <div className="bell-head">
            <strong>Notifications</strong>
            <button type="button" disabled={count === 0 || readAll.isPending} onClick={() => readAll.mutate()}>
              Mark all read
            </button>
          </div>
          {list.isPending ? (
            <p className="muted bell-empty">Loading...</p>
          ) : items.length === 0 ? (
            <p className="muted bell-empty">No notifications yet.</p>
          ) : (
            <ul className="plain-list bell-list">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={item.read_at ? 'bell-item' : 'bell-item unread'}
                    onClick={() => void choose(item)}
                  >
                    <span className="bell-text">
                      {!item.read_at && <span className="visually-hidden">Unread: </span>}
                      {notificationText(item.kind, item.params, time)}
                    </span>
                    <span className="muted small">{time.dateTimeShort(item.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.hasNextPage && (
            <button type="button" className="bell-more" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  )
}
