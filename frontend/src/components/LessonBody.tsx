import { Children, isValidElement, type ComponentProps, type MouseEvent, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { readingMinutes, splitSections, type Section } from '../lib/lessonTemplate'
import { CodeBlock } from './agent/CodeBlock'

/**
 * The lesson template (change lesson-template): the app owns the layout, the lesson text is plain
 * Markdown. `## ` headings become numbered section cards with a table of contents; a section named
 * "Key takeaways" is a highlighted card; GitHub-style alerts (`> [!NOTE]`, `[!TIP]`, `[!WARNING]`,
 * `[!KEY]`) are callouts. No raw HTML is rendered (no rehype-raw).
 */

const REMARK = [remarkGfm]
const CALLOUTS = { NOTE: 'Note', TIP: 'Tip', WARNING: 'Watch out', KEY: 'Key idea' } as const
type CalloutKind = keyof typeof CALLOUTS
const ALERT = /^\[!(NOTE|TIP|WARNING|KEY)\]\s*/i
const TAKEAWAYS = /^key takeaways?$/i

const slug = (title: string, index: number) =>
  `lesson-${index + 1}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

/** Removes the `[!KIND]` marker from the first text of a blockquote. */
function dropMarker(node: ReactNode): ReactNode {
  if (typeof node === 'string') return node.replace(ALERT, '')
  if (Array.isArray(node)) {
    const [first, ...rest] = node
    return [dropMarker(first), ...rest]
  }
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode }
    const kids = Children.toArray(props.children)
    return { ...node, props: { ...props, children: [dropMarker(kids[0]), ...kids.slice(1)] } }
  }
  return node
}

function Blockquote({ children }: ComponentProps<'blockquote'>) {
  const parts = Children.toArray(children).filter((c) => !(typeof c === 'string' && !c.trim()))
  const kind = ALERT.exec(textOf(parts[0]).trimStart())?.[1]?.toUpperCase() as CalloutKind | undefined
  if (!kind) return <blockquote>{children}</blockquote>
  return (
    <aside className={`lesson-callout ${kind.toLowerCase()}`} aria-label={CALLOUTS[kind]}>
      <p className="lesson-callout-label">{CALLOUTS[kind]}</p>
      {dropMarker(parts[0])}
      {parts.slice(1)}
    </aside>
  )
}

const COMPONENTS: Components = {
  pre: CodeBlock,
  blockquote: Blockquote,
  table: ({ children }) => (
    <div className="lesson-table">
      <table>{children}</table>
    </div>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
}

function Text({ children }: { children: string }) {
  return (
    <Markdown remarkPlugins={REMARK} components={COMPONENTS}>
      {children}
    </Markdown>
  )
}

/** A lesson in the lesson template: reading time, contents, numbered section cards. */
export function LessonBody({ text }: { text: string }) {
  const sections = splitSections(text)
  const titled = sections.filter((s): s is Section & { title: string } => s.title !== null)
  return (
    <div className="lesson-body markdown">
      <p className="lesson-meta muted">
        {readingMinutes(text)} min read{titled.length > 0 && ` · ${titled.length} sections`}
      </p>
      {titled.length > 1 && (
        <nav className="lesson-toc" aria-label="On this page">
          <p className="lesson-toc-title">On this page</p>
          <ol>
            {titled.map((s, i) => (
              <li key={i}>
                <a href={`#${slug(s.title, i)}`} onClick={(e) => jump(e, slug(s.title, i))}>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="lesson-sections" data-testid="lesson-body">
      {sections.map((s, i) => {
        if (s.title === null) {
          return (
            <div key={i} className="lesson-intro">
              <Text>{s.body}</Text>
            </div>
          )
        }
        const n = titled.indexOf(s as Section & { title: string })
        const id = slug(s.title, n)
        const takeaways = TAKEAWAYS.test(s.title.trim())
        return (
          <section key={i} id={id} className={takeaways ? 'lesson-card takeaways' : 'lesson-card'} aria-labelledby={`${id}-h`}>
            {/* The number badge is drawn by CSS (data-n), so the heading's text stays the title. */}
            <h2 id={`${id}-h`} data-n={takeaways ? '★' : n + 1}>
              {s.title}
            </h2>
            <Text>{s.body}</Text>
          </section>
        )
      })}
      </div>
    </div>
  )
}

/** Contents links scroll inside the page: the app's own routes live in the URL hash. */
function jump(event: MouseEvent, id: string) {
  event.preventDefault()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
