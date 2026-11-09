import { defineConfig } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// The UI checks run against their own backend (port 8001), database (learninghub_e2e)
// and storage folder, and their own Vite server (port 5174), never the dev ones.
const backendDir = resolve(import.meta.dirname, '../backend')
// The backend venv's programs: .venv/Scripts on Windows, .venv/bin elsewhere (CI on Linux).
export const venvBin = (name: string) => join(backendDir, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', name)
const python = venvBin('python')
export const E2E_ENV = {
  LH_DATABASE_URL: 'postgresql+psycopg://learninghub:learninghub@localhost:5434/learninghub_e2e',
  LH_STORAGE_DIR: join(tmpdir(), 'learninghub-e2e-storage'),
  // No agent provider, whatever backend/.env says: the checks must not call a paid API.
  LH_ANTHROPIC_API_KEY: '',
  LH_OPENAI_API_KEY: '',
  LH_DEEPSEEK_API_KEY: '',
  // The suite sends many agent requests in a row (more than 20 a minute on a fast CI runner);
  // the limit itself is covered by the backend tests.
  LH_AGENT_RATE_PER_MINUTE: '1000',
  LH_OLLAMA_URL: '',
  // The Claude Code provider runs this fake `claude` (a .py path runs with the backend's Python).
  LH_CLAUDE_BIN: join(import.meta.dirname, 'e2e', 'fake_claude.py'),
  // The reference sync reads a synthetic source on the fake server, never GitHub or roadmap.sh.
  LH_ROADMAP_API_BASE: 'http://127.0.0.1:8002/roadmap-api',
  LH_ROADMAP_RAW_BASE: 'http://127.0.0.1:8002/roadmap-raw',
  // The news feeds of the e2e run sit on a loopback address, which the safe fetch refuses
  // before connecting: a refresh never reads a real feed.
  LH_NEWS_SOURCES_FILE: join(import.meta.dirname, 'e2e', 'news-sources.e2e.yaml'),
  // The login is on, as in real use. Links in emails and OAuth redirects point at the e2e Vite.
  LH_AUTH_REQUIRED: 'true',
  LH_PUBLIC_URL: 'http://127.0.0.1:5174',
  // GitHub sign-in goes to the fake provider on the fake server; Google stays unconfigured.
  LH_GITHUB_CLIENT_ID: 'e2e-github-client',
  LH_GITHUB_CLIENT_SECRET: 'e2e-github-secret',
  LH_GITHUB_AUTHORIZE_URL: 'http://127.0.0.1:8002/oauth/github/authorize',
  LH_GITHUB_TOKEN_URL: 'http://127.0.0.1:8002/oauth/github/token',
  LH_GITHUB_API_BASE: 'http://127.0.0.1:8002/github-api',
  LH_GOOGLE_CLIENT_ID: '',
  LH_GOOGLE_CLIENT_SECRET: '',
  // No SMTP: emails land in <storage>/outbox, where the tests read the links.
  LH_SMTP_HOST: '',
}

/** The Owner the setup project creates; every other test runs signed in as this account. */
export const OWNER = { email: 'owner@example.test', password: 'e2e-owner-password-1', name: 'E2E Owner' }
export const OWNER_STATE = join(import.meta.dirname, 'e2e-results', '.auth', 'owner.json')

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.e2e.ts',
  outputDir: './e2e-results/artifacts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  projects: [
    // Creates the Owner and saves its session before any other test runs.
    { name: 'setup', testMatch: 'owner.setup.ts' },
    { name: 'app', dependencies: ['setup'], use: { storageState: OWNER_STATE } },
  ],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `"${python}" -m uvicorn app.main:app --port 8001`,
      cwd: backendDir,
      env: E2E_ENV,
      url: 'http://127.0.0.1:8001/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm run dev -- --port 5174 --strictPort --host 127.0.0.1',
      env: { LH_API_URL: 'http://127.0.0.1:8001' },
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Fake OpenAI-compatible LLM for the provider tests (local providers point at it).
      command: `"${python}" -m uvicorn fake_llm:app --port 8002 --app-dir e2e`,
      url: 'http://127.0.0.1:8002/v1/models',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
