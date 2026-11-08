import { useEffect, useState } from 'react'
import { copyText } from '../../lib/agentPrefs'
import { Icon } from '../Icon'

/** Copies `text`; shows "Copied" for a moment when the clipboard took it. */
export function CopyButton({ text, label, iconOnly = false }: { text: string; label: string; iconOnly?: boolean }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const icon = <Icon name={copied ? 'check' : 'copy'} size={14} />
  const onClick = async () => setCopied(await copyText(text))

  return iconOnly ? (
    <button type="button" className="ghost icon-btn small" aria-label={copied ? 'Copied' : label} title={label} onClick={onClick}>
      {icon}
    </button>
  ) : (
    <button type="button" className="ghost code-copy" title={label} onClick={onClick}>
      {icon}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
