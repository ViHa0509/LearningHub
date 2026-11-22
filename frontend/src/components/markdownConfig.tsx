import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './agent/CodeBlock'
import { isAllowedMediaUrl } from './a2ui/mediaUrl'

/**
 * Markdown rules shared by every place that shows text a model or a payload wrote (agent chat,
 * A2UI surfaces). GFM for tables and task lists. No rehype-raw: HTML in the text is shown as text,
 * never inserted, and react-markdown's default URL transform drops `javascript:` links.
 */
export const REMARK = [remarkGfm]

export const MODEL_MARKDOWN: Components = {
  pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
  table: ({ node: _node, ...props }) => (
    <div className="md-table">
      <table {...props} />
    </div>
  ),
  // An image loads only from the app's own origin (or a data:image URL). Any other address is shown
  // as text, so no `img` exists and the browser makes no request (design 10).
  img: ({ node: _node, src, alt }) =>
    isAllowedMediaUrl(src, 'image') ? (
      <img src={src} alt={alt ?? ''} />
    ) : (
      <span className="md-blocked-image">
        <span>Image blocked{alt ? `: ${alt}` : ''}</span>{' '}
        <code>{typeof src === 'string' ? src : ''}</code>
      </span>
    ),
}
