/** Spec: agent-chat - Text attachments. */
import { describe, expect, it } from 'vitest'
import {
  MAX_BYTES,
  REASON_COUNT,
  REASON_READ,
  REASON_SIZE,
  REASON_TYPE,
  extensionOf,
  formatSize,
  isAllowed,
  readAttachments,
} from './attachments'

const file = (name: string, text = 'x') => new File([text], name)

describe('attachments', () => {
  it('allows text, Markdown, code, JSON, YAML and CSV files only', () => {
    for (const name of ['a.md', 'b.MARKDOWN', 'c.txt', 'd.py', 'e.ts', 'f.json', 'g.yaml', 'h.yml', 'i.csv', 'j.sql']) {
      expect(isAllowed(name)).toBe(true)
    }
    for (const name of ['diagram.pdf', 'pic.png', 'archive.zip', 'README', '.md', 'run.exe']) {
      expect(isAllowed(name)).toBe(false)
    }
    expect(extensionOf('Notes.Final.MD')).toBe('.md')
  })

  it('reads good files as text', async () => {
    const out = await readAttachments([file('jwt.md', '# JWT'), file('q.sql', 'select 1')])
    expect(out).toEqual([
      { kind: 'ok', id: expect.any(Number), name: 'jwt.md', size: 5, text: '# JWT' },
      { kind: 'ok', id: expect.any(Number), name: 'q.sql', size: 8, text: 'select 1' },
    ])
    expect(out[0].id).not.toBe(out[1].id)
  })

  it('gives the reason for an unsupported type and a file over 100 KB', async () => {
    const out = await readAttachments([file('diagram.pdf'), file('big.md', 'a'.repeat(MAX_BYTES + 1)), file('edge.md', 'a'.repeat(MAX_BYTES))])
    expect(out.map((a) => (a.kind === 'error' ? a.reason : 'ok'))).toEqual([REASON_TYPE, REASON_SIZE, 'ok'])
  })

  it('accepts at most 5 files per message, counting those already attached', async () => {
    const six = await readAttachments(Array.from({ length: 6 }, (_, i) => file(`n${i}.md`)))
    expect(six.filter((a) => a.kind === 'ok')).toHaveLength(5)
    expect(six[5]).toMatchObject({ kind: 'error', name: 'n5.md', reason: REASON_COUNT })

    const more = await readAttachments([file('a.md'), file('b.md')], 4)
    expect(more.map((a) => a.kind)).toEqual(['ok', 'error'])
  })

  it('reports a file that cannot be read', async () => {
    const broken = file('broken.md')
    broken.text = () => Promise.reject(new Error('gone'))
    expect(await readAttachments([broken])).toEqual([{ kind: 'error', id: expect.any(Number), name: 'broken.md', reason: REASON_READ }])
  })

  it('formats sizes', () => {
    expect(formatSize(21)).toBe('21 B')
    expect(formatSize(4_200)).toBe('4 KB')
    expect(formatSize(100_000)).toBe('100 KB')
  })
})
