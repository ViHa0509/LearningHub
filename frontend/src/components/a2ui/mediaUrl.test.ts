import { describe, expect, it } from 'vitest'
import { isAllowedMediaUrl } from './mediaUrl'

const ORIGIN = 'http://localhost:5173'

describe('isAllowedMediaUrl', () => {
  it.each([
    ['/brand/logo-mark.svg', 'image'],
    ['brand/logo-mark.svg', 'image'],
    [`${ORIGIN}/brand/logo-mark.svg`, 'image'],
    ['data:image/png;base64,iVBORw0KGgo=', 'image'],
    ['data:image/svg+xml,%3Csvg%3E', 'image'],
    ['data:video/mp4;base64,AAAA', 'video'],
    ['data:audio/mpeg;base64,AAAA', 'audio'],
  ] as const)('allows %s as %s', (url, kind) => {
    expect(isAllowedMediaUrl(url, kind, ORIGIN)).toBe(true)
  })

  it.each([
    ['https://tracker.example/p.png?d=secret', 'image'],
    ['//tracker.example/p.png', 'image'],
    ['/\\tracker.example/p.png', 'image'],
    ['http://localhost:5174/p.png', 'image'],
    ['https://localhost:5173/p.png', 'image'],
    ['javascript:alert(1)', 'image'],
    ['blob:http://localhost:5173/abc', 'image'],
    ['data:text/html,<script>alert(1)</script>', 'image'],
    ['data:video/mp4;base64,AAAA', 'image'],
    ['data:image/png;base64,AAAA', 'audio'],
    ['', 'image'],
    ['   ', 'video'],
  ] as const)('refuses %s as %s', (url, kind) => {
    expect(isAllowedMediaUrl(url, kind, ORIGIN)).toBe(false)
  })

  it('refuses values that are not strings', () => {
    expect(isAllowedMediaUrl(undefined, 'image', ORIGIN)).toBe(false)
    expect(isAllowedMediaUrl({ path: '/x' }, 'image', ORIGIN)).toBe(false)
  })

  it('uses the page origin by default', () => {
    expect(isAllowedMediaUrl('/brand/logo-mark.svg', 'image')).toBe(true)
    expect(isAllowedMediaUrl('https://tracker.example/p.png', 'image')).toBe(false)
  })
})
