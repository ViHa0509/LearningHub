import { vi } from 'vitest'
import type { AgentProvider, ProviderTest, ChatPage, ChatReply, ChatTurn, ImportOutcome, Lesson, Note, Roadmap } from '../api'

export const backend: Roadmap = {
  id: 'backend',
  title: 'Backend',
  nodes: [
    { id: 'apis', full_id: 'backend/apis', title: 'APIs', description: null, parent: null, order: 0 },
    {
      id: 'caching',
      full_id: 'backend/caching',
      title: 'Caching',
      description: 'Keeping hot data close.',
      parent: null,
      order: 1,
    },
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

export function makeProvider(
  id: string,
  label: string,
  models: string[],
  extra: Partial<AgentProvider> = {},
): AgentProvider {
  return {
    id,
    label,
    available: true,
    configured: true,
    enabled: true,
    source: 'app',
    overrides_env: false,
    key_hint: '…1234',
    key_error: null,
    base_url: null,
    setting: `LH_${id.toUpperCase()}_API_KEY`,
    models,
    model: models[0],
    default_model: models[0],
    ...extra,
  }
}

export const PROVIDERS: AgentProvider[] = [
  makeProvider('anthropic', 'Anthropic (Claude)', ['claude-sonnet-5-5', 'claude-haiku-5-5']),
  makeProvider('openai', 'OpenAI', ['gpt-5.5']),
]

/** Every provider in the "nothing configured" state. */
export const UNCONFIGURED: AgentProvider[] = [
  ...PROVIDERS,
  makeProvider('ollama', 'Local (Ollama, Gemma)', ['gemma3'], { setting: 'LH_OLLAMA_URL' }),
].map((p) => ({ ...p, available: false, configured: false, source: null, key_hint: null }))

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
  lessons: Record<string, Lesson>
  providers: AgentProvider[]
  test: ProviderTest
  /** Answers POST /api/agent/chat; return a reply, or a status and detail for an error. */
  chat: (body: { provider: string; model: string; messages: ChatTurn[]; page: ChatPage }) => ChatReply | { status: number; detail: string }
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
  const state: FakeState = {
    notes: [...notes],
    importResults,
    lessons: {},
    providers: UNCONFIGURED.map((p) => ({ ...p })),
    test: { ok: true, model: 'claude-sonnet-5-5', latency_ms: 420, message: 'The model answered: OK' },
    chat: () => ({ reply: 'ok', steps: [], changed_lessons: [], stopped: false }),
    calls: [],
  }
  const roadmaps: Record<string, Roadmap> = { backend, devops }
  const descriptions: Record<string, string | null> = { backend: 'Server-side code.', devops: null }

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      state.calls.push({ method, url, body })

      if (url === '/api/domains') {
        const linked = new Set(state.notes.map((n) => n.node_id))
        return respond(
          Object.values(roadmaps).map((r) => ({
            id: r.id,
            title: r.title,
            description: descriptions[r.id],
            node_count: r.nodes.length,
            learned_nodes: r.nodes.filter((n) => linked.has(n.full_id)).length,
          })),
        )
      }
      const lesson = url.match(/^\/api\/lessons\/([^/]+)\/([^/]+)$/)
      if (lesson) {
        const fullId = `${lesson[1]}/${lesson[2]}`
        if (!roadmaps[lesson[1]]?.nodes.some((n) => n.full_id === fullId)) {
          return respond({ detail: `unknown node '${fullId}'` }, 404)
        }
        if (method === 'PUT') {
          if (body.body.trim()) {
            state.lessons[fullId] = {
              node_id: fullId,
              body: body.body,
              source: body.source,
              updated_at: '2026-11-07T00:00:00Z',
            }
          } else delete state.lessons[fullId]
        }
        return respond(state.lessons[fullId] ?? { node_id: fullId, body: '', source: null, updated_at: null })
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
      if (url === '/api/agent/providers') return respond(state.providers)
      const providerMatch = url.match(/^\/api\/agent\/providers\/([^/]+)(\/test)?$/)
      if (providerMatch) {
        const target = state.providers.find((p) => p.id === providerMatch[1])
        if (!target) return respond({ detail: 'unknown provider' }, 404)
        if (providerMatch[2]) return respond({ ...state.test, model: target.model })
        if (method === 'DELETE') {
          Object.assign(target, { configured: false, available: false, source: null, key_hint: null, base_url: null })
          return respond(target)
        }
        if (body.base_url !== undefined) {
          if (!/^https?:\/\//.test(body.base_url)) {
            return respond({ detail: [{ msg: 'Value error, the URL must start with http:// or https://' }] }, 422)
          }
          Object.assign(target, { base_url: body.base_url, configured: true, source: 'app' })
        }
        if (body.api_key) {
          Object.assign(target, { key_hint: `…${body.api_key.slice(-4)}`, configured: true, source: 'app' })
        }
        if (body.model !== undefined) target.model = body.model || target.default_model
        if (body.enabled !== undefined) target.enabled = body.enabled
        target.available = target.configured && target.enabled
        return respond(target)
      }
      if (url === '/api/agent/chat') {
        const answer = state.chat(body)
        return 'status' in answer ? respond({ detail: answer.detail }, answer.status) : respond(answer)
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
