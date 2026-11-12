import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '../Icon'
import { DRAWER_CLOSE_ATTR } from '../PanelFrame'

interface AgentChoice {
  id: string
  name: string
  description: string
}

interface Props {
  open: boolean
  onToggle: () => void
  /** A phone drawer: the toggle closes it (and takes the focus when it opens). */
  drawer?: boolean
  /** The chat controls (agent menu, Clear chat) exist only when a provider is active. */
  chat: {
    agents: AgentChoice[]
    agentId: string
    onAgent: (id: string) => void
    hint: string
    canClear: boolean
    onClear: () => void
  } | null
}

export function AgentHeader({ open, onToggle, drawer = false, chat }: Props) {
  return (
    <div className="pane-header agent-header">
      <button
        type="button"
        className="ghost icon-btn"
        {...(drawer ? { [DRAWER_CLOSE_ATTR]: '' } : { 'aria-expanded': open })}
        aria-label={drawer ? 'Close agent' : open ? 'Collapse agent panel' : 'Expand agent panel'}
        onClick={onToggle}
      >
        <Icon name={drawer ? 'close' : 'sidebar'} size={18} className={open || drawer ? undefined : 'flip'} />
      </button>
      {open && (
        <>
          {chat ? (
            <AgentMenu agents={chat.agents} value={chat.agentId} hint={chat.hint} onChange={chat.onAgent} />
          ) : (
            <h2 className="agent-title">
              <Icon name="agent" /> Agent
            </h2>
          )}
          <span className="agent-header-gap" />
          {chat && (
            <button type="button" className="ghost" onClick={chat.onClear} disabled={!chat.canClear}>
              <Icon name="trash" /> <span className="clear-label">Clear chat</span>
            </button>
          )}
          <a className="ghost icon-btn" href="#/settings" aria-label="Agent settings" title="Agent settings">
            <Icon name="settings" size={17} />
          </a>
        </>
      )}
    </div>
  )
}

function AgentMenu({
  agents,
  value,
  hint,
  onChange,
}: {
  agents: AgentChoice[]
  value: string
  hint: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const current = agents.find((a) => a.id === value)
  const name = current?.name ?? 'Learning assistant'

  useEffect(() => {
    if (!open) return
    const list = root.current
    ;(list?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ?? list?.querySelector<HTMLElement>('[role="option"]'))?.focus()
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = () => {
    setOpen(false)
    button.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const options = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
    const at = options.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      options[(at + step + options.length) % options.length]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div className="agent-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="ghost agent-menu-button"
        aria-label={`Agent: ${name}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen(!open)}
      >
        <span className="agent-avatar small">
          <Icon name="sparkle" size={14} />
        </span>
        <span className="agent-menu-label">
          <span className="agent-menu-name">{name}</span>
          <span className="agent-menu-hint">{hint}</span>
        </span>
        <Icon name="chevron-down" className="agent-menu-chevron" />
      </button>
      {open && (
        <div role="listbox" id={listId} aria-label="Choose agent" className="popover agent-menu-list" onKeyDown={onKeyDown}>
          {agents.map((a, i) => (
            <button
              key={a.id}
              type="button"
              role="option"
              aria-selected={a.id === value}
              className="popover-option"
              data-tone={i % 2 === 0 ? 'accent' : 'secondary'}
              onClick={() => {
                onChange(a.id)
                close()
              }}
            >
              <span className="agent-dot" aria-hidden="true" />
              <span className="popover-option-text">
                <span className="popover-option-title">{a.name}</span>
                <span className="popover-option-desc">{a.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
