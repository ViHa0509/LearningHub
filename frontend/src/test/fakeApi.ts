import { vi } from 'vitest'
import type { ImportOutcome, Note, Roadmap } from '../api'

export const backend: Roadmap = {
  id: 'backend',
  title: 'Backend',
  nodes: [
    { id: 'apis', full_id: 'backend/apis', title: 'APIs', description: null, parent: null, order: 0 },
    { id: 'caching', full_id: 'backend/caching', title: 'Caching', description: null, parent: null, order: 1 },
    { id: 'redis', full_id: 'backend/redis', title: 'Redis', description: null, parent: 'caching', order: 0 },
    { id: 'auth', full_id: 'backend/auth', title: 'Auth', description: null, parent: null, order: 2 },
  ],
}

export const devops: Roadmap = {
  id: 'devops',
  title: 'DevOps',
  nodes: [
    { id: 'ci-cd', full_id: 'devops/ci-cd', title: 'CI/CD', description: null, parent: null, order: 0 },
    { id: 'docker', full_id: 'devops/docker', title: 'Docker', description: null, parent: null, order: 1 },
  ],
}

let seq = 0
export function makeNote(title: string, nodeId: string | null = null, extra: Partial<Note> = {}): Note {
  seq += 1
  return {
    id: `note-${seq}`,
    title,
    original_name: `${title}.html`,
    size_bytes: 100,
    node_id: nodeId,
    node_missing: false,
    created_at: '2026-11-06T00:00:00Z',
    updated_at: '2026-11-06T00:00:00Z',
    ...extra,
  }
}

export interface FakeState {
  notes: Note[]
  importResults?: ImportOutcome[]
  calls: { method: string; url: string; body?: unknown }[]
}

const respond = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

/** Installs a fetch stub that behaves like the backend API over in-memory state. */
export function installFakeApi(notes: Note[] = [], importResults?: ImportOutcome[]): FakeState {
  const state: FakeState = { notes: [...notes], importResults, calls: [] }
  const roadmaps: Record<string, Roadmap> = { backend, devops }

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      state.calls.push({ method, url, body })

      if (url === '/api/domains') {
        return respond(
          Object.values(roadmaps).map((r) => ({ id: r.id, title: r.title, node_count: r.nodes.length })),
        )
      }
      let match = url.match(/^\/api\/domains\/([^/]+)\/roadmap$/)
      if (match) return respond(roadmaps[match[1]])
      match = url.match(/^\/api\/domains\/([^/]+)\/counts$/)
      if (match) {
        const domain = match[1]
        const counts: Record<string, number> = {}
        for (const n of state.notes) {
          if (n.node_id?.startsWith(`${domain}/`)) {
            const id = n.node_id.split('/')[1]
            counts[id] = (counts[id] ?? 0) + 1
          }
        }
        return respond({ domain, counts })
      }
      if (url === '/api/notes' && method === 'GET') return respond(state.notes)
      if (url === '/api/notes/import') {
        const results = state.importResults ?? []
        for (const r of results) if (r.outcome === 'created' && r.note) state.notes.unshift(r.note)
        return respond({ results })
      }
      match = url.match(/^\/api\/notes\/([^/]+)$/)
      if (match) {
        const note = state.notes.find((n) => n.id === match![1])
        if (!note) return respond({ detail: 'note not found' }, 404)
        if (method === 'PATCH') {
          if (body.title !== undefined) note.title = body.title
          if (body.node_id !== undefined) note.node_id = body.node_id
          return respond(note)
        }
        if (method === 'DELETE') {
          state.notes = state.notes.filter((n) => n !== note)
          return respond(null, 204)
        }
        return respond(note)
      }
      return respond({ detail: `unhandled ${method} ${url}` }, 500)
    }),
  )
  return state
}
