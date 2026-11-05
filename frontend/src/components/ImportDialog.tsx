import { useRef, useState, type DragEvent } from 'react'
import { api, type ImportOutcome, type Roadmap } from '../api'
import { NodePicker } from './NodePicker'

interface Props {
  roadmaps: Roadmap[]
  onClose: () => void
  onChanged: () => Promise<void>
}

type Stage = 'pick' | 'uploading' | 'link' | 'saving'

export function ImportDialog({ roadmaps, onClose, onChanged }: Props) {
  const [stage, setStage] = useState<Stage>('pick')
  const [results, setResults] = useState<ImportOutcome[]>([])
  const [links, setLinks] = useState<Record<string, string | null>>({})
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const upload = async (files: File[]) => {
    if (files.length === 0) return
    setStage('uploading')
    setError(null)
    try {
      const response = await api.importFiles(files)
      setResults(response.results)
      setStage('link')
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
      setStage('pick')
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    void upload(Array.from(event.dataTransfer.files))
  }

  const finish = async () => {
    setStage('saving')
    try {
      const chosen = Object.entries(links).filter(([, node]) => node !== null)
      await Promise.all(chosen.map(([id, node]) => api.link(id, node)))
      await onChanged()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Linking failed')
      setStage('link')
    }
  }

  const created = results.filter((r) => r.outcome === 'created' && r.note)

  return (
    <div className="dialog-backdrop">
      <div role="dialog" aria-modal="true" aria-label="Import HTML files" className="dialog">
        <h2>Import HTML files</h2>
        {error && <p className="error" role="alert">{error}</p>}

        {(stage === 'pick' || stage === 'uploading') && (
          <div
            className={dragging ? 'drop-zone dragging' : 'drop-zone'}
            data-testid="drop-zone"
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <p>Drop Claude-generated .html files here, or</p>
            <button type="button" onClick={() => input.current?.click()} disabled={stage === 'uploading'}>
              Choose files
            </button>
            <input
              ref={input}
              type="file"
              accept=".html,.htm,text/html"
              multiple
              hidden
              aria-label="HTML files"
              onChange={(e) => void upload(Array.from(e.target.files ?? []))}
            />
            {stage === 'uploading' && <p className="muted">Importing…</p>}
          </div>
        )}

        {(stage === 'link' || stage === 'saving') && (
          <>
            <ul className="import-results">
              {results.map((r, index) => (
                <li key={`${r.filename}-${index}`} className={`outcome ${r.outcome}`}>
                  <span className="filename">{r.filename}</span>
                  <span className="outcome-label">
                    {r.outcome === 'created' && 'Imported'}
                    {r.outcome === 'duplicate' && `Already imported as “${r.note?.title ?? ''}”`}
                    {r.outcome === 'rejected' && `Rejected: ${r.reason ?? 'unknown reason'}`}
                  </span>
                  {r.outcome === 'created' && r.note && (
                    <NodePicker
                      roadmaps={roadmaps}
                      label={`Roadmap node for ${r.filename}`}
                      emptyLabel="Skip (leave unsorted)"
                      value={links[r.note.id] ?? null}
                      onChange={(node) => setLinks((prev) => ({ ...prev, [r.note!.id]: node }))}
                    />
                  )}
                </li>
              ))}
            </ul>
            <div className="dialog-actions">
              <button type="button" className="primary" onClick={() => void finish()} disabled={stage === 'saving'}>
                {created.length > 0 ? 'Done' : 'Close'}
              </button>
            </div>
          </>
        )}

        {stage === 'pick' && (
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
