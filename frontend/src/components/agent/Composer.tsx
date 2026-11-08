import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import type { Effort, ProviderOut } from '../../api'
import { DEFAULT_PROVIDER, EFFORTS } from '../../lib/agentPrefs'
import { ACCEPT, extensionOf, formatSize, type Attachment } from '../../lib/attachments'
import { providerLabel } from '../../lib/providers'
import { SKILLS, suggestSkills } from '../../lib/skills'
import { Icon } from '../Icon'

interface Props {
  inputRef: RefObject<HTMLTextAreaElement | null>
  draft: string
  onDraft: (text: string) => void
  attachments: Attachment[]
  onAddFiles: (files: File[]) => void
  onRemoveAttachment: (id: number) => void
  effort: Effort
  onEffort: (effort: Effort) => void
  providers: ProviderOut[]
  providerId: string
  onProvider: (id: string) => void
  defaultProvider: { name: string; model_name: string } | null
  /** Set when the chosen agent does not use the chat's provider choice. */
  providerLocked: string | null
  busy: boolean
  canSend: boolean
  dropping: boolean
  onSubmit: () => void
}

export function Composer(props: Props) {
  const { inputRef, draft, onDraft, busy, canSend, onSubmit } = props
  const root = useRef<HTMLFormElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [skillsOpen, setSkillsOpen] = useState(false)
  // The draft the popup was closed on with Escape; typing on reopens it.
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [active, setActive] = useState(0)

  const suggested = suggestSkills(draft)
  const typing = suggested !== null && dismissed !== draft
  const popupOpen = skillsOpen || typing
  const options = suggested ?? SKILLS
  const activeIndex = Math.min(active, options.length - 1)

  useEffect(() => {
    if (!skillsOpen) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setSkillsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [skillsOpen])

  const changeDraft = (text: string) => {
    onDraft(text)
    setActive(0)
  }

  const pick = (cmd: string) => {
    const rest = suggested !== null ? '' : draft.trimStart()
    changeDraft(`${cmd} ${rest}`)
    setSkillsOpen(false)
    setDismissed(null)
    inputRef.current?.focus()
  }

  const closePopup = () => {
    setSkillsOpen(false)
    setDismissed(draft)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (popupOpen && options.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setActive((activeIndex + step + options.length) % options.length)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        pick(options[activeIndex].cmd)
        return
      }
    }
    if (popupOpen && e.key === 'Escape') {
      e.preventDefault()
      closePopup()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  const optionId = (i: number) => `${listId}-${i}`

  return (
    <form
      ref={root}
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      {popupOpen && (
        <div className="popover skill-popup">
          <div className="skill-popup-head" aria-hidden="true">
            <span>Skills</span>
            <span>↑↓ to move · Enter to pick · Esc to close</span>
          </div>
          <div role="listbox" id={listId} aria-label="Skills">
            {options.map((s, i) => (
              <div
                key={s.cmd}
                id={optionId(i)}
                role="option"
                aria-selected={i === activeIndex}
                className="popover-option"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(s.cmd)}
              >
                <span className="skill-mark" aria-hidden="true">
                  /
                </span>
                <span className="popover-option-text">
                  <span className="popover-option-title mono">{s.cmd}</span>
                  <span className="popover-option-desc">{s.description}</span>
                </span>
              </div>
            ))}
          </div>
          {options.length === 0 && <p className="skill-none">No skill matches “{draft.slice(1)}”.</p>}
        </div>
      )}

      <div className="composer-tools">
        <button type="button" className="chip" onClick={() => fileInput.current?.click()}>
          <Icon name="paperclip" size={15} />
          Attach
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          aria-label="Attach files"
          onChange={(e) => {
            props.onAddFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
        <button
          type="button"
          className="chip"
          aria-haspopup="listbox"
          aria-expanded={popupOpen}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (popupOpen) closePopup()
            else {
              setSkillsOpen(true)
              setDismissed(null)
              setActive(0)
            }
            inputRef.current?.focus()
          }}
        >
          <span className="mono" aria-hidden="true">
            /
          </span>
          Skills
        </button>
        <div className="segmented" role="group" aria-label="Effort">
          {EFFORTS.map((e, i) => (
            <button
              key={e.id}
              type="button"
              aria-pressed={props.effort === e.id}
              title={e.tip}
              onClick={() => props.onEffort(e.id)}
            >
              <span className="effort-bars" data-level={i + 1} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              {e.label}
            </button>
          ))}
        </div>
        <span className="chip chip-select" title={props.providerLocked ?? undefined}>
          <select
            aria-label="Provider"
            value={props.providerId}
            disabled={props.providerLocked !== null}
            onChange={(e) => props.onProvider(e.target.value)}
          >
            <option value={DEFAULT_PROVIDER}>
              {props.defaultProvider ? `Agent default (${providerLabel(props.defaultProvider)})` : 'Agent default'}
            </option>
            {props.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" size={14} />
        </span>
      </div>

      <div className="composer-card" data-dropping={props.dropping || undefined}>
        {props.attachments.length > 0 && (
          <ul className="attachment-chips" aria-label="Attachments" aria-live="polite">
            {props.attachments.map((a) => (
              <li key={a.id} className={a.kind === 'error' ? 'attachment-chip error' : 'attachment-chip'}>
                <span className="attachment-ext" aria-hidden="true">
                  {extensionOf(a.name).slice(1, 5).toUpperCase() || 'FILE'}
                </span>
                <span className="attachment-text">
                  <span className="attachment-name">{a.name}</span>
                  <span className="attachment-meta">{a.kind === 'ok' ? formatSize(a.size) : a.reason}</span>
                </span>
                <button
                  type="button"
                  className="attachment-remove"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => props.onRemoveAttachment(a.id)}
                >
                  <Icon name="close" size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={inputRef}
          aria-label="Message the agent"
          placeholder="Ask about your notes, or type / for skills…"
          rows={3}
          value={draft}
          aria-controls={popupOpen ? listId : undefined}
          aria-activedescendant={popupOpen && options.length > 0 ? optionId(activeIndex) : undefined}
          onChange={(e) => changeDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="composer-footer">
          <span className="composer-hint">Enter to send · Shift+Enter for a new line · drop files here</span>
          <button type="submit" className="send-button" aria-label="Send" title="Send" disabled={busy || !canSend}>
            <Icon name="send" size={17} />
          </button>
        </div>
        {props.dropping && (
          <div className="drop-overlay" aria-hidden="true">
            <span className="drop-icon">
              <Icon name="import" size={22} />
            </span>
            <strong>Drop to attach</strong>
            <span>Text, Markdown, code, JSON, YAML or CSV · up to 100 KB each</span>
          </div>
        )}
      </div>
    </form>
  )
}
