/** Reads the token links from the emails the e2e backend writes to its outbox folder. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { E2E_ENV } from '../playwright.config.ts'

export type LinkKind = 'verify' | 'reset' | 'magic' | 'invite'

/** The newest token link of one kind in the outbox (verify, reset, magic or invite). */
export function outboxToken(kind: LinkKind): string {
  const dir = join(E2E_ENV.LH_STORAGE_DIR, 'outbox')
  if (!existsSync(dir)) throw new Error('no outbox folder yet')
  const files = readdirSync(dir).filter((f) => f.endsWith('.eml')).sort()
  for (const file of files.reverse()) {
    const raw = readFileSync(join(dir, file), 'utf-8')
    // The body may be base64 or quoted-printable (which wraps long lines with "=\n").
    const split = raw.search(/\r?\n\r?\n/)
    const head = raw.slice(0, split)
    const body = raw.slice(split).trim()
    const text = /Content-Transfer-Encoding:\s*base64/i.test(head)
      ? Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf-8')
      : body.replace(/=\r?\n/g, '').replace(/=3D/g, '=')
    const match = text.match(new RegExp(`#/auth/${kind}\\?token=([A-Za-z0-9_-]+)`))
    if (match) return match[1]
  }
  throw new Error(`no ${kind} link in the outbox`)
}

/**
 * Waits for a new token link of one kind: the backend writes the email in a background task
 * after it has answered, so the file can appear a moment later. `previous` is the newest token
 * before the request (or null), so an older email is never taken for the new one.
 */
export async function nextOutboxToken(kind: LinkKind, previous: string | null = null): Promise<string> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const token = latestOutboxToken(kind)
    if (token && token !== previous) return token
    if (Date.now() > deadline) throw new Error(`no new ${kind} link in the outbox`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** The newest token of one kind, or null when there is none yet. */
export function latestOutboxToken(kind: LinkKind): string | null {
  try {
    return outboxToken(kind)
  } catch {
    return null
  }
}

