import { useEffect, useId, useRef, useState } from 'react'
import { A2uiSurface, MarkdownComponentContext } from '@a2ui/react/v0_9'
import { useMe } from '../../lib/auth'
import { useScreenClass } from '../../lib/useScreenClass'
import { parseLabInput } from './parseLabInput'
import { LAB_SAMPLES, type LabSample } from './samples'
import { LabMarkdown } from './LabMarkdown'
import { useA2uiLab, type LabLogEntry } from './useA2uiLab'
import './a2ui-lab.css'

const DRAFT_DELAY_MS = 400

const draftKey = (userId: string) => `lh.a2uiLab.draft.${userId}`

function readDraft(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function writeDraft(key: string, text: string): void {
  try {
    if (text === '') window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, text)
  } catch {
    // Storage may be blocked or full: the draft is a convenience only.
  }
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2)

type InspectorTab = 'log' | 'data' | 'errors'
type PaneTab = 'editor' | 'preview' | 'inspector'

const formatTime = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString('en-US', { hour12: false })
}

function LogEntry({ entry }: { entry: LabLogEntry }) {
  const toRenderer = entry.direction === 'agent→renderer'
  return (
    <li className={`a2ui-log-entry ${toRenderer ? 'to-renderer' : 'to-agent'}`}>
      <div className="a2ui-log-meta">
        <strong>{entry.direction}</strong>
        <span className="muted">{entry.source}</span>
        <time className="muted" dateTime={entry.time}>
          {formatTime(entry.time)}
        </time>
      </div>
      <pre>{pretty(entry.message)}</pre>
    </li>
  )
}

/** The A2UI Lab: write or step through A2UI v0.9 messages and see surfaces, log and data model. No agent. */
export default function A2uiLabPage() {
  const me = useMe()
  const key = draftKey(me?.id ?? 'local')
  const screenClass = useScreenClass()
  const lab = useA2uiLab()
  const ids = useId()

  const [text, setText] = useState(() => readDraft(key))
  // The text as last loaded or sent. A restored draft counts as changed (nothing was loaded or sent yet).
  const [cleanText, setCleanText] = useState('')
  const [sample, setSample] = useState<LabSample | null>(null)
  const [step, setStep] = useState(0)
  const [parseError, setParseError] = useState<string | null>(null)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('log')
  const [paneTab, setPaneTab] = useState<PaneTab>('editor')

  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  }, [text])
  useEffect(() => {
    const timer = setTimeout(() => writeDraft(key, text), DRAFT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [key, text])
  useEffect(() => () => writeDraft(key, textRef.current), [key])

  const phone = screenClass === 'phone'
  const empty = text.trim() === ''
  const done = sample !== null && step >= sample.steps.length

  function loadStep(next: LabSample, index: number) {
    const messages = next.steps[index]
    const shown = pretty(messages.length === 1 ? messages[0] : messages)
    setText(shown)
    setCleanText(shown)
  }

  function onText(value: string) {
    setText(value)
    setParseError(null)
  }

  function send() {
    const parsed = parseLabInput(text)
    if (!parsed.ok) {
      const where = parsed.line !== undefined ? ` (line ${parsed.line}, column ${parsed.column})` : ''
      setParseError(`${parsed.error}${where}`)
      return
    }
    setParseError(null)
    lab.send(parsed.messages, 'editor')
    setCleanText(text)
    if (phone) setPaneTab('preview')
  }

  function loadSample(id: string) {
    const next = LAB_SAMPLES.find((s) => s.id === id)
    if (!next) return
    if (text !== cleanText && !window.confirm('Replace the editor text with this sample? Your changes will be lost.')) {
      return
    }
    lab.reset()
    lab.setReplies(next.replies ?? null)
    setParseError(null)
    setSample(next)
    setStep(0)
    loadStep(next, 0)
  }

  function nextStep() {
    if (!sample || step >= sample.steps.length) return
    setParseError(null)
    lab.send(sample.steps[step], 'sample')
    const index = step + 1
    setStep(index)
    if (index < sample.steps.length) loadStep(sample, index)
    else setCleanText(text)
    if (phone) setPaneTab('preview')
  }

  function reset() {
    lab.reset()
    lab.setReplies(null)
    setSample(null)
    setStep(0)
    setParseError(null)
  }

  const paneHidden = (pane: PaneTab) => phone && paneTab !== pane

  const editorPane = (
    <section
      className="a2ui-pane a2ui-editor"
      id={`${ids}-editor`}
      role={phone ? 'tabpanel' : undefined}
      aria-label="Editor"
      hidden={paneHidden('editor')}
    >
      <div className="a2ui-toolbar">
        <label className="a2ui-sample">
          <span>Sample</span>
          <select value={sample?.id ?? ''} onChange={(e) => loadSample(e.target.value)}>
            <option value="" disabled>
              Choose a sample…
            </option>
            {LAB_SAMPLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      {sample && <p className="muted a2ui-sample-note">{sample.description}</p>}
      <label className="a2ui-input">
        <span className="visually-hidden">A2UI messages</span>
        <textarea
          aria-label="A2UI messages"
          aria-invalid={parseError ? true : undefined}
          spellCheck={false}
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder='One A2UI v0.9 message, an array of messages, or {"messages": [...]}'
        />
      </label>
      <div role="alert" className="a2ui-parse-error">
        {parseError && <p className="error">{parseError}</p>}
      </div>
      <div className="a2ui-actions">
        <button type="button" className="primary" disabled={empty} onClick={send}>
          Send
        </button>
        <button type="button" disabled={!sample || done} onClick={nextStep}>
          Next step
        </button>
        <span className="muted a2ui-step" aria-live="polite">
          {sample === null ? 'No sample loaded' : done ? `Sample done (${sample.steps.length} ${sample.steps.length === 1 ? 'step' : 'steps'})` : `Step ${step + 1} of ${sample.steps.length}`}
        </span>
        <button type="button" onClick={reset}>
          Reset
        </button>
      </div>
    </section>
  )

  const previewPane = (
    <section
      className="a2ui-pane a2ui-preview"
      id={`${ids}-preview`}
      role={phone ? 'tabpanel' : undefined}
      aria-label="Preview"
      hidden={paneHidden('preview')}
    >
      {lab.surfaces.length === 0 ? (
        <p className="muted a2ui-empty">
          No surface yet. This is a local playground with no agent: write A2UI messages in the editor and press Send.
        </p>
      ) : (
        lab.surfaces.map((surface) => (
          <div className="a2ui-surface" key={surface.id}>
            <h2 className="a2ui-surface-id">{surface.id}</h2>
            <MarkdownComponentContext.Provider value={LabMarkdown}>
              <A2uiSurface surface={surface} />
            </MarkdownComponentContext.Provider>
          </div>
        ))
      )}
    </section>
  )

  const dataEntries = Object.entries(lab.dataModels)
  const inspectorTabs: { id: InspectorTab; label: string }[] = [
    { id: 'log', label: 'Log' },
    { id: 'data', label: 'Data model' },
    { id: 'errors', label: lab.errors.length > 0 ? `Errors (${lab.errors.length})` : 'Errors' },
  ]

  const inspectorPane = (
    <section
      className="a2ui-pane a2ui-inspector"
      id={`${ids}-inspector`}
      role={phone ? 'tabpanel' : undefined}
      aria-label="Inspector"
      hidden={paneHidden('inspector')}
    >
      <div role="tablist" aria-label="Inspector sections" className="a2ui-tabs">
        {inspectorTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${ids}-tab-${t.id}`}
            aria-selected={inspectorTab === t.id}
            aria-controls={`${ids}-panel-${t.id}`}
            tabIndex={inspectorTab === t.id ? 0 : -1}
            onClick={() => setInspectorTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${ids}-panel-${inspectorTab}`}
        aria-labelledby={`${ids}-tab-${inspectorTab}`}
        className="a2ui-inspector-body"
      >
        {inspectorTab === 'log' &&
          (lab.log.length === 0 ? (
            <p className="muted">The log is empty.</p>
          ) : (
            <ol className="a2ui-log">
              {lab.log.map((entry) => (
                <LogEntry key={entry.id} entry={entry} />
              ))}
            </ol>
          ))}
        {inspectorTab === 'data' &&
          (dataEntries.length === 0 ? (
            <p className="muted">No data model: no surface yet.</p>
          ) : (
            dataEntries.map(([surfaceId, model]) => (
              <div key={surfaceId} className="a2ui-data">
                <h3>{surfaceId}</h3>
                <pre>{pretty(model)}</pre>
              </div>
            ))
          ))}
        {inspectorTab === 'errors' &&
          (lab.errors.length === 0 ? (
            <p className="muted">No errors.</p>
          ) : (
            <ul className="a2ui-errors" role="alert">
              {lab.errors.map((error, i) => (
                <li key={i} className="error">
                  {error.index !== undefined ? `Message ${error.index}: ` : ''}
                  {error.message}
                </li>
              ))}
            </ul>
          ))}
      </div>
    </section>
  )

  const paneTabs: { id: PaneTab; label: string }[] = [
    { id: 'editor', label: 'Editor' },
    { id: 'preview', label: 'Preview' },
    { id: 'inspector', label: 'Inspector' },
  ]

  return (
    <section className={`a2ui-lab a2ui-lab-page a2ui-${screenClass}`} aria-label="A2UI Lab">
      <header className="a2ui-header">
        <h1>A2UI Lab</h1>
        <p className="muted">A local playground for the A2UI v0.9 protocol. No agent is involved.</p>
      </header>
      {phone && (
        <div role="tablist" aria-label="Lab panes" className="a2ui-tabs a2ui-pane-tabs">
          {paneTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={paneTab === t.id}
              aria-controls={`${ids}-${t.id}`}
              tabIndex={paneTab === t.id ? 0 : -1}
              onClick={() => setPaneTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="a2ui-panes">
        {editorPane}
        {previewPane}
        {inspectorPane}
      </div>
    </section>
  )
}
