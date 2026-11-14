import { useState } from 'react'
import { api, type DomainSummary, type LearningField } from '../api'
import { useFields, useRefreshFields } from '../hooks'
import { useIsAdmin } from '../lib/auth'
import { readHomeTab, saveHomeTab, slugify } from '../lib/homeTab'
import { routeHash } from '../lib/route'
import { ActionMenu } from './ActionMenu'
import { Icon } from './Icon'
import { BorderBeam } from './magicui/border-beam'
import { MagicCard } from './magicui/magic-card'
import { NumberTicker } from './magicui/number-ticker'

const IT_FIELD = 'it'

type Mode = 'new-field' | 'rename' | 'new-area' | 'delete' | null

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong')

export function HomePage() {
  const fields = useFields()
  const refresh = useRefreshFields()
  const admin = useIsAdmin()
  const [chosen, setChosen] = useState(readHomeTab)
  const [mode, setMode] = useState<Mode>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const list = fields.data ?? []
  const active = list.find((f) => f.id === chosen) ?? list[0]

  const choose = (id: string) => {
    setChosen(id)
    saveHomeTab(id)
    setMode(null)
    setMenuOpen(false)
    setError(null)
  }
  const open = (next: Mode) => {
    setMode(next)
    setError(null)
  }
  const close = () => open(null)
  /** Runs a change; on success refreshes the lists and closes the form, on failure shows the message. */
  const run = async (change: () => Promise<void>) => {
    setError(null)
    try {
      await change()
      // Close first: a form opened while the lists refresh must stay open.
      setMode(null)
      await refresh()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  return (
    <section className="home-page" aria-label="Home">
      <div className="home-intro">
        <h1>What do you want to learn?</h1>
        <p className="muted">
          Pick a field, then an area, to see its roadmap, your notes on each topic and the lessons you wrote.
        </p>
      </div>
      <div className="field-tabs-row">
        <div className="field-tabs" role="tablist" aria-label="Fields">
          {list.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              id={`field-tab-${f.id}`}
              aria-selected={f.id === active?.id}
              aria-controls="field-panel"
              onClick={() => choose(f.id)}
            >
              {f.title}
            </button>
          ))}
        </div>
        <button type="button" className="field-new" onClick={() => open('new-field')}>
          <span aria-hidden="true">+ </span>New field
        </button>
      </div>
      {mode === 'new-field' && (
        <NameForm
          label="Field name"
          formLabel="New field"
          initial=""
          error={error}
          onCancel={close}
          onSave={(title) =>
            void run(async () => {
              const created = await api.createField(title)
              choose(created.id)
            })
          }
        />
      )}
      {fields.isError && <p className="error">Could not load the fields.</p>}
      {mode === null && error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {active && (
        <div id="field-panel" role="tabpanel" aria-labelledby={`field-tab-${active.id}`} className="field-panel">
          <FieldToolbar
            field={active}
            admin={admin}
            menuOpen={menuOpen}
            onMenu={setMenuOpen}
            onMode={open}
            onPublish={() => void run(() => api.updateField(active.id, { published: !active.published }).then(() => undefined))}
          />
          {mode === 'rename' && (
            <NameForm
              label="Field name"
              formLabel="Rename field"
              initial={active.title}
              error={error}
              onCancel={close}
              onSave={(title) => void run(() => api.updateField(active.id, { title }).then(() => undefined))}
            />
          )}
          {mode === 'delete' && (
            <p className="note-confirm" role="alertdialog" aria-label="Confirm delete field">
              Delete the field {active.title} with its areas and topics? Your notes and lessons stay.
              <button
                type="button"
                className="danger"
                onClick={() =>
                  void run(async () => {
                    await api.deleteField(active.id)
                    choose(IT_FIELD)
                  })
                }
              >
                Yes, delete
              </button>
              <button type="button" onClick={close}>
                Cancel
              </button>
              {error && (
                <span role="alert" className="error">
                  {error}
                </span>
              )}
            </p>
          )}
          {mode === 'new-area' && (
            <AreaForm
              error={error}
              onCancel={close}
              onSave={(area) => void run(() => api.createArea(active.id, area).then(() => undefined))}
            />
          )}
          {active.areas.length === 0 ? (
            <p className="muted">{active.editable ? 'No areas yet. Add one with New area.' : 'No areas in this field.'}</p>
          ) : (
            <ul className="domain-cards">
              {active.areas.map((d) => (
                <li key={d.id}>
                  <RoleCard domain={d} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

interface ToolbarProps {
  field: LearningField
  admin: boolean
  menuOpen: boolean
  onMenu: (open: boolean) => void
  onMode: (mode: Mode) => void
  onPublish: () => void
}

/** What the open field offers: its owner edits it (the admin also publishes); everyone else reads it. */
function FieldToolbar({ field, admin, menuOpen, onMenu, onMode, onPublish }: ToolbarProps) {
  if (field.id === IT_FIELD) return null
  if (!field.editable) {
    return (
      <p className="muted field-note">
        Shared with you. Read only: you can still add notes and lessons on its topics.
      </p>
    )
  }
  const pick = (action: () => void) => {
    onMenu(false)
    action()
  }
  return (
    <div className="field-toolbar">
      {field.published && <span className="field-badge">Published</span>}
      <button type="button" onClick={() => onMode('new-area')}>
        <span aria-hidden="true">+ </span>New area
      </button>
      <div className="field-actions">
        <button
          type="button"
          className="icon field-more"
          aria-label="Field actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => onMenu(!menuOpen)}
        >
          <Icon name="more-vertical" />
        </button>
        {menuOpen && (
          <ActionMenu label="Field actions" onClose={() => onMenu(false)} triggerSelector=".field-more">
            <button type="button" role="menuitem" onClick={() => pick(() => onMode('rename'))}>
              <Icon name="edit" />
              Rename
            </button>
            {admin && (
              <button type="button" role="menuitem" onClick={() => pick(onPublish)}>
                <Icon name="note" />
                {field.published ? 'Unpublish' : 'Publish'}
              </button>
            )}
            <div role="separator" className="menu-divider" />
            <button type="button" role="menuitem" className="danger" onClick={() => pick(() => onMode('delete'))}>
              <Icon name="trash" />
              Delete field
            </button>
          </ActionMenu>
        )}
      </div>
    </div>
  )
}

interface NameFormProps {
  label: string
  formLabel: string
  initial: string
  error: string | null
  onSave: (value: string) => void
  onCancel: () => void
}

/** One text field with Save (disabled until it changed) and Cancel; Enter saves, Escape cancels. */
function NameForm({ label, formLabel, initial, error, onSave, onCancel }: NameFormProps) {
  const [value, setValue] = useState(initial)
  const text = value.trim()
  const canSave = text !== '' && text !== initial
  return (
    <form
      className="field-form"
      aria-label={formLabel}
      onSubmit={(e) => {
        e.preventDefault()
        if (canSave) onSave(text)
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <label>
        {label}
        <input autoFocus value={value} maxLength={60} onChange={(e) => setValue(e.target.value)} />
      </label>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!canSave}>
          Save
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  )
}

interface AreaFormProps {
  error: string | null
  onSave: (area: { slug: string; title: string; description?: string }) => void
  onCancel: () => void
}

/** New area: title, a slug fixed at creation (made from the title until typed) and a description. */
function AreaForm({ error, onSave, onCancel }: AreaFormProps) {
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState('')
  const canSave = title.trim() !== '' && slug.trim() !== ''
  return (
    <form
      className="field-form"
      aria-label="New area"
      onSubmit={(e) => {
        e.preventDefault()
        if (!canSave) return
        const text = description.trim()
        onSave({ slug: slug.trim(), title: title.trim(), ...(text ? { description: text } : {}) })
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <label>
        Area title
        <input
          autoFocus
          value={title}
          maxLength={60}
          onChange={(e) => {
            setTitle(e.target.value)
            if (!slugTouched) setSlug(slugify(e.target.value))
          }}
        />
      </label>
      <label>
        Slug
        <input
          value={slug}
          maxLength={40}
          onChange={(e) => {
            setSlug(e.target.value)
            setSlugTouched(true)
          }}
        />
      </label>
      <p className="muted field-hint">The slug is part of every topic address and cannot change later.</p>
      <label>
        Description
        <input value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!canSave}>
          Save
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  )
}

/** One role card: a spotlight follows the pointer, and a border beam runs while it is hovered or keyboard-focused. */
function RoleCard({ domain: d }: { domain: DomainSummary }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const percent = d.node_count ? Math.round((d.learned_nodes / d.node_count) * 100) : 0
  return (
    <MagicCard className="h-full">
      <a
        className="domain-card"
        href={routeHash({ page: 'roadmap', domain: d.id })}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={(e) => setFocused(isFocusVisible(e.currentTarget))}
        onBlur={() => setFocused(false)}
      >
        <h2>{d.title}</h2>
        {d.description && <p className="card-description">{d.description}</p>}
        <div className="progress" aria-label={`${d.learned_nodes} of ${d.node_count} topics with notes`}>
          <div className="progress-bar">
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className="progress-text">
            <NumberTicker value={d.learned_nodes} /> / {d.node_count} topics
          </span>
        </div>
      </a>
      {(hovered || focused) && <BorderBeam />}
    </MagicCard>
  )
}

function isFocusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible')
  } catch {
    return true
  }
}
