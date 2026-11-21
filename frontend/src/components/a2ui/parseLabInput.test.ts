import { describe, expect, it } from 'vitest'
import { parseLabInput } from './parseLabInput'

const msg = { version: 'v0.9', createSurface: { surfaceId: 's' } }

describe('parseLabInput', () => {
  it('accepts a single message', () => {
    const r = parseLabInput(JSON.stringify(msg))
    expect(r).toEqual({ ok: true, messages: [msg] })
  })

  it('accepts an array', () => {
    const r = parseLabInput(JSON.stringify([msg, msg]))
    expect(r.ok && r.messages.length).toBe(2)
  })

  it('accepts {messages: [...]}', () => {
    const r = parseLabInput(JSON.stringify({ messages: [msg] }))
    expect(r).toEqual({ ok: true, messages: [msg] })
  })

  it('rejects empty and whitespace-only text', () => {
    expect(parseLabInput('').ok).toBe(false)
    expect(parseLabInput('  \n\t ').ok).toBe(false)
  })

  it('reports line and column for invalid JSON', () => {
    const r = parseLabInput('{\n  "a": 1,\n  oops\n}')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.line).toBe(3)
      expect(r.column).toBe(3)
    }
  })

  it('rejects a wrong version and names the message', () => {
    const r = parseLabInput(JSON.stringify([msg, { version: 'v0.8' }]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('message 2')
  })

  it('rejects a missing version and a non-object item', () => {
    const a = parseLabInput('{"createSurface":{}}')
    expect(!a.ok && a.error).toContain('message 1')
    const b = parseLabInput(JSON.stringify([msg, 5]))
    expect(!b.ok && b.error).toContain('message 2')
  })

  it('rejects a bare scalar', () => {
    expect(parseLabInput('42').ok).toBe(false)
  })

  it('refuses text over 256 KB', () => {
    const r = parseLabInput(' '.repeat(256 * 1024 + 1))
    expect(!r.ok && r.error).toContain('256 KB')
  })

  it('counts UTF-8 bytes, not characters', () => {
    const r = parseLabInput('"' + 'é'.repeat(130 * 1024) + '"')
    expect(!r.ok && r.error).toContain('256 KB')
  })

  it('refuses more than 200 messages, accepts 200', () => {
    const many = (n: number) => JSON.stringify(Array.from({ length: n }, () => msg))
    const bad = parseLabInput(many(201))
    expect(!bad.ok && bad.error).toContain('200')
    expect(parseLabInput(many(200)).ok).toBe(true)
  })
})
