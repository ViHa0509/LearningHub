/**
 * Text attachments for the agent chat: only text files on an allow-list, at most 5 per message and
 * 100 KB each. The browser reads them as text; the text goes with that one message.
 */
export const ALLOWED_EXTENSIONS = [
  '.md', '.markdown', '.txt', '.py', '.ts', '.tsx', '.js', '.jsx', '.json', '.yaml', '.yml', '.csv',
  '.html', '.css', '.sql', '.sh', '.java', '.go', '.rs', '.toml', '.ini', '.xml',
]
export const ACCEPT = ALLOWED_EXTENSIONS.join(',')
export const MAX_FILES = 5
/** 100 KB; also the backend's limit of 100 000 characters per file. */
export const MAX_BYTES = 100_000

export const REASON_TYPE = 'File type not supported. Attach text, Markdown, code, JSON, YAML or CSV.'
export const REASON_SIZE = 'Larger than 100 KB.'
export const REASON_COUNT = `Only ${MAX_FILES} files per message.`
export const REASON_READ = 'Could not read the file.'

export interface ReadyAttachment {
  kind: 'ok'
  id: number
  name: string
  size: number
  text: string
}

export interface FailedAttachment {
  kind: 'error'
  id: number
  name: string
  reason: string
}

export type Attachment = ReadyAttachment | FailedAttachment

let seq = 0

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

export function isAllowed(name: string): boolean {
  return ALLOWED_EXTENSIONS.includes(extensionOf(name))
}

export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  return `${Math.max(1, Math.round(bytes / 1000))} KB`
}

/**
 * Checks and reads the files. `alreadyAttached` is the number of good files already on the message;
 * files past the limit, of another type or too large come back as error items with the reason.
 */
export async function readAttachments(files: File[], alreadyAttached = 0): Promise<Attachment[]> {
  let accepted = alreadyAttached
  const out: Attachment[] = []
  for (const file of files) {
    const id = ++seq
    const fail = (reason: string) => out.push({ kind: 'error', id, name: file.name, reason })
    if (!isAllowed(file.name)) fail(REASON_TYPE)
    else if (file.size > MAX_BYTES) fail(REASON_SIZE)
    else if (accepted >= MAX_FILES) fail(REASON_COUNT)
    else {
      try {
        const text = await file.text()
        if (text.length > MAX_BYTES) fail(REASON_SIZE)
        else {
          accepted += 1
          out.push({ kind: 'ok', id, name: file.name, size: file.size, text })
        }
      } catch {
        fail(REASON_READ)
      }
    }
  }
  return out
}
