export interface DomainSummary {
  id: string
  title: string
  description: string | null
  node_count: number
  learned_nodes: number
}

export interface RoadmapNode {
  id: string
  full_id: string
  title: string
  description: string | null
  parent: string | null
  order: number
}

export interface Roadmap {
  id: string
  title: string
  nodes: RoadmapNode[]
}

export interface NodeCounts {
  domain: string
  counts: Record<string, number>
}

export interface Note {
  id: string
  title: string
  original_name: string
  size_bytes: number
  node_id: string | null
  node_missing: boolean
  created_at: string
  updated_at: string
}

export interface ImportOutcome {
  filename: string
  outcome: 'created' | 'duplicate' | 'rejected'
  reason: string | null
  note: Note | null
}

export type LessonSource = 'user' | 'agent' | 'import'

export interface Lesson {
  node_id: string
  body: string
  source: LessonSource | null
  updated_at: string | null
}

export interface AgentProvider {
  id: string
  label: string
  available: boolean
  configured: boolean
  enabled: boolean
  source: 'app' | 'env' | null
  overrides_env: boolean
  key_hint: string | null
  key_error: string | null
  base_url: string | null
  setting: string
  models: string[]
  /** The model chosen in Settings (may be a custom id); the chat's default. */
  model: string
  default_model: string
}

export interface ProviderUpdate {
  api_key?: string
  base_url?: string
  model?: string
  enabled?: boolean
}

export interface ProviderTest {
  ok: boolean
  model: string
  latency_ms: number
  message: string
}

export interface ChatPage {
  kind: 'home' | 'roadmap' | 'lesson' | 'note'
  domain?: string
  node?: string
  note_id?: string
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentStep {
  tool: string
  input: Record<string, unknown>
  summary: string
}

export interface ChatReply {
  reply: string
  steps: AgentStep[]
  changed_lessons: string[]
  stopped: boolean
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') message = body.detail
      // FastAPI validation errors: a list of {msg}
      else if (Array.isArray(body.detail)) {
        message = body.detail
          .map((d: { msg?: string }) => (d.msg ?? '').replace(/^Value error, /, ''))
          .filter(Boolean)
          .join('; ')
      }
    } catch {
      // keep the status text
    }
    throw new ApiError(response.status, message)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  domains: () => request<DomainSummary[]>('/api/domains'),
  roadmap: (domain: string) => request<Roadmap>(`/api/domains/${domain}/roadmap`),
  counts: (domain: string) => request<NodeCounts>(`/api/domains/${domain}/counts`),
  notes: () => request<Note[]>('/api/notes'),
  importFiles: (files: File[]) => {
    const form = new FormData()
    for (const file of files) form.append('files', file)
    return request<{ results: ImportOutcome[] }>('/api/notes/import', {
      method: 'POST',
      body: form,
    })
  },
  rename: (id: string, title: string) => request<Note>(`/api/notes/${id}`, json('PATCH', { title })),
  link: (id: string, nodeId: string | null) =>
    request<Note>(`/api/notes/${id}`, json('PATCH', { node_id: nodeId })),
  remove: (id: string) => request<void>(`/api/notes/${id}`, { method: 'DELETE' }),
  originalUrl: (id: string) => `/api/notes/${id}/original`,
  providers: () => request<AgentProvider[]>('/api/agent/providers'),
  saveProvider: (id: string, body: ProviderUpdate) =>
    request<AgentProvider>(`/api/agent/providers/${id}`, json('PUT', body)),
  removeProvider: (id: string) => request<AgentProvider>(`/api/agent/providers/${id}`, { method: 'DELETE' }),
  testProvider: (id: string) => request<ProviderTest>(`/api/agent/providers/${id}/test`, { method: 'POST' }),
  chat: (body: { provider: string; model: string; messages: ChatTurn[]; page: ChatPage }) =>
    request<ChatReply>('/api/agent/chat', json('POST', body)),
  lesson: (domain: string, node: string) => request<Lesson>(`/api/lessons/${domain}/${node}`),
  saveLesson: (domain: string, node: string, body: string, source: LessonSource = 'user') =>
    request<Lesson>(`/api/lessons/${domain}/${node}`, json('PUT', { body, source })),
}

export const queryKeys = {
  domains: ['domains'] as const,
  roadmap: (domain: string) => ['roadmap', domain] as const,
  counts: (domain: string) => ['counts', domain] as const,
  notes: ['notes'] as const,
  lesson: (domain: string, node: string) => ['lesson', domain, node] as const,
  providers: ['agent-providers'] as const,
}
