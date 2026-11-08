import { useEffect, useState } from 'react'
import { api, ApiError, type Note } from '../api'

interface Props {
  note: Note
  /** Called after a successful save. */
  onSaved: () => Promise<void>
  onClose: () => void
  /** Tells the note page whether there are unsaved changes, so leaving can ask first. */
  onDirtyChange: (dirty: boolean) => void
}

const PREVIEW_DELAY_MS = 400
export const DISCARD_PROMPT = 'Discard your unsaved changes to this page?'

export function NoteEditor({ note, onSaved, onClose, onDirtyChange }: Props) {
  const [loaded, setLoaded] = useState<{ source: string; sha: string } | null>(null)
  const [draft, setDraft] = useState('')
  const [preview, setPreview] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([api.noteSource(note.id), api.note(note.id)])
      .then(([source, detail]) => {
        if (!live) return
        setLoaded({ source, sha: detail.content_sha256 })
        setDraft(source)
        setPreview(source)
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load the page'))
    return () => {
      live = false
    }
  }, [note.id])

  useEffect(() => {
    const timer = window.setTimeout(() => setPreview(draft), PREVIEW_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [draft])

  const dirty = loaded !== null && draft !== loaded.source
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const canSave = dirty && draft.trim() !== '' && !saving

  const save = async () => {
    if (!loaded || !canSave) return
    setSaving(true)
    setError(null)
    try {
      await api.saveContent(note.id, draft, loaded.sha)
      onDirtyChange(false)
      await onSaved()
      onClose()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(`${e.message}. Copy your changes, then close the editor and open it again.`)
      } else {
        setError(e instanceof Error ? e.message : 'Save failed')
      }
      setSaving(false)
    }
  }

  const cancel = () => {
    if (dirty && !window.confirm(DISCARD_PROMPT)) return
    onDirtyChange(false)
    onClose()
  }

  return (
    <section
      className="note-editor"
      aria-label="Edit page"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault()
          void save()
        }
      }}
    >
      <div className="note-editor-bar">
        <span className="muted">{dirty ? 'Unsaved changes' : 'No changes'}</span>
        <div className="note-actions">
          <button type="button" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!canSave} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {loaded === null && !error && <p className="muted">Loading the page…</p>}
      {loaded !== null && (
        <div className="note-editor-panes">
          <textarea
            className="note-source"
            aria-label="Page HTML"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {/* Same isolation as the stored page: no allow-same-origin, so the preview runs in an opaque origin. */}
          <iframe
            className="original note-preview"
            title={`Preview: ${note.title}`}
            srcDoc={preview}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </section>
  )
}
