export type LabParseResult =
  | { ok: true; messages: Record<string, unknown>[] }
  | { ok: false; error: string; line?: number; column?: number }

export const MAX_INPUT_BYTES = 256 * 1024
export const MAX_MESSAGES = 200

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonErrorPosition(
  text: string,
  message: string,
): { line?: number; column?: number } {
  const lc = /line (\d+) column (\d+)/i.exec(message)
  if (lc) return { line: Number(lc[1]), column: Number(lc[2]) }
  const pos = /position (\d+)/i.exec(message)
  if (pos) {
    const offset = Math.min(Number(pos[1]), text.length)
    const before = text.slice(0, offset)
    const lines = before.split('\n')
    return { line: lines.length, column: lines[lines.length - 1].length + 1 }
  }
  return {}
}

export function parseLabInput(text: string): LabParseResult {
  if (new TextEncoder().encode(text).length > MAX_INPUT_BYTES) {
    return { ok: false, error: 'The input is larger than 256 KB.' }
  }
  if (text.trim() === '') {
    return { ok: false, error: 'The input is empty.' }
  }

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Invalid JSON: ${message}`, ...jsonErrorPosition(text, message) }
  }

  let items: unknown[]
  if (Array.isArray(data)) {
    items = data
  } else if (isPlainObject(data) && Array.isArray(data.messages)) {
    items = data.messages
  } else if (isPlainObject(data)) {
    items = [data]
  } else {
    return { ok: false, error: 'The input must be a message object or an array of messages.' }
  }

  if (items.length > MAX_MESSAGES) {
    return { ok: false, error: `Too many messages: the limit is ${MAX_MESSAGES}.` }
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!isPlainObject(item)) {
      return { ok: false, error: `message ${i + 1} must be an object.` }
    }
    if (item.version !== 'v0.9') {
      return { ok: false, error: `message ${i + 1} must have version "v0.9".` }
    }
  }
  return { ok: true, messages: items as Record<string, unknown>[] }
}
