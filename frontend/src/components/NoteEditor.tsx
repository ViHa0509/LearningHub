import { useEffect, useRef, useState } from 'react'
import { api, ApiError, type Note } from '../api'
import { apply, isEditorMessage, prepare, type EditSession } from '../lib/inlineEdit'

interface Props {
  note: Note
  /** Called after a successful save. */
  onSaved: () => Promise<void>
  onClose: () => void
  /** Tells the note page whether there are unsaved changes, so leaving can ask first. */
  onDirtyChange: (dirty: boolean) => void
}

export const DISCARD_PROMPT = 'Discard your unsaved changes to this page?'
const COLLECT_TIMEOUT_MS = 3000

export function NoteEditor({ note, onSaved, onClose, onDirtyChange }: Props) {
  const [session, setSession] = useState<(EditSession & { sha: string }) | null>(null)
  const [changed, setChanged] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  // Resolves the pending save with the edits the frame reports.
  const collecting = useRef<((edits: Record<string, string>) => void) | null>(null)
  const saveRef = useRef<() => void>(() => {})

  useEffect(() => {
    let live = true
    Promise.all([api.noteSource(note.id), api.note(note.id)])
      .then(([source, detail]) => live && setSession({ ...prepare(source), sha: detail.content_sha256 }))
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load the page'))
    return () => {
      live = false
    }
  }, [note.id])

  const dirty = changed > 0
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  useEffect(() => {
    // Only our own frame may talk to the editor; the page in it is untrusted.
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return
      const data: unknown = event.data
      if (!isEditorMessage(data)) return
      if (data.type === 'lh-dirty') setChanged(data.count)
      else if (data.type === 'lh-save') saveRef.current()
      else if (data.type === 'lh-edits') {
        collecting.current?.(data.edits)
        collecting.current = null
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const collect = () =>
    new Promise<Record<string, string>>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        collecting.current = null
        reject(new Error('The page did not answer; try again.'))
      }, COLLECT_TIMEOUT_MS)
      collecting.current = (edits) => {
        window.clearTimeout(timer)
        resolve(edits)
      }
      frame.current?.contentWindow?.postMessage({ type: 'lh-collect' }, '*')
    })

  const save = async () => {
    if (!session || !dirty || saving) return
    setSaving(true)
    setError(null)
    try {
      const html = apply(session, await collect())
      await api.saveContent(note.id, html, session.sha)
      onDirtyChange(false)
      await onSaved()
      onClose()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(`${e.message}. Close the editor and open it again to edit the newer page.`)
      } else {
        setError(e instanceof Error ? e.message : 'Save failed')
      }
      setSaving(false)
    }
  }
  useEffect(() => {
    saveRef.current = () => void save()
  })

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
        <span className="muted" role="status">
          {dirty
            ? `${changed} ${changed === 1 ? 'block' : 'blocks'} changed`
            : 'Click any text on the page to edit it'}
        </span>
        <div className="note-actions">
          <button type="button" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {session === null && !error && <p className="muted">Loading the page…</p>}
      {session !== null && (
        /* Same isolation as the stored page: no allow-same-origin, so the page runs in an opaque origin. */
        <iframe
          ref={frame}
          className="original note-editing"
          title={`Editing: ${note.title}`}
          srcDoc={session.frameHtml}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
        />
      )}
    </section>
  )
}
