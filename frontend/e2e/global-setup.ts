import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { E2E_ENV, venvBin } from '../playwright.config.ts'

/** Start every run from an empty e2e database and storage folder. */
export default function globalSetup() {
  const backendDir = resolve(import.meta.dirname, '../../backend')
  const alembic = venvBin('alembic')
  const env = { ...process.env, ...E2E_ENV }
  // Accounts left by an earlier run (open sign-up makes members) would block the downgrade, which
  // refuses to merge several users' data. This is the e2e database only (LH_DATABASE_URL of E2E_ENV).
  const clearUsers = [
    'import os, sqlalchemy as sa',
    "e = sa.create_engine(os.environ['LH_DATABASE_URL'])",
    'with e.begin() as c:',
    "    if sa.inspect(c).has_table('users'): c.execute(sa.text('TRUNCATE users CASCADE'))",
  ].join(String.fromCharCode(10))
  execFileSync(venvBin('python'), ['-c', clearUsers], { cwd: backendDir, env, stdio: 'pipe' })
  for (const target of [['downgrade', 'base'], ['upgrade', 'head']]) {
    execFileSync(alembic, target, { cwd: backendDir, env, stdio: 'pipe' })
  }
  rmSync(E2E_ENV.LH_STORAGE_DIR, { recursive: true, force: true })
  rmSync(resolve(import.meta.dirname, '../e2e-results/screens'), { recursive: true, force: true })
  mkdirSync(resolve(import.meta.dirname, '../e2e-results/screens'), { recursive: true })
}
