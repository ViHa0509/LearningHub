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
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface NoteDetail extends Note {
  body_text: string
  content_sha256: string
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

export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'local' | 'custom' | 'claude-code'

export type TestStatus =
  | 'ok'
  | 'auth_failed'
  | 'invalid_model'
  | 'unavailable'
  | 'timeout'
  | 'rate_limited'
  | 'invalid_config'

export interface ProviderConfig {
  temperature?: number
  max_tokens?: number
  top_p?: number
  top_k?: number
  timeout?: number
  frequency_penalty?: number
  presence_penalty?: number
  stop?: string[]
  seed?: number
  response_format?: 'text' | 'json'
  context_window?: number
  extra?: Record<string, unknown>
}

export interface ModelPreset {
  id: string
  context_window: number | null
  max_output: number | null
}

export interface ProviderTypeInfo {
  type: ProviderType
  label: string
  needs_key: boolean
  needs_base_url: boolean
  default_base_url: string | null
  params: string[]
  capabilities: string[]
  models: ModelPreset[]
}

export interface ProviderIn {
  name: string
  provider_type: ProviderType
  model_name: string
  api_key?: string
  base_url?: string
  is_active: boolean
  config: ProviderConfig
}

export interface TestResult {
  status: TestStatus
  ok: boolean
  message: string
  latency_ms: number | null
  model: string
  tested_at: string
}

export interface ProviderUse {
  agent_id: string
  agent_name: string
  role: 'primary' | 'fallback'
}

export interface ProviderOut {
  id: string
  name: string
  provider_type: ProviderType
  model_name: string
  key_hint: string | null
  key_kind: 'api_key' | 'setup_token' | null
  has_key: boolean
  base_url: string | null
  config: ProviderConfig
  is_active: boolean
  last_test: { status: TestStatus; message: string | null; latency_ms: number | null; at: string } | null
  last_success_at: string | null
  used_by: ProviderUse[]
  created_at: string
  updated_at: string
}

export interface ProviderRef {
  id: string
  name: string
  provider_type: ProviderType
  model_name: string
  is_active: boolean
  last_test_status: TestStatus | null
}

export interface AgentOut {
  id: string
  name: string
  description: string
  primary: ProviderRef | null
  fallback: ProviderRef | null
  effective: ProviderRef | null
  effective_reason: 'override' | 'primary' | 'default' | 'none'
}

export interface AgentAssignment {
  primary_provider_id: string | null
  fallback_provider_id: string | null
}

export interface FieldError {
  field: string
  msg: string
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

export type Effort = 'low' | 'medium' | 'high'

/** A text file sent with one chat message. */
export interface ChatAttachment {
  name: string
  text: string
}

export interface ChatReply {
  reply: string
  steps: AgentStep[]
  changed_lessons: string[]
  stopped: boolean
  provider: { id: string; name: string; model: string }
  fallback_used: boolean
  effort: Effort
}

export interface ChatRequest {
  agent_id: string
  provider_id?: string
  messages: ChatTurn[]
  page: ChatPage
  effort?: Effort
  /** Text files for the last user message only. */
  attachments?: ChatAttachment[]
}

export class ApiError extends Error {
  status: number
  /** Field errors of a 422 answer (`detail[].field`), with any `config.` prefix removed. */
  fields: FieldError[]
  /** The decoded JSON body of the error answer, when there was one. */
  body: unknown

  constructor(status: number, message: string, fields: FieldError[] = [], body: unknown = undefined) {
    super(message)
    this.status = status
    this.fields = fields
    this.body = body
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // The backend refuses changes without this header, so other origins (imported pages) cannot make them.
  const response = await fetch(path, {
    ...init,
    headers: { ...(init?.headers as Record<string, string> | undefined), 'X-LearningHub': '1' },
  })
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    let fields: FieldError[] = []
    let body: unknown
    try {
      body = await response.json()
      const detail = (body as { detail?: unknown }).detail
      if (typeof detail === 'string') message = detail
      // FastAPI validation errors: a list of {msg}, ours also carry {field}
      else if (Array.isArray(detail)) {
        const items = detail as { field?: string; msg?: string }[]
        const clean = (m?: string) => (m ?? '').replace(/^Value error, /, '')
        fields = items
          .filter((d) => typeof d.field === 'string')
          .map((d) => ({ field: (d.field as string).split('.').pop() as string, msg: clean(d.msg) }))
        message = items.map((d) => clean(d.msg)).filter(Boolean).join('; ')
      }
    } catch {
      // keep the status text
    }
    throw new ApiError(response.status, message, fields, body)
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
  archivedNotes: () => request<Note[]>('/api/notes?archived=true'),
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
  setArchived: (id: string, archived: boolean) =>
    request<Note>(`/api/notes/${id}`, json('PATCH', { archived })),
  remove: (id: string) => request<void>(`/api/notes/${id}`, { method: 'DELETE' }),
  originalUrl: (id: string) => `/api/notes/${id}/original`,
  note: (id: string) => request<NoteDetail>(`/api/notes/${id}`),
  /** The page's HTML source, for the editor. */
  noteSource: async (id: string) => {
    const response = await fetch(`/api/notes/${id}/original`)
    if (!response.ok) throw new ApiError(response.status, `${response.status} ${response.statusText}`)
    return response.text()
  },
  saveContent: (id: string, html: string, baseSha: string) =>
    request<NoteDetail>(`/api/notes/${id}/content`, json('PUT', { html, base_sha256: baseSha })),
  providerTypes: () => request<ProviderTypeInfo[]>('/api/ai-providers/types'),
  providers: () => request<ProviderOut[]>('/api/ai-providers'),
  provider: (id: string) => request<ProviderOut>(`/api/ai-providers/${id}`),
  createProvider: (body: ProviderIn) => request<ProviderOut>('/api/ai-providers', json('POST', body)),
  updateProvider: (id: string, body: ProviderIn) =>
    request<ProviderOut>(`/api/ai-providers/${id}`, json('PUT', body)),
  deleteProvider: (id: string) => request<void>(`/api/ai-providers/${id}`, { method: 'DELETE' }),
  testSavedProvider: (id: string) =>
    request<TestResult>(`/api/ai-providers/${id}/test`, { method: 'POST' }),
  testProviderSettings: (body: ProviderIn, providerId?: string) =>
    request<TestResult>(
      '/api/ai-providers/test',
      json('POST', providerId ? { ...body, provider_id: providerId } : body),
    ),
  providerModels: (id: string) => request<{ models: string[] }>(`/api/ai-providers/${id}/models`),
  agents: () => request<AgentOut[]>('/api/agents'),
  assignAgent: (id: string, body: AgentAssignment) =>
    request<AgentOut>(`/api/agents/${id}/provider`, json('PUT', body)),
  chat: (body: ChatRequest) => request<ChatReply>('/api/agent/chat', json('POST', body)),
  lesson: (domain: string, node: string) => request<Lesson>(`/api/lessons/${domain}/${node}`),
  saveLesson: (domain: string, node: string, body: string, source: LessonSource = 'user') =>
    request<Lesson>(`/api/lessons/${domain}/${node}`, json('PUT', { body, source })),
}

export const queryKeys = {
  domains: ['domains'] as const,
  roadmap: (domain: string) => ['roadmap', domain] as const,
  counts: (domain: string) => ['counts', domain] as const,
  notes: ['notes'] as const,
  archivedNotes: ['notes', 'archived'] as const,
  lesson: (domain: string, node: string) => ['lesson', domain, node] as const,
  providers: ['ai-providers'] as const,
  provider: (id: string) => ['ai-providers', id] as const,
  providerTypes: ['ai-provider-types'] as const,
  agents: ['agents'] as const,
}
