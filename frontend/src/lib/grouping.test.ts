/** Spec: learning-views - Learned-items list (topics without notes appear while dragging). */
import { describe, expect, it } from 'vitest'
import { backend, devops, makeNote } from '../test/fakeApi'
import { groupNotes } from './grouping'

const ids = (grouped: ReturnType<typeof groupNotes>, domain: string) =>
  grouped.domains.find((d) => d.domainId === domain)?.nodes.map((g) => g.node.id)

describe('groupNotes allTopics', () => {
  it('appends the topics without notes after the ones with notes, in roadmap order', () => {
    const notes = [makeNote('auth', 'backend/auth')]
    const grouped = groupNotes(notes, [backend, devops], '', { allTopics: true })
    expect(ids(grouped, 'backend')).toEqual(['auth', 'apis', 'caching', 'redis'])
    const empty = grouped.domains[0].nodes.slice(1)
    expect(empty.every((g) => g.notes.length === 0)).toBe(true)
  })

  it('keeps the topics with notes where they are', () => {
    const notes = [makeNote('redis', 'backend/redis')]
    const plain = groupNotes(notes, [backend])
    const all = groupNotes(notes, [backend], '', { allTopics: true })
    expect(ids(all, 'backend')?.slice(0, 1)).toEqual(ids(plain, 'backend'))
    expect(ids(all, 'backend')).toEqual(['redis', 'apis', 'caching', 'auth'])
  })

  it('leaves out a domain without any note', () => {
    const grouped = groupNotes([makeNote('auth', 'backend/auth')], [backend, devops], '', { allTopics: true })
    expect(grouped.domains.map((d) => d.domainId)).toEqual(['backend'])
  })

  it('still applies the filter to notes: a domain the filter empties is out, the others list all topics', () => {
    const notes = [makeNote('Redis eviction', 'backend/caching'), makeNote('GitHub Actions', 'devops/ci-cd')]
    const grouped = groupNotes(notes, [backend, devops], 'redis', { allTopics: true })
    expect(grouped.domains.map((d) => d.domainId)).toEqual(['backend'])
    expect(ids(grouped, 'backend')).toEqual(['caching', 'apis', 'redis', 'auth'])
  })

  it('changes nothing without the option', () => {
    const grouped = groupNotes([makeNote('auth', 'backend/auth')], [backend, devops])
    expect(ids(grouped, 'backend')).toEqual(['auth'])
  })
})
