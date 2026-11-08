import { Children, isValidElement, type ComponentProps, type ReactNode } from 'react'
import { CopyButton } from './CopyButton'

/** A fenced code block in an answer: a bar with the language and Copy, then the code. */
export function CodeBlock({ children }: ComponentProps<'pre'>) {
  const code = Children.toArray(children)[0]
  const props = isValidElement(code) ? (code.props as { className?: string; children?: ReactNode }) : {}
  const language = /language-([\w+-]+)/.exec(props.className ?? '')?.[1]
  const text = textOf(props.children).replace(/\n$/, '')
  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span>{language ?? 'code'}</span>
        <CopyButton text={text} label="Copy code" />
      </div>
      <pre>{children}</pre>
    </div>
  )
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}
