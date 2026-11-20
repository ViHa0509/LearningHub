/** Spec: app-search - Search box in the top bar; Opening a search result; Search on a phone. */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { api, queryKeys } from '../api'
import { navigate, routeHash, type Route } from '../lib/route'
import { Icon } from './Icon'

const DEBOUNCE_MS = 250
const MIN_CHARS = 2

interface Option {
  key: string
  route: Route
  title: string
  detail: string
  snippet: string
}

interface Props {
  /** Phone row: focus the input when it mounts. */
  autoFocus?: boolean
  /** Phone row: hides the row (close button, Escape on an empty field, after a result opens). */
  onClose?: () => void
}

/** `domain/node` into a lesson route. */
function lessonRoute(nodeId: string): Route {
  const [domain, node] = nodeId.split('/')
  return { page: 'lesson', domain, node }
}

/** Titles and excerpts are shown as React text only: never HTML, never Markdown. */
export function TopSearch({ autoFocus = false, onClose }: Props) {
  const listId = useId()
  const [text, setText] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(text), DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [text])

  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus])

  const term = debounced.trim()
  const enabled = term.length >= MIN_CHARS
  const result = useQuery({
    queryKey: queryKeys.search(term),
    queryFn: () => api.search(term),
    enabled,
    staleTime: 30_000,
  })

  // A new result list starts without a highlight.
  useEffect(() => setActive(-1), [result.data])

  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const data = enabled && text.trim().length >= MIN_CHARS ? result.data : undefined
  const topics: Option[] = (data?.topics ?? []).map((t) => ({
    key: `topic-${t.node_id}`,
    route: lessonRoute(t.node_id),
    title: t.title,
    detail: t.domain_title,
    snippet: '',
  }))
  const lessons: Option[] = (data?.lessons ?? []).map((l) => ({
    key: `lesson-${l.node_id}`,
    route: lessonRoute(l.node_id),
    title: l.title,
    detail: l.domain_title,
    snippet: l.snippet,
  }))
  const notes: Option[] = (data?.notes ?? []).map((n) => ({
    key: `note-${n.id}`,
    route: { page: 'note', id: n.id },
    title: n.title,
    detail: '',
    snippet: n.snippet,
  }))
  const options = [...topics, ...lessons, ...notes]
  const expanded = open && data !== undefined
  const optionId = (index: number) => `${listId}-option-${index}`

  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
    // optionId only depends on listId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const choose = (option: Option) => {
    navigate(option.route)
    // A page that asked to stay (unsaved changes) keeps the box as it is.
    if (window.location.hash !== routeHash(option.route)) return
    setText('')
    setDebounced('')
    setOpen(false)
    setActive(-1)
    onClose?.()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (options.length === 0) return
      event.preventDefault()
      setOpen(true)
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((current) => {
        if (current < 0) return step === 1 ? 0 : options.length - 1
        return (current + step + options.length) % options.length
      })
    } else if (event.key === 'Enter') {
      if (expanded && active >= 0 && options[active]) {
        event.preventDefault()
        choose(options[active])
      }
    } else if (event.key === 'Escape') {
      if (open && data !== undefined) {
        setOpen(false)
      } else if (text === '' && onClose) {
        onClose()
      }
    }
  }

  const group = (label: string, items: Option[], offset: number) =>
    items.length === 0 ? null : (
      <>
        <li role="presentation" className="search-heading">
          {label}
        </li>
        {items.map((option, i) => (
          <li
            key={option.key}
            id={optionId(offset + i)}
            role="option"
            aria-selected={active === offset + i}
            className="search-option"
            data-active={active === offset + i}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(option)}
          >
            <span className="search-title">{option.title}</span>
            {option.detail && <span className="search-detail">{option.detail}</span>}
            {option.snippet && <span className="search-snippet">{option.snippet}</span>}
          </li>
        ))}
      </>
    )

  return (
    <div
      className="top-search"
      ref={box}
      onBlur={(event) => {
        if (!box.current?.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <div className="top-search-field">
        <Icon name="search" size={16} />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label="Search topics, lessons and notes"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search"
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </div>
      {expanded && (
        <div className="search-dropdown">
          <ul role="listbox" id={listId} aria-label="Search results">
            {options.length === 0 ? (
              <li role="presentation" className="search-empty">
                No results for “{term}”
              </li>
            ) : (
              <>
                {group('Topics', topics, 0)}
                {group('Lessons', lessons, topics.length)}
                {group('Notes', notes, topics.length + lessons.length)}
              </>
            )}
          </ul>
        </div>
      )}
      {onClose && (
        <button type="button" className="top-icon-button" aria-label="Close search" onClick={onClose}>
          <Icon name="close" size={20} />
        </button>
      )}
    </div>
  )
}
