import Markdown, { type Components } from 'react-markdown'
import type { MarkdownComponentProps } from '@a2ui/react/v0_9'
import { MODEL_MARKDOWN, REMARK } from '../markdownConfig'

// Links leave the app in a new tab that cannot reach back to it. A link whose URL react-markdown
// dropped (`javascript:` and other unsafe schemes leave an empty href) is shown as plain text.
const COMPONENTS: Components = {
  ...MODEL_MARKDOWN,
  a: ({ node: _node, href, children, ...props }) =>
    href ? (
      <a {...props} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span className="a2ui-dropped-link">{children}</span>
    ),
}

/** The Markdown of an A2UI `Text`, with the app's rules: no raw HTML, no script URLs. */
export function LabMarkdown({ markdown }: MarkdownComponentProps) {
  return (
    <div className="markdown a2ui-markdown">
      <Markdown remarkPlugins={REMARK} components={COMPONENTS}>
        {markdown}
      </Markdown>
    </div>
  )
}
