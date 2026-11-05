export interface DomainSummary {
  id: string
  title: string
  node_count: number
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
}

export const queryKeys = {
  domains: ['domains'] as const,
  roadmap: (domain: string) => ['roadmap', domain] as const,
  counts: (domain: string) => ['counts', domain] as const,
  notes: ['notes'] as const,
}
