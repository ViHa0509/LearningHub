/** The media kinds of the A2UI basic catalog that load a URL: Image, Video and AudioPlayer. */
export type MediaKind = 'image' | 'video' | 'audio'

/**
 * True when a surface may load this media URL: a URL on the app's own origin, or a `data:` URL of
 * the same media kind (`data:image/...` for an image). Anything else (another host, a
 * protocol-relative `//host`, `javascript:`, `blob:`, a `data:` of another kind) is refused, so an
 * agent or a pasted payload cannot make the browser call a third party (tracking pixels, data
 * leaked in a query string).
 */
export function isAllowedMediaUrl(url: unknown, kind: MediaKind, origin: string = window.location.origin): boolean {
  if (typeof url !== 'string') return false
  const text = url.trim()
  if (text === '' || text.length > 2_000_000) return false
  // A data: URL is never resolved against the page; only its media type counts.
  if (/^data:/i.test(text)) return new RegExp(`^data:${kind}/[a-z0-9.+-]+[;,]`, 'i').test(text)
  // Backslashes are read as slashes by URL parsers (`/\host` is another host): refuse them outright.
  if (text.includes('\\')) return false
  let parsed: URL
  try {
    parsed = new URL(text, `${origin}/`)
  } catch {
    return false
  }
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === origin
}
