import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { E2E_ENV } from '../playwright.config'

/** Start every run from an empty e2e database and storage folder. */
export default function globalSetup() {
  const backendDir = resolve(import.meta.dirname, '../../backend')
  const alembic = join(backendDir, '.venv', 'Scripts', 'alembic')
  const env = { ...process.env, ...E2E_ENV }
  for (const target of [['downgrade', 'base'], ['upgrade', 'head']]) {
    execFileSync(alembic, target, { cwd: backendDir, env, stdio: 'pipe' })
  }
  rmSync(E2E_ENV.LH_STORAGE_DIR, { recursive: true, force: true })
  rmSync(resolve(import.meta.dirname, '../e2e-results/screens'), { recursive: true, force: true })
  mkdirSync(resolve(import.meta.dirname, '../e2e-results/screens'), { recursive: true })
}
