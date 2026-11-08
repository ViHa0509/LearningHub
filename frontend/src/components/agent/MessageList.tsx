import { useEffect, useRef } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { effortLabel } from '../../lib/agentPrefs'
import { formatSize } from '../../lib/attachments'
import { Icon } from '../Icon'
import { CodeBlock } from './CodeBlock'
import { CopyButton } from './CopyButton'
import type { Entry } from './useAgentChat'

const STARTERS = ['What did I note about this topic?', 'Quiz me on what I learned', 'What should I learn next?']

// GFM for tables and task lists. No rehype-raw: HTML in model output is shown as text, never inserted.
const REMARK = [remarkGfm]
const MARKDOWN: Components = {
  pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
  table: ({ node: _node, ...props }) => (
    <div className="md-table">
      <table {...props} />
    </div>
  ),
}

interface Props {
  entries: Entry[]
  busy: boolean
  onRetry: (entryId: number) => void
  onStarter: (text: string) => void
}

export function MessageList({ entries, busy, onRetry, onStarter }: Props) {
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [entries, busy])

  return (
    <div className="agent-messages" role="log" aria-label="Conversation">
      {entries.length === 0 && !busy && <EmptyChat onStarter={onStarter} />}
      {entries.map((entry) =>
        entry.role === 'user' ? (
          <UserMessage key={entry.id} entry={entry} busy={busy} onRetry={onRetry} />
        ) : (
          <AssistantMessage key={entry.id} entry={entry} busy={busy} onRetry={onRetry} />
        ),
      )}
      {busy && (
        <div className="agent-row">
          <Avatar />
          <div className="agent-bubble assistant agent-working-bubble">
            <span className="agent-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <p className="agent-working" role="status">
              Agent is working…
            </p>
          </div>
        </div>
      )}
      <div ref={end} />
    </div>
  )
}

function Avatar() {
  return (
    <span className="agent-avatar" aria-hidden="true">
      <Icon name="sparkle" size={15} />
    </span>
  )
}

function EmptyChat({ onStarter }: { onStarter: (text: string) => void }) {
  return (
    <div className="agent-empty">
      <span className="agent-avatar large" aria-hidden="true">
        <Icon name="sparkle" size={22} />
      </span>
      <p className="agent-empty-title">What are we learning today?</p>
      <p className="muted agent-empty-text">Ask about a note, attach a file, or type / for a skill.</p>
      <div className="agent-starters">
        {STARTERS.map((text) => (
          <button key={text} type="button" className="chip" onClick={() => onStarter(text)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

function UserMessage({ entry, busy, onRetry }: { entry: Entry; busy: boolean; onRetry: (id: number) => void }) {
  const display = entry.turn?.display ?? entry.content
  const files = entry.turn?.attachments ?? []
  return (
    <div className="agent-turn user">
      {display && <p className="agent-bubble user">{display}</p>}
      {files.length > 0 && (
        <ul className="agent-sent-files" aria-label="Attached files">
          {files.map((f) => (
            <li key={f.id}>
              <Icon name="note" size={14} />
              <span>{f.name}</span>
              <span className="muted">{formatSize(f.size)}</span>
            </li>
          ))}
        </ul>
      )}
      {entry.error && (
        <div className="agent-row agent-error-row">
          <span className="agent-avatar danger" aria-hidden="true">
            !
          </span>
          <div className="agent-bubble agent-error">
            <p role="alert">{entry.error}</p>
            <button type="button" className="ghost small" onClick={() => onRetry(entry.id)} disabled={busy}>
              <Icon name="retry" size={14} /> Retry
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AssistantMessage({ entry, busy, onRetry }: { entry: Entry; busy: boolean; onRetry: (id: number) => void }) {
  const by = entry.answeredBy
  return (
    <div className="agent-row">
      <Avatar />
      <div className="agent-answer">
        <div className="agent-bubble assistant markdown">
          <Markdown remarkPlugins={REMARK} components={MARKDOWN}>
            {entry.content}
          </Markdown>
        </div>
        {entry.steps && entry.steps.length > 0 && (
          <details className="agent-steps">
            <summary>
              Used {entry.steps.length} {entry.steps.length === 1 ? 'tool' : 'tools'}
            </summary>
            <ul>
              {entry.steps.map((s, j) => (
                <li key={j}>{s.summary}</li>
              ))}
            </ul>
          </details>
        )}
        <div className="agent-actions">
          <CopyButton text={entry.content} label="Copy answer" iconOnly />
          <button
            type="button"
            className="ghost icon-btn small"
            aria-label="Retry"
            title="Retry"
            onClick={() => onRetry(entry.id)}
            disabled={busy}
          >
            <Icon name="retry" size={14} />
          </button>
          {by && (
            <p className="agent-caption">
              <span>
                {by.name} · {by.model}
                {by.fallback ? ' (fallback)' : ''}
              </span>{' '}
              · <span>{effortLabel(by.effort)}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
