/** Spec: learning-views - Learned-items list (topics without notes appear while dragging). */
import { describe, expect, it } from 'vitest'
import { backend, devops, makeNote } from '../test/fakeApi'
import { groupNotes } from './grouping'

const domainsOf = (grouped: ReturnType<typeof groupNotes>) =>
  grouped.groups.flatMap((g) => (g.kind === 'domain' ? [g] : []))
const ids = (grouped: ReturnType<typeof groupNotes>, domain: string) =>
  domainsOf(grouped).find((d) => d.domainId === domain)?.nodes.map((g) => g.node.id)

describe('groupNotes allTopics', () => {
  it('appends the topics without notes after the ones with notes, in roadmap order', () => {
    const notes = [makeNote('auth', 'backend/auth')]
    const grouped = groupNotes(notes, [backend, devops], '', { allTopics: true })
    expect(ids(grouped, 'backend')).toEqual(['auth', 'apis', 'caching', 'redis'])
    const empty = domainsOf(grouped)[0].nodes.slice(1)
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
    expect(domainsOf(grouped).map((d) => d.domainId)).toEqual(['backend'])
  })

  it('still applies the filter to notes: a domain the filter empties is out, the others list all topics', () => {
    const notes = [makeNote('Redis eviction', 'backend/caching'), makeNote('GitHub Actions', 'devops/ci-cd')]
    const grouped = groupNotes(notes, [backend, devops], 'redis', { allTopics: true })
    expect(domainsOf(grouped).map((d) => d.domainId)).toEqual(['backend'])
    expect(ids(grouped, 'backend')).toEqual(['caching', 'apis', 'redis', 'auth'])
  })

  it('changes nothing without the option', () => {
    const grouped = groupNotes([makeNote('auth', 'backend/auth')], [backend, devops])
    expect(ids(grouped, 'backend')).toEqual(['auth'])
  })
})

describe('groupNotes one list', () => {
  const at = (day: string) => ({ updated_at: `2026-11-${day}T00:00:00Z` })
  const label = (g: ReturnType<typeof groupNotes>['groups'][number]) =>
    g.kind === 'domain' ? g.title : g.kind === 'category' ? g.category : 'Unsorted'

  it('orders domains and categories together by newest note, Unsorted last', () => {
    const notes = [
      makeNote('Caching', 'backend/caching', at('25')),
      makeNote('Pod limits', null, { category: 'Kubernetes', ...at('26') }),
      makeNote('Helm charts', null, { category: 'Kubernetes', ...at('24') }),
      makeNote('Salary talk', null, { category: 'Career', ...at('19') }),
      makeNote('Loose idea', null, at('26')),
    ]
    expect(groupNotes(notes, [backend, devops]).groups.map(label)).toEqual([
      'Kubernetes',
      backend.title,
      'Career',
      'Unsorted',
    ])
  })

  it('has no Unsorted group when every note has a topic or a category, unless dragging', () => {
    const notes = [makeNote('Caching', 'backend/caching')]
    expect(groupNotes(notes, [backend]).groups.map(label)).toEqual([backend.title])
    const drag = groupNotes(notes, [backend], '', { allTopics: true }).groups
    expect(drag[drag.length - 1]).toMatchObject({ kind: 'unsorted', notes: [] })
  })

  it('keeps a category named like a domain as its own group, and a missing node falls to its category', () => {
    const notes = [
      makeNote('A', 'backend/caching', at('20')),
      makeNote('B', null, { category: backend.title, ...at('21') }),
      makeNote('C', 'backend/gone', { category: 'Gone', node_missing: true, ...at('22') }),
    ]
    expect(groupNotes(notes, [backend]).groups.map(label)).toEqual(['Gone', backend.title, backend.title])
  })
})
