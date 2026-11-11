import { vi } from 'vitest'
import type {
  AdminUser,
  AgentOut,
  Invitation,
  Role,
  ChatReply,
  ChatRequest,
  ExtractedPdf,
  ImportOutcome,
  Lesson,
  NewsItem,
  NewsRefreshStatus,
  Note,
  OAuthProvider,
  RestoreResult,
  ProviderIn,
  ProviderOut,
  ProviderRef,
  ProviderType,
  ProviderTypeInfo,
  ResourceItem,
  ResourceSyncStatus,
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
  /**
   * Answers POST /api/lessons/extract-pdf for the uploaded file: the extracted text, or a status and
   * detail for a refusal. Default: a file named *.pdf gives "Text of <name>", any other a 422.
   */
  extractPdf: (
    file: File,
  ) => ExtractedPdf | { status: number; detail: string } | Promise<ExtractedPdf | { status: number; detail: string }>
  types: ProviderTypeInfo[]
  providers: ProviderOut[]
  /** Agent id -> assigned provider ids. */
  assignments: Record<string, { primary: string | null; fallback: string | null }>
  /** Agent id -> Internet search switch. */
  webSearch: Record<string, boolean>
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
  /**
   * An outage: `server` makes every request fail with a network error; `proxy` makes every request
   * answer a plain-text 500 (the dev proxy with no backend behind it); `database` makes the health
   * check answer 503 (reason database) and every other request 500. null (the default) is healthy.
   */
  down: null | 'server' | 'proxy' | 'database'
  /** Node id -> its references (synthetic test links), in API order; a node without an entry has none. */
  resources: Record<string, ResourceItem[]>
  /** The sync time of every node with references. */
  resourcesSyncedAt: string
  /** Domains with a resource mapping; the sync routes answer 404 for the others. Default: frontend. */
  resourceMappings: string[]
  /** Domain -> its sync job; a domain without an entry is idle. */
  syncJobs: Record<string, ResourceSyncStatus>
  /**
   * How a started sync ends, once its status has been read `syncPolls` times while running: it stores
   * these links (replacing the domain's) and is done, or it fails with this error and keeps the old links.
   */
  syncOutcome: { links: Record<string, ResourceItem[]> } | { error: string }
  syncPolls: number
  /** Stored news items (synthetic), in any order; the list answers them newest first. */
  news: NewsItem[]
  /** The configured news sources, in configuration order. */
  newsSources: { id: string; name: string; homepage: string }[]
  newsLastRefreshAt: string | null
  /** What GET /api/news says about staleness; a finished refresh sets it to false. */
  newsStale: boolean
  /** The refresh job (idle until one is started). */
  newsJob: NewsRefreshStatus
  /**
   * How a started refresh ends, once its status has been read `newsRefreshPolls` times while running:
   * it stores these items (once per URL), and every source named in `failures` fails with that reason.
   */
  newsRefreshOutcome: { items: NewsItem[]; failures?: Record<string, string> }
  newsRefreshPolls: number
  /** The login model; by default no session is required, so the app shows as before. */
  auth: FakeAuth
  /** The sign-in setup: what is saved in the app, what the environment sets, and the public address. */
  signIn: FakeSignIn
  /** Backup, restore and sync. */
  data: FakeData
  /** The admin's Users page and the invitation links. */
  admin: FakeAdmin
}

export interface FakeAdmin {
  users: AdminUser[]
  invitations: Invitation[]
  /** Invitation token -> email, for the invitation page; each works once. */
  inviteTokens: Record<string, string>
  /** When set, POST /api/admin/invitations answers 409 with this detail. */
  inviteConflict: string | null
  /** When set, creating an invitation also answers this invite_url (a server without SMTP). */
  inviteUrl: string | null
}

export interface FakeSignIn {
  publicUrl: string
  app: Record<OAuthProvider, { client_id: string; secret: string } | null>
  env: Record<OAuthProvider, { client_id: string } | null>
  /** When set, saving answers 422 with this detail. */
  saveError: string | null
}

export interface FakeData {
  /** The sync key active on this (target) server; its value is shown once at creation. */
  syncKey: { key: string; expires_at: string } | null
  /** What a restore or a sync answers: the result, or a status and detail for a refusal. */
  restore: RestoreResult | { status: number; detail: string }
  sync: RestoreResult | { status: number; detail: string }
  /** Files received by POST /api/data/restore: name and the confirm field. */
  restored: { name: string; confirm: string }[]
}

export interface FakeOwner {
  /** Defaults to admin. */
  role?: Role
  email: string
  password: string | null
  display_name: string | null
  email_verified: boolean
  avatar_url: string | null
}

export interface FakeAuthToken {
  purpose: 'reset_password' | 'magic_link' | 'verify_email'
  token: string
  used: boolean
}

export interface FakeAuth {
  /** GET /api/auth/status `auth_required`: with true, every app route answers 401 without a session. */
  required: boolean
  owner: FakeOwner | null
  /** This browser has a valid session cookie. */
  signedIn: boolean
  providers: { github: boolean; google: boolean }
  mail: 'smtp' | 'outbox'
  /** Tokens "emailed" so far (and ones a test seeds); each works once. */
  tokens: FakeAuthToken[]
  /** When set, every auth POST answers 429 with this detail. */
  limited: string | null
}

/** The Owner a signed-in test starts with. */
export const OWNER: FakeOwner = {
  email: 'me@example.test',
  password: 'correct horse battery',
  display_name: 'Ada Lovelace',
  email_verified: true,
  avatar_url: null,
}

/** Makes the fake API require a session; `signedIn` says whether this browser has one. */
export function requireLogin(state: FakeState, options: { signedIn?: boolean; owner?: FakeOwner | null } = {}) {
  state.auth.required = true
  state.auth.owner = options.owner === undefined ? { ...OWNER } : options.owner
  state.auth.signedIn = options.signedIn ?? false
}

export const NEWS_SOURCES = [
  { id: 'openai-news', name: 'OpenAI News', homepage: 'https://openai.example.test/news' },
  { id: 'mit-news', name: 'MIT News', homepage: 'https://mit.example.test/news' },
]

let newsSeq = 0
/** A synthetic news item (never real feed data). */
export function makeNewsItem(title: string, source: string, publishedAt: Date | string, summary = ''): NewsItem {
  newsSeq += 1
  return {
    id: `news-${newsSeq}`,
    source,
    source_name: NEWS_SOURCES.find((s) => s.id === source)?.name ?? source,
    title,
    url: `https://${source}.example.test/item/${newsSeq}`,
    published_at: typeof publishedAt === 'string' ? publishedAt : publishedAt.toISOString(),
    summary,
  }
}

let resourceSeq = 0
/** A synthetic reference link (never real roadmap.sh data). */
export function makeResource(title: string, type: string, url?: string): ResourceItem {
  resourceSeq += 1
  return {
    url: url ?? `https://example.test/${type}/${resourceSeq}`,
    title,
    type,
    source_ref: `frontend/synthetic-${resourceSeq}`,
  }
}

const idleJob = (domain: string): ResourceSyncStatus => ({
  domain,
  state: 'idle',
  commit: null,
  nodes: null,
  links: null,
  error: null,
  started_at: null,
  finished_at: null,
})

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
    extractPdf: (file) =>
      file.name.toLowerCase().endsWith('.pdf')
        ? { markdown: `Text of ${file.name}`, pages: 1, truncated: false, warning: null }
        : { status: 422, detail: 'the file is not a PDF' },
    types: TYPES,
    providers: [],
    assignments: {},
    webSearch: {},
    test: () => ({ status: 'ok', ok: true, message: 'The model answered: OK', latency_ms: 420 }),
    models: ['gpt-5.5', 'gpt-5.5-mini'],
    chat: () => ({ reply: 'ok', steps: [], changed_lessons: [], stopped: false }),
    calls: [],
    headers: [],
    down: null,
    resources: {},
    resourcesSyncedAt: '2026-11-08T09:30:00Z',
    resourceMappings: ['frontend'],
    syncJobs: {},
    syncOutcome: { links: {} },
    syncPolls: 1,
    news: [],
    newsSources: NEWS_SOURCES,
    newsLastRefreshAt: '2026-11-08T09:00:00Z',
    newsStale: false,
    newsJob: { state: 'idle', started_at: null, finished_at: null, error: null, sources: [] },
    newsRefreshOutcome: { items: [] },
    newsRefreshPolls: 1,
    auth: {
      required: false,
      owner: null,
      signedIn: false,
      providers: { github: false, google: false },
      mail: 'smtp',
      tokens: [],
      limited: null,
    },
    signIn: {
      publicUrl: 'https://hub.example.com',
      app: { github: null, google: null },
      env: { github: null, google: null },
      saveError: null,
    },
    admin: { users: [], invitations: [], inviteTokens: {}, inviteConflict: null, inviteUrl: null },
    data: {
      syncKey: null,
      restore: { counts: { notes: 2, files: 2, lessons: 1, providers: 1 }, providers_needing_key: [] },
      sync: { counts: { notes: 2, files: 2, lessons: 1, providers: 1 }, providers_needing_key: [] },
      restored: [],
    },
  }
  const signInOut = () => {
    const one = (name: OAuthProvider) => {
      const app = state.signIn.app[name]
      const env = state.signIn.env[name]
      state.auth.providers[name] = !!(app || env)
      return {
        client_id: app?.client_id ?? env?.client_id ?? null,
        secret_hint: app ? `••••${app.secret.slice(-4)}` : env ? '••••env!' : null,
        source: app ? 'app' : env ? 'env' : null,
        callback_url: `${state.signIn.publicUrl}/api/auth/oauth/${name}/callback`,
      }
    }
    return { public_url: state.signIn.publicUrl, providers: { github: one('github'), google: one('google') } }
  }
  let tokenSeq = 0
  const me = (owner: FakeOwner) => ({
    id: 'u1',
    role: owner.role ?? 'admin',
    email: owner.email,
    email_verified: owner.email_verified,
    display_name: owner.display_name,
    bio: null,
    avatar_url: owner.avatar_url,
    has_password: owner.password !== null,
    linked: [],
  })
  const issue = (purpose: FakeAuthToken['purpose']) => {
    tokenSeq += 1
    state.auth.tokens.push({ purpose, token: `${purpose}-${tokenSeq}`, used: false })
  }
  const take = (purpose: FakeAuthToken['purpose'], token: string) => {
    const found = state.auth.tokens.find((t) => t.purpose === purpose && t.token === token && !t.used)
    if (found) found.used = true
    return found
  }
  const INVALID_LINK = 'This link is invalid or has expired. Ask for a new one.'
  /** Answers /api/auth/...; null for an unknown auth route. */
  const authRoute = (url: string, method: string, body: Record<string, string> | undefined) => {
    const auth = state.auth
    if (url === '/api/auth/status') {
      return respond({
        auth_required: auth.required,
        has_owner: auth.owner !== null,
        providers: { github: { configured: auth.providers.github }, google: { configured: auth.providers.google } },
        mail: { mode: auth.mail },
      })
    }
    if (url === '/api/auth/me') {
      return auth.signedIn && auth.owner ? respond(me(auth.owner)) : respond({ detail: 'Sign in to continue' }, 401)
    }
    if (url.startsWith('/api/auth/invitation?token=') && method === 'GET') {
      const token = decodeURIComponent(url.split('token=')[1] ?? '')
      const invited = state.admin.inviteTokens[token]
      return invited
        ? respond({ email: invited, expires_at: '2026-11-17T09:00:00Z' })
        : respond({ detail: 'This invitation has expired or was already used.' }, 404)
    }
    if (method !== 'POST') return null
    if (auth.limited) return respond({ detail: auth.limited }, 429)
    const email = (body?.email ?? '').trim().toLowerCase()
    switch (url) {
      case '/api/auth/signup': {
        if (auth.owner) return respond({ detail: 'This app has an owner already' }, 403)
        if ((body?.password ?? '').length < 10) {
          return respond({ detail: 'Use at least 10 characters for the password.' }, 400)
        }
        auth.owner = {
          email,
          password: body?.password ?? '',
          display_name: body?.display_name ?? null,
          email_verified: false,
          avatar_url: null,
        }
        auth.signedIn = true
        issue('verify_email')
        return respond(me(auth.owner), 201)
      }
      case '/api/auth/login':
        if (!auth.owner || auth.owner.email !== email || auth.owner.password !== body?.password) {
          return respond({ detail: 'Wrong email or password' }, 401)
        }
        auth.signedIn = true
        return respond(me(auth.owner))
      case '/api/auth/invitation/accept': {
        const invited = state.admin.inviteTokens[body?.token ?? '']
        if (!invited) return respond({ detail: 'This invitation has expired or was already used.' }, 404)
        if ((body?.password ?? '').length < 10) {
          return respond({ detail: 'Use at least 10 characters for the password.' }, 400)
        }
        delete state.admin.inviteTokens[body?.token ?? '']
        state.admin.invitations = state.admin.invitations.filter((i) => i.email !== invited)
        auth.owner = {
          role: 'member',
          email: invited,
          password: body?.password ?? '',
          display_name: body?.display_name ?? null,
          email_verified: true,
          avatar_url: null,
        }
        auth.signedIn = true
        return respond(me(auth.owner), 201)
      }
      case '/api/auth/logout':
        auth.signedIn = false
        return respond(null, 204)
      case '/api/auth/forgot':
        if (auth.owner?.email === email) issue('reset_password')
        return respond({ message: 'If that email belongs to the owner, a reset link is on its way.' })
      case '/api/auth/magic':
        if (auth.owner?.email === email && auth.owner.email_verified) issue('magic_link')
        return respond({ message: 'If that email belongs to the owner, a sign-in link is on its way.' })
      case '/api/auth/reset': {
        if ((body?.password ?? '').length < 10) {
          return respond({ detail: 'Use at least 10 characters for the password.' }, 400)
        }
        if (!auth.owner || !take('reset_password', body?.token ?? '')) return respond({ detail: INVALID_LINK }, 400)
        auth.owner.password = body?.password ?? ''
        auth.owner.email_verified = true
        auth.signedIn = true
        return respond(me(auth.owner))
      }
      case '/api/auth/magic/consume':
        if (!auth.owner || !take('magic_link', body?.token ?? '')) return respond({ detail: INVALID_LINK }, 400)
        auth.signedIn = true
        return respond(me(auth.owner))
      case '/api/auth/verify':
        if (!auth.owner || !take('verify_email', body?.token ?? '')) return respond({ detail: INVALID_LINK }, 400)
        auth.owner.email_verified = true
        return respond({ email_verified: true })
      case '/api/auth/verify/resend':
        if (!auth.signedIn || !auth.owner) return respond({ detail: 'Sign in to continue' }, 401)
        if (auth.owner.email_verified) return respond({ message: 'Your email is verified already.' })
        issue('verify_email')
        return respond({ message: 'A verification link is on its way.' })
    }
    return null
  }
  let newsPollsLeft = 0
  const finishNewsRefresh = () => {
    const failures = state.newsRefreshOutcome.failures ?? {}
    const known = new Set(state.news.map((n) => n.url))
    const added: Record<string, number> = {}
    for (const item of state.newsRefreshOutcome.items) {
      if (failures[item.source] || known.has(item.url)) continue
      known.add(item.url)
      state.news.push(item)
      added[item.source] = (added[item.source] ?? 0) + 1
    }
    const sources = state.newsSources.map((src) =>
      failures[src.id]
        ? { id: src.id, name: src.name, ok: false, items: null, error: failures[src.id] }
        : { id: src.id, name: src.name, ok: true, items: added[src.id] ?? 0, error: null },
    )
    const allFailed = sources.length > 0 && sources.every((src) => !src.ok)
    state.newsJob = {
      ...state.newsJob,
      state: allFailed ? 'failed' : 'done',
      finished_at: '2026-11-08T10:01:00Z',
      error: allFailed ? 'every source failed' : null,
      sources,
    }
    state.newsLastRefreshAt = new Date().toISOString()
    state.newsStale = false
  }
  /** Domain -> status reads left before a running sync ends. */
  const pollsLeft: Record<string, number> = {}
  const finishSync = (domain: string) => {
    const job = state.syncJobs[domain]
    const outcome = state.syncOutcome
    if ('error' in outcome) {
      state.syncJobs[domain] = { ...job, state: 'failed', error: outcome.error, finished_at: '2026-11-08T09:31:00Z' }
      return
    }
    for (const id of Object.keys(state.resources)) if (id.startsWith(`${domain}/`)) delete state.resources[id]
    Object.assign(state.resources, outcome.links)
    const links = Object.values(outcome.links).reduce((n, items) => n + items.length, 0)
    state.syncJobs[domain] = {
      ...job,
      state: 'done',
      nodes: Object.keys(outcome.links).length,
      links,
      finished_at: '2026-11-08T09:31:00Z',
    }
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
    // Like the backend: an agent without any assignment of its own uses the assistant's.
    const own = state.assignments[agentId]
    const hasOwn = !!(own?.primary || own?.fallback)
    const inherited = !hasOwn && agentId !== 'assistant'
    const primary = find((inherited ? state.assignments.assistant : own)?.primary)
    if (primary?.is_active) return { provider: primary, reason: inherited ? 'assistant' : 'primary' }
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
      web_search: state.webSearch[def.id] ?? false,
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
      if (state.down === 'server') throw new TypeError('Failed to fetch')
      if (state.down === 'proxy') return new Response('Proxy error', { status: 500 })
      if (url === '/api/health') {
        return state.down === 'database'
          ? respond({ status: 'unavailable', reason: 'database' }, 503)
          : respond({ status: 'ok' })
      }
      if (state.down === 'database') return respond({ detail: 'Internal Server Error' }, 500)
      if (url.startsWith('/api/auth/')) {
        const answer = authRoute(url, method, body as Record<string, string> | undefined)
        if (answer) return answer
      } else if (state.auth.required && !state.auth.signedIn) {
        return respond({ detail: 'Sign in to continue' }, 401)
      }
      if (HEADER_REQUIRED.has(method) && headers['X-LearningHub'] !== '1') {
        return respond({ detail: 'missing X-LearningHub header' }, 403)
      }

      if (url.startsWith('/api/admin/')) {
        if (state.auth.owner?.role === 'member') return respond({ detail: 'Only the admin can do this' }, 403)
        const admin = state.admin
        if (url === '/api/admin/users' && method === 'GET') return respond(admin.users)
        if (url === '/api/admin/invitations' && method === 'GET') return respond(admin.invitations)
        if (url === '/api/admin/invitations' && method === 'POST') {
          const address = String(body?.email ?? '').trim().toLowerCase()
          if (admin.inviteConflict || admin.users.some((u) => u.email === address)) {
            return respond({ detail: admin.inviteConflict ?? 'That email already has an account' }, 409)
          }
          const invitation: Invitation = {
            id: `inv-${admin.invitations.length + 1}`,
            email: address,
            created_at: '2026-11-10T09:00:00Z',
            expires_at: '2026-11-17T09:00:00Z',
          }
          admin.invitations = [...admin.invitations.filter((i) => i.email !== address), invitation]
          admin.inviteTokens[`token-${address}`] = address
          return respond(admin.inviteUrl ? { ...invitation, invite_url: admin.inviteUrl } : invitation, 201)
        }
        const invitationMatch = url.match(/^\/api\/admin\/invitations\/([^/]+)$/)
        if (invitationMatch && method === 'DELETE') {
          admin.invitations = admin.invitations.filter((i) => i.id !== invitationMatch[1])
          return respond(null, 204)
        }
        const disabledMatch = url.match(/^\/api\/admin\/users\/([^/]+)\/disabled$/)
        if (disabledMatch && method === 'PUT') {
          const found = admin.users.find((u) => u.id === disabledMatch[1])
          if (!found || found.role === 'admin') return respond({ detail: 'Not allowed' }, 422)
          found.disabled = Boolean(body?.disabled)
          return respond(found)
        }
        const userMatch = url.match(/^\/api\/admin\/users\/([^/]+)$/)
        if (userMatch && method === 'DELETE') {
          const found = admin.users.find((u) => u.id === userMatch[1])
          if (!found || found.role === 'admin') return respond({ detail: 'Not allowed' }, 422)
          if (body?.confirm_email !== found.email) return respond({ detail: 'Type the email to confirm' }, 422)
          admin.users = admin.users.filter((u) => u.id !== found.id)
          return respond(null, 204)
        }
        return respond({ detail: 'Not found' }, 404)
      }

      if (url === '/api/settings/sign-in' && method === 'GET') return respond(signInOut())
      const signInMatch = url.match(/^\/api\/settings\/sign-in\/(github|google)$/)
      if (signInMatch) {
        const name = signInMatch[1] as OAuthProvider
        if (method === 'PUT') {
          if (state.signIn.saveError) return respond({ detail: state.signIn.saveError }, 422)
          const clientId = String(body?.client_id ?? '').trim()
          const kept = state.signIn.app[name]?.secret ?? ''
          const secret = String(body?.client_secret ?? kept)
          if (!clientId || clientId.length > 200 || !secret) {
            return respond({ detail: 'Enter a Client ID and a Client secret (at most 200 characters)' }, 422)
          }
          state.signIn.app[name] = { client_id: clientId, secret }
        } else if (method === 'DELETE') {
          // Like the backend: 204 without a body.
          state.signIn.app[name] = null
          return respond(null, 204)
        }
        return respond(signInOut())
      }

      if (url === '/api/data/restore' && method === 'POST') {
        const form = init?.body instanceof FormData ? init.body : null
        const file = form?.get('file')
        if (!(file instanceof File) || form?.get('confirm') !== 'REPLACE') {
          return respond({ detail: 'Type REPLACE to confirm' }, 422)
        }
        state.data.restored.push({ name: file.name, confirm: String(form.get('confirm')) })
        const answer = state.data.restore
        return 'status' in answer ? respond({ detail: answer.detail }, answer.status) : respond(answer)
      }
      if (url === '/api/data/sync' && method === 'POST') {
        const answer = state.data.sync
        return 'status' in answer ? respond({ detail: answer.detail }, answer.status) : respond(answer)
      }
      if (url === '/api/data/sync-key') {
        if (method === 'POST') {
          state.data.syncKey = { key: 'sync-key-abc123', expires_at: '2026-11-10T12:00:00Z' }
          return respond(state.data.syncKey, 201)
        }
        if (method === 'DELETE') {
          state.data.syncKey = null
          return respond(null, 204)
        }
        return respond({ active: !!state.data.syncKey, expires_at: state.data.syncKey?.expires_at ?? null })
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
      if (url === '/api/lessons/extract-pdf' && method === 'POST') {
        const file = init?.body instanceof FormData ? init.body.get('file') : null
        if (!(file instanceof File)) return respond({ detail: [{ msg: 'Field required' }] }, 422)
        const answer = await state.extractPdf(file)
        return 'status' in answer ? respond({ detail: answer.detail }, answer.status) : respond(answer)
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
      if (url === '/api/resources/sync' && method === 'POST') {
        const domain = String(body?.domain)
        if (!state.resourceMappings.includes(domain)) {
          return respond({ detail: `no resource mapping for domain '${domain}'` }, 404)
        }
        if (state.syncJobs[domain]?.state !== 'running') {
          state.syncJobs[domain] = {
            ...idleJob(domain),
            state: 'running',
            commit: 'abc1234',
            started_at: '2026-11-08T09:30:00Z',
          }
          pollsLeft[domain] = state.syncPolls
        }
        return respond(state.syncJobs[domain], 202)
      }
      const syncStatus = url.match(/^\/api\/resources\/sync\/([^/]+)$/)
      if (syncStatus) {
        const domain = syncStatus[1]
        // Like the backend: a roadmap without a mapping is 'unavailable' (200, no console error).
        if (!state.resourceMappings.includes(domain)) return respond({ ...idleJob(domain), state: 'unavailable' })
        if (state.syncJobs[domain]?.state === 'running') {
          pollsLeft[domain] = (pollsLeft[domain] ?? 1) - 1
          if (pollsLeft[domain] <= 0) finishSync(domain)
        }
        return respond(state.syncJobs[domain] ?? idleJob(domain))
      }
      if (url === '/api/news/refresh') {
        if (method === 'POST') {
          if (state.newsJob.state !== 'running') {
            state.newsJob = {
              state: 'running',
              started_at: '2026-11-08T10:00:00Z',
              finished_at: null,
              error: null,
              sources: state.newsSources.map((src) => ({ id: src.id, name: src.name, ok: null, items: null, error: null })),
            }
            newsPollsLeft = state.newsRefreshPolls
          }
          return respond(state.newsJob, 202)
        }
        if (state.newsJob.state === 'running') {
          newsPollsLeft -= 1
          if (newsPollsLeft <= 0) finishNewsRefresh()
        }
        return respond(state.newsJob)
      }
      if (url === '/api/news' || url.startsWith('/api/news?')) {
        const params = new URL(url, 'http://fake.test').searchParams
        const source = params.get('source')
        const q = (params.get('q') ?? '').trim().toLowerCase()
        const before = params.get('before')
        const limit = Number(params.get('limit') ?? 50)
        const items = state.news
          .filter((n) => !source || n.source === source)
          .filter((n) => !q || n.title.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q))
          .filter((n) => !before || Date.parse(n.published_at) < Date.parse(before))
          .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
          .slice(0, limit)
        return respond({
          items,
          sources: state.newsSources.map((src) => ({
            ...src,
            count: state.news.filter((n) => n.source === src.id).length,
            last_ok: null,
            last_error: null,
            last_fetched_at: null,
          })),
          last_refresh_at: state.newsLastRefreshAt,
          stale: state.newsStale,
        })
      }
      const resources = url.match(/^\/api\/resources\/([^/]+)\/([^/]+)$/)
      if (resources) {
        const fullId = `${resources[1]}/${resources[2]}`
        if (!roadmaps[resources[1]]?.nodes.some((n) => n.full_id === fullId)) {
          return respond({ detail: `unknown node '${fullId}'` }, 404)
        }
        const items = state.resources[fullId] ?? []
        return respond({
          node_id: fullId,
          source: 'roadmap.sh',
          commit: items.length ? 'abc1234' : null,
          synced_at: items.length ? state.resourcesSyncedAt : null,
          source_url: `https://roadmap.sh/${resources[1]}`,
          items,
        })
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
      const settingsMatch = url.match(/^\/api\/agents\/([^/]+)\/settings$/)
      if (settingsMatch && method === 'PUT') {
        const def = AGENT_DEFS.find((d) => d.id === settingsMatch[1])
        if (!def) return respond({ detail: 'unknown agent' }, 404)
        state.webSearch[def.id] = Boolean(body.web_search)
        return respond(agentOut(def))
      }
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
