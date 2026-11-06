import { defineConfig } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// The UI checks run against their own backend (port 8001), database (learninghub_e2e)
// and storage folder, and their own Vite server (port 5174), never the dev ones.
const backendDir = resolve(import.meta.dirname, '../backend')
const python = join(backendDir, '.venv', 'Scripts', 'python')
export const E2E_ENV = {
  LH_DATABASE_URL: 'postgresql+psycopg://learninghub:learninghub@localhost:5434/learninghub_e2e',
  LH_STORAGE_DIR: join(tmpdir(), 'learninghub-e2e-storage'),
}

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
  ],
})
