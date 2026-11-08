import { vi } from 'vitest'
import type {
  AgentOut,
  ChatReply,
  ChatRequest,
  ImportOutcome,
  Lesson,
  Note,
  ProviderIn,
  ProviderOut,
  ProviderRef,
  ProviderType,
  ProviderTypeInfo,
  Roadmap,
  TestResult,
} from '../api'

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

function stub(id: string, title: string): Roadmap {
  return {
    id,
    title,
    nodes: [
      { id: 'basics', full_id: `${id}/basics`, title: 'Basics', description: null, parent: null, order: 0 },
      { id: 'tools', full_id: `${id}/tools`, title: 'Tools', description: null, parent: null, order: 1 },
    ],
  }
}

export const frontend = stub('frontend', 'Frontend')
export const qa = stub('qa', 'QA')
export const dataEngineer = stub('data-engineer', 'Data Engineer')
export const aiEngineer = stub('ai-engineer', 'AI Engineer')

export const TYPES: ProviderTypeInfo[] = [
  {
    type: 'openai',
    label: 'OpenAI',
    needs_key: true,
    needs_base_url: false,
    default_base_url: 'https://api.openai.com/v1',
    params: ['temperature', 'max_tokens', 'top_p', 'timeout', 'context_window', 'frequency_penalty', 'presence_penalty', 'stop', 'seed', 'response_format'],
    capabilities: ['Chat', 'Tool use', 'JSON mode'],
    models: [{ id: 'gpt-5.5', context_window: 400000, max_output: 128000 }],
  },
  {
    type: 'anthropic',
    label: 'Anthropic',
    needs_key: true,
    needs_base_url: false,
    default_base_url: null,
    params: ['temperature', 'max_tokens', 'top_p', 'timeout', 'context_window', 'top_k', 'stop'],
    capabilities: ['Chat', 'Tool use'],
    models: [
      { id: 'claude-sonnet-5-5', context_window: 200000, max_output: 64000 },
      { id: 'claude-haiku-5-5', context_window: 200000, max_output: 32000 },
    ],
  },
  {
    type: 'gemini',
    label: 'Google Gemini',
    needs_key: true,
    needs_base_url: false,
    default_base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    params: ['temperature', 'max_tokens', 'top_p', 'timeout', 'context_window', 'frequency_penalty', 'presence_penalty', 'stop', 'seed', 'response_format'],
    capabilities: ['Chat', 'Tool use'],
    models: [{ id: 'gemini-3-pro', context_window: 1000000, max_output: 64000 }],
  },
  {
    type: 'local',
    label: 'Local (Ollama, LM Studio)',
    needs_key: false,
    needs_base_url: true,
    default_base_url: 'http://localhost:11434/v1',
    params: ['temperature', 'max_tokens', 'top_p', 'timeout', 'context_window', 'frequency_penalty', 'presence_penalty', 'stop', 'seed', 'response_format'],
    capabilities: ['Chat'],
    models: [{ id: 'gemma3', context_window: null, max_output: null }],
  },
  {
    type: 'custom',
    label: 'Custom (OpenAI-compatible)',
    needs_key: false,
    needs_base_url: true,
    default_base_url: null,
    params: ['temperature', 'max_tokens', 'top_p', 'timeout', 'context_window', 'frequency_penalty', 'presence_penalty', 'stop', 'seed', 'response_format'],
    capabilities: ['Chat'],
    models: [],
  },
  {
    type: 'claude-code',
    label: 'Claude Code (subscription)',
    needs_key: false,
    needs_base_url: false,
    default_base_url: null,
    params: ['timeout'],
    capabilities: ['Chat'],
    models: [
      { id: 'sonnet', context_window: null, max_output: null },
      { id: 'opus', context_window: null, max_output: null },
      { id: 'haiku', context_window: null, max_output: null },
    ],
  },
]

export const AGENT_DEFS = [
  { id: 'assistant', name: 'Learning assistant', description: 'The chat panel.' },
  { id: 'lesson-writer', name: 'Lesson writer', description: 'Drafts lessons.' },
]

let providerSeq = 0
const keyKind = (key: string) => (key.startsWith('sk-ant-oat') ? 'setup_token' : 'api_key')

export function makeProvider(name: string, type: ProviderType, model: string, extra: Partial<ProviderOut> = {}): ProviderOut {
  providerSeq += 1
  const needsKey = TYPES.find((t) => t.type === type)?.needs_key ?? false
  return {
    id: `p${providerSeq}`,
    name,
    provider_type: type,
    model_name: model,
    key_hint: needsKey ? '…1234' : null,
    key_kind: needsKey ? 'api_key' : null,
    has_key: needsKey,
    base_url: null,
    config: {},
    is_active: true,
    last_test: null,
    last_success_at: null,
    used_by: [],
    created_at: '2026-11-06T00:00:00Z',
    updated_at: '2026-11-06T00:00:00Z',
    ...extra,
  }
}

/** Two active configurations, the usual starting point of a test. */
export function twoProviders(): ProviderOut[] {
  return [
    makeProvider('Claude main', 'anthropic', 'claude-sonnet-5-5'),
    makeProvider('Local qwen', 'local', 'qwen3', { base_url: 'http://localhost:11434/v1' }),
  ]
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
    archived_at: null,
    created_at: '2026-11-06T00:00:00Z',
    updated_at: '2026-11-06T00:00:00Z',
    ...extra,
  }
}

export interface FakeState {
  notes: Note[]
  /** Note id -> HTML source; a note without an entry has a page made from its title. */
  sources: Record<string, string>
  importResults?: ImportOutcome[]
  lessons: Record<string, Lesson>
  types: ProviderTypeInfo[]
  providers: ProviderOut[]
  /** Agent id -> assigned provider ids. */
  assignments: Record<string, { primary: string | null; fallback: string | null }>
  /** What Test Connection answers. */
  test: () => Omit<TestResult, 'tested_at' | 'model'> | Promise<Omit<TestResult, 'tested_at' | 'model'>>
  models: string[] | { status: number; detail: string }
  /**
   * Answers POST /api/agent/chat; return a reply (provider and fallback_used default to the
   * resolved provider and false), or a status and detail for an error.
   */
  chat: (
    body: ChatRequest,
    resolved: ProviderOut | null,
  ) => (Partial<ChatReply> & { reply: string }) | { status: number; detail: string }
  calls: { method: string; url: string; body?: unknown }[]
  /** The request headers of each call, in the same order as `calls`. */
  headers: Record<string, string>[]
}

const respond = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

const ref = (p: ProviderOut | undefined): ProviderRef | null =>
  p
    ? {
        id: p.id,
        name: p.name,
        provider_type: p.provider_type,
        model_name: p.model_name,
        is_active: p.is_active,
        last_test_status: p.last_test?.status ?? null,
      }
    : null

const HEADER_REQUIRED = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Installs a fetch stub that behaves like the backend API over in-memory state. */
export function installFakeApi(notes: Note[] = [], importResults?: ImportOutcome[]): FakeState {
  providerSeq = 0
  const state: FakeState = {
    notes: [...notes],
    sources: {},
    importResults,
    lessons: {},
    types: TYPES,
    providers: [],
    assignments: {},
    test: () => ({ status: 'ok', ok: true, message: 'The model answered: OK', latency_ms: 420 }),
    models: ['gpt-5.5', 'gpt-5.5-mini'],
    chat: () => ({ reply: 'ok', steps: [], changed_lessons: [], stopped: false }),
    calls: [],
    headers: [],
  }
  // Catalog order: Frontend, Backend, DevOps, QA, Data Engineer, AI Engineer.
  const roadmaps: Record<string, Roadmap> = {
    frontend,
    backend,
    devops,
    qa,
    'data-engineer': dataEngineer,
    'ai-engineer': aiEngineer,
  }
  const descriptions: Record<string, string | null> = {
    frontend: 'Interfaces in the browser.',
    backend: 'Server-side code.',
    devops: null,
    qa: 'Testing and quality.',
    'data-engineer': 'Data pipelines.',
    'ai-engineer': 'Building with LLMs and agents.',
  }

  const find = (id: string | null | undefined) => state.providers.find((p) => p.id === id)
  const effective = (agentId: string): { provider?: ProviderOut; reason: AgentOut['effective_reason'] } => {
    const primary = find(state.assignments[agentId]?.primary)
    if (primary?.is_active) return { provider: primary, reason: 'primary' }
    const first = state.providers.find((p) => p.is_active)
    return first ? { provider: first, reason: 'default' } : { reason: 'none' }
  }
  const agentOut = (def: (typeof AGENT_DEFS)[number]): AgentOut => {
    const eff = effective(def.id)
    return {
      ...def,
      primary: ref(find(state.assignments[def.id]?.primary)),
      fallback: ref(find(state.assignments[def.id]?.fallback)),
      effective: ref(eff.provider),
      effective_reason: eff.reason,
    }
  }
  const withUse = (p: ProviderOut): ProviderOut => ({
    ...p,
    used_by: AGENT_DEFS.flatMap((def) => {
      const a = state.assignments[def.id]
      const uses: ProviderOut['used_by'] = []
      if (a?.primary === p.id) uses.push({ agent_id: def.id, agent_name: def.name, role: 'primary' })
      if (a?.fallback === p.id) uses.push({ agent_id: def.id, agent_name: def.name, role: 'fallback' })
      return uses
    }),
  })
  const validate = (body: ProviderIn, selfId?: string) => {
    const errors: { field: string; msg: string }[] = []
    const info = TYPES.find((t) => t.type === body.provider_type)
    if (!body.name?.trim()) errors.push({ field: 'name', msg: 'Name is required' })
    if (!body.model_name?.trim()) errors.push({ field: 'model_name', msg: 'Model is required' })
    const stored = find(selfId)
    if (info?.needs_key && !body.api_key && !stored?.has_key) errors.push({ field: 'api_key', msg: 'An API key is required' })
    if (body.provider_type === 'claude-code') {
      if (body.api_key && !body.api_key.startsWith('sk-ant-oat')) {
        errors.push({ field: 'api_key', msg: 'only a Claude setup token can be used here' })
      }
      if (body.base_url) errors.push({ field: 'base_url', msg: 'A base URL cannot be set for this provider type' })
      return errors
    }
    if (info?.needs_base_url && !body.base_url) errors.push({ field: 'base_url', msg: 'A base URL is required' })
    if (body.provider_type !== 'local' && body.base_url && !/^https:\/\//.test(body.base_url)) {
      errors.push({ field: 'base_url', msg: 'Private and link-local addresses are only allowed for Local' })
    }
    const t = body.config?.temperature
    if (t !== undefined && (t < 0 || t > 2)) errors.push({ field: 'temperature', msg: 'Temperature must be between 0 and 2' })
    for (const key of Object.keys(body.config ?? {})) {
      const basic = ['temperature', 'max_tokens', 'top_p', 'timeout', 'context_window', 'extra']
      if (!basic.includes(key) && !info?.params.includes(key)) {
        errors.push({ field: key, msg: `${key} is not supported by ${info?.label}` })
      }
    }
    return errors
  }

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      const headers = (init?.headers ?? {}) as Record<string, string>
      state.calls.push({ method, url, body })
      state.headers.push(headers)
      if (HEADER_REQUIRED.has(method) && headers['X-LearningHub'] !== '1') {
        return respond({ detail: 'missing X-LearningHub header' }, 403)
      }

      if (url === '/api/domains') {
        const linked = new Set(state.notes.filter((n) => !n.archived_at).map((n) => n.node_id))
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
          if (!n.archived_at && n.node_id?.startsWith(`${domain}/`)) {
            const id = n.node_id.split('/')[1]
            counts[id] = (counts[id] ?? 0) + 1
          }
        }
        return respond({ domain, counts })
      }
      if (url === '/api/ai-providers/types') return respond(state.types)
      if (url === '/api/ai-providers' && method === 'GET') return respond(state.providers.map(withUse))
      if (url === '/api/ai-providers' && method === 'POST') {
        const errors = validate(body)
        if (errors.length) return respond({ detail: errors }, 422)
        if (state.providers.some((p) => p.name === body.name)) {
          return respond({ detail: `The name '${body.name}' is already taken` }, 409)
        }
        const { api_key, ...rest } = body
        const created = makeProvider(body.name, body.provider_type, body.model_name, {
          ...rest,
          base_url: body.base_url ?? null,
          has_key: !!api_key,
          key_hint: api_key ? `\u2026${api_key.slice(-4)}` : null,
          key_kind: api_key ? keyKind(api_key) : null,
        })
        state.providers.push(created)
        return respond(withUse(created), 201)
      }
      if (url === '/api/ai-providers/test' && method === 'POST') {
        const errors = validate(body, body.provider_id)
        if (errors.length) return respond({ detail: errors }, 422)
        const result = await state.test()
        return respond({ ...result, model: body.model_name, tested_at: '2026-11-07T10:00:00Z' })
      }
      const providerMatch = url.match(/^\/api\/ai-providers\/([^/]+)(\/test|\/models)?$/)
      if (providerMatch) {
        const target = find(providerMatch[1])
        if (!target) return respond({ detail: 'provider not found' }, 404)
        if (providerMatch[2] === '/models') {
          return Array.isArray(state.models)
            ? respond({ models: state.models })
            : respond({ detail: state.models.detail }, state.models.status)
        }
        if (providerMatch[2] === '/test') {
          const result = await state.test()
          target.last_test = {
            status: result.status,
            message: result.message,
            latency_ms: result.latency_ms,
            at: '2026-11-07T10:00:00Z',
          }
          if (result.ok) target.last_success_at = '2026-11-07T10:00:00Z'
          return respond({ ...result, model: target.model_name, tested_at: '2026-11-07T10:00:00Z' })
        }
        if (method === 'DELETE') {
          const using = withUse(target).used_by
          if (using.length) {
            return respond(
              {
                detail: 'The provider is in use',
                agents: using.map((u) => ({ id: u.agent_id, name: u.agent_name, role: u.role })),
              },
              409,
            )
          }
          state.providers = state.providers.filter((p) => p !== target)
          return respond(null, 204)
        }
        if (method === 'PUT') {
          const errors = validate(body, target.id)
          if (errors.length) return respond({ detail: errors }, 422)
          if (state.providers.some((p) => p !== target && p.name === body.name)) {
            return respond({ detail: `The name '${body.name}' is already taken` }, 409)
          }
          const { api_key, ...rest } = body
          Object.assign(target, rest, { base_url: body.base_url ?? null })
          if (api_key)
            Object.assign(target, { has_key: true, key_hint: `\u2026${api_key.slice(-4)}`, key_kind: keyKind(api_key) })
          return respond(withUse(target))
        }
        return respond(withUse(target))
      }
      if (url === '/api/agents') return respond(AGENT_DEFS.map(agentOut))
      const agentMatch = url.match(/^\/api\/agents\/([^/]+)\/provider$/)
      if (agentMatch) {
        const def = AGENT_DEFS.find((d) => d.id === agentMatch[1])
        if (!def) return respond({ detail: 'unknown agent' }, 404)
        if (method === 'PUT') {
          if (body.primary_provider_id && body.primary_provider_id === body.fallback_provider_id) {
            return respond({ detail: 'The fallback must differ from the primary provider' }, 422)
          }
          state.assignments[def.id] = { primary: body.primary_provider_id, fallback: body.fallback_provider_id }
        }
        return respond(agentOut(def))
      }
      if (url === '/api/agent/chat') {
        const chatBody = body as ChatRequest
        const override = chatBody.provider_id ? find(chatBody.provider_id) : undefined
        if (chatBody.provider_id && !override) return respond({ detail: 'unknown provider' }, 404)
        const resolved = override ?? effective(chatBody.agent_id).provider ?? null
        if (!resolved) return respond({ detail: 'No AI provider is active. Configure one in Settings.' }, 409)
        const answer = state.chat(chatBody, resolved)
        if ('status' in answer) return respond({ detail: answer.detail }, answer.status)
        return respond({
          steps: [],
          changed_lessons: [],
          stopped: false,
          provider: { id: resolved.id, name: resolved.name, model: resolved.model_name },
          fallback_used: false,
          effort: chatBody.effort ?? 'medium',
          ...answer,
        })
      }
      if (url === '/api/notes' && method === 'GET') return respond(state.notes.filter((n) => !n.archived_at))
      if (url === '/api/notes?archived=true' && method === 'GET') {
        return respond(
          state.notes
            .filter((n) => n.archived_at)
            .sort((a, b) => (b.archived_at ?? '').localeCompare(a.archived_at ?? '')),
        )
      }
      if (url === '/api/notes/import') {
        const results = state.importResults ?? []
        for (const r of results) if (r.outcome === 'created' && r.note) state.notes.unshift(r.note)
        return respond({ results })
      }
      const source = (n: Note) => state.sources[n.id] ?? `<title>${n.title}</title><p>${n.title}</p>`
      const sha = (html: string) => `sha-${html.length}-${[...html].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)}`
      const detail = (n: Note) => ({ ...n, body_text: source(n), content_sha256: sha(source(n)) })
      match = url.match(/^\/api\/notes\/([^/]+)\/original$/)
      if (match) {
        const note = state.notes.find((n) => n.id === match![1])
        if (!note) return respond({ detail: 'note not found' }, 404)
        return Promise.resolve(new Response(source(note), { status: 200, headers: { 'Content-Type': 'text/html' } }))
      }
      match = url.match(/^\/api\/notes\/([^/]+)\/content$/)
      if (match && method === 'PUT') {
        const note = state.notes.find((n) => n.id === match![1])
        if (!note) return respond({ detail: 'note not found' }, 404)
        const html = String(body.html ?? '').trim()
        if (!html) return respond({ detail: 'the page must not be empty' }, 422)
        if (body.base_sha256 && body.base_sha256 !== sha(source(note))) {
          return respond({ detail: 'the page changed since you opened it' }, 409)
        }
        state.sources[note.id] = html
        return respond(detail(note))
      }
      match = url.match(/^\/api\/notes\/([^/]+)$/)
      if (match) {
        const note = state.notes.find((n) => n.id === match![1])
        if (!note) return respond({ detail: 'note not found' }, 404)
        if (method === 'PATCH') {
          if (body.title !== undefined) note.title = body.title
          if (body.node_id !== undefined) note.node_id = body.node_id
          if (body.archived !== undefined) {
            note.archived_at = body.archived ? (note.archived_at ?? new Date().toISOString()) : null
          }
          return respond(detail(note))
        }
        if (method === 'DELETE') {
          state.notes = state.notes.filter((n) => n !== note)
          return respond(null, 204)
        }
        return respond(detail(note))
      }
      return respond({ detail: `unhandled ${method} ${url}` }, 500)
    }),
  )
  return state
}
