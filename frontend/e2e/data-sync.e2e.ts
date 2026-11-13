/**
 * End-to-end checks for Settings > Data & sync (spec: openspec/changes/sign-in-setup-and-sync/specs/data-sync).
 * Black box: the browser, the public API and the downloaded archive.
 *
 * Restore and sync replace the notes, lessons, links, provider settings and agent settings on
 * the e2e server. Every restore here puts back a backup taken from this same server a moment
 * before, so later files find the same notes and lessons. Providers come back without a key;
 * earlier files remove their providers when they finish, so only the provider made here is in
 * the backup, and afterAll deletes it. The sync is sent to the e2e backend itself.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { crc32, inflateRawSync } from 'node:zlib'
import { OWNER } from '../playwright.config.ts'

const API = 'http://127.0.0.1:8001'
const APP = 'http://127.0.0.1:5174'
const H = { 'X-LearningHub': '1' }
const SIGNED_OUT = { cookies: [], origins: [] }
const PROVIDER_KEY = 'sk-e2e-sync-provider-KEY-5150'
const PROVIDER_NAME = `Sync OpenAI ${Date.now().toString(36)}`
const PROVIDER_MODEL = 'gpt-e2e-sync'
const WRONG_KEY = 'the sync key is wrong or expired'
/** Every note this file imports starts with this; afterAll deletes them (lesson-pdf expects no notes). */
const NOTE_PREFIX = 'Data sync e2e'

let providerId: string | null = null
/** The backup downloaded in the first test, used by the restore test. */
let backup: Buffer | null = null

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

// --- a small zip reader and writer (central directory; stored or deflated entries)

function unzip(zip: Buffer): Map<string, Buffer> {
  let end = zip.length - 22
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--
  if (end < 0) throw new Error('not a zip archive')
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const out = new Map<string, Buffer>()
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('bad central directory')
    const method = zip.readUInt16LE(at + 10)
    const size = zip.readUInt32LE(at + 20)
    const nameLen = zip.readUInt16LE(at + 28)
    const extraLen = zip.readUInt16LE(at + 30)
    const commentLen = zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLen).toString('utf-8')
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const raw = zip.subarray(start, start + size)
    out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw))
    at += 46 + nameLen + extraLen + commentLen
  }
  return out
}

function zipOf(entries: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, value] of Object.entries(entries)) {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf-8')
    const nameBytes = Buffer.from(name, 'utf-8')
    const crc = crc32(data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(data.length, 18)
    head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(nameBytes.length, 26)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(data.length, 20)
    dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(nameBytes.length, 28)
    dir.writeUInt32LE(offset, 42)
    locals.push(head, nameBytes, data)
    central.push(dir, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const dirBytes = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(entries).length, 8)
  end.writeUInt16LE(Object.keys(entries).length, 10)
  end.writeUInt32LE(dirBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dirBytes, end])
}

// --- helpers

/** Every note id on the server, archived ones too. */
async function noteIdsOn(request: APIRequestContext): Promise<{ noteIds: string[] }> {
  const notes = (await (await request.get(`${API}/api/notes`)).json()) as { id: string }[]
  const archived = (await (await request.get(`${API}/api/notes?archived=true`)).json()) as { id: string }[]
  return { noteIds: [...notes, ...archived].map((n) => n.id).sort() }
}

/**
 * Every note on the server (archived ones too) as "title | node | archived", sorted. A restore or
 * a sync gives the notes new ids (multi-user design: restoring into another user or server never
 * collides with someone else's ids), so the data after one is compared by content, not by id.
 */
async function noteKeysOn(request: APIRequestContext): Promise<string[]> {
  type N = { title: string; node_id: string | null }
  const notes = (await (await request.get(`${API}/api/notes`)).json()) as N[]
  const archived = (await (await request.get(`${API}/api/notes?archived=true`)).json()) as N[]
  return [
    ...notes.map((n) => `${n.title} | ${n.node_id ?? '-'} | active`),
    ...archived.map((n) => `${n.title} | ${n.node_id ?? '-'} | archived`),
  ].sort()
}

async function noteIdByTitle(request: APIRequestContext, title: string): Promise<string> {
  const notes = (await (await request.get(`${API}/api/notes`)).json()) as { id: string; title: string }[]
  const note = notes.find((n) => n.title === title)
  expect(note, `note ${title}`).toBeTruthy()
  return note!.id
}

async function importExtraNote(request: APIRequestContext, title: string): Promise<string> {
  const html = `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>Replaced by a restore.</p></body></html>`
  const res = await request.post(`${API}/api/notes/import`, {
    headers: H,
    multipart: { files: { name: `${title.replace(/\W+/g, '-')}.html`, mimeType: 'text/html', buffer: Buffer.from(html) } },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  const notes = (await (await request.get(`${API}/api/notes`)).json()) as { id: string; title: string }[]
  const note = notes.find((n) => n.title === title)
  expect(note, `imported note ${title}`).toBeTruthy()
  return note!.id
}

function dataCard(page: Page, name: 'Backup' | 'Restore' | 'Receive' | 'Send') {
  return page.getByRole('article', { name })
}

/** Restores through the part routes (start, one 1 MB part at a time, finish) and answers the finish call. */
async function restoreThroughApi(request: APIRequestContext, file: Buffer, confirm = 'REPLACE') {
  const started = await request.post(`${API}/api/data/restore/upload`, { headers: H })
  expect(started.ok(), await started.text()).toBeTruthy()
  const { upload_id } = (await started.json()) as { upload_id: string }
  const size = 1024 * 1024
  const parts = Math.max(1, Math.ceil(file.length / size))
  for (let i = 0; i < parts; i++) {
    const put = await request.put(`${API}/api/data/restore/upload/${upload_id}/${i}`, {
      headers: { ...H, 'Content-Type': 'application/octet-stream' },
      data: file.subarray(i * size, (i + 1) * size),
    })
    expect(put.ok(), await put.text()).toBeTruthy()
  }
  return request.post(`${API}/api/data/restore/upload/${upload_id}/finish`, {
    headers: H,
    data: { parts, sha256: createHash('sha256').update(file).digest('hex'), confirm },
  })
}

test.describe('Data & sync', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ playwright }) => {
    const { OWNER_STATE } = await import('../playwright.config.ts')
    const ctx = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
    // A provider with a key (inactive, so no agent picks it): the backup holds its name and model, never the key.
    const res = await ctx.post(`${API}/api/ai-providers`, {
      headers: H,
      data: {
        name: PROVIDER_NAME,
        provider_type: 'openai',
        model_name: PROVIDER_MODEL,
        api_key: PROVIDER_KEY,
        is_active: false,
        config: {},
      },
    })
    expect(res.status(), await res.text()).toBe(201)
    providerId = (await res.json()).id
    // At least one note with its file, whatever the earlier files left.
    await importExtraNote(ctx, `${NOTE_PREFIX} baseline ${Date.now().toString(36)}`)
    await ctx.dispose()
  })

  test.afterAll(async ({ playwright }) => {
    const { OWNER_STATE } = await import('../playwright.config.ts')
    const ctx = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
    await ctx.delete(`${API}/api/data/sync-key`, { headers: H })
    const list = (await (await ctx.get(`${API}/api/ai-providers`)).json()) as { id: string; name: string }[]
    for (const p of list) if (p.name === PROVIDER_NAME) await ctx.delete(`${API}/api/ai-providers/${p.id}`, { headers: H })
    for (const archived of [false, true]) {
      const notes = (await (await ctx.get(`${API}/api/notes${archived ? '?archived=true' : ''}`)).json()) as {
        id: string
        title: string
      }[]
      for (const n of notes) if (n.title.startsWith(NOTE_PREFIX)) await ctx.delete(`${API}/api/notes/${n.id}`, { headers: H })
    }
    await ctx.dispose()
  })

  test('the Settings nav reaches Data & sync; Download backup holds the data and no key, token or password', async ({
    page,
    request,
  }) => {
    await page.goto('/#/settings')
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Data & sync' }).click()
    await expect(page).toHaveURL(/#\/settings\/data$/)
    await expect(page.getByRole('heading', { name: 'Data & sync', level: 1 })).toBeVisible()

    const downloading = page.waitForEvent('download')
    await dataCard(page, 'Backup').getByRole('link', { name: 'Download backup' }).click()
    const download = await downloading
    expect(download.suggestedFilename()).toMatch(/^learninghub-backup-\d{8}-\d{6}\.zip$/)
    backup = readFileSync(await download.path())
    const entries = unzip(backup)

    expect(entries.has('manifest.json')).toBe(true)
    for (const name of ['notes', 'lessons', 'ai_providers', 'agent_providers', 'agent_settings']) {
      expect(entries.has(`data/${name}.json`), `data/${name}.json`).toBe(true)
    }
    const manifest = JSON.parse(entries.get('manifest.json')!.toString('utf-8'))
    expect(manifest.format).toBe(1)
    expect(typeof manifest.app_version).toBe('string')
    expect(manifest.migration).toMatch(/\S/)

    // The notes with their files.
    const notes = JSON.parse(entries.get('data/notes.json')!.toString('utf-8')) as Record<string, unknown>[]
    const { noteIds } = await noteIdsOn(request)
    expect(notes.map((n) => String(n.id)).sort()).toEqual(noteIds)
    expect(manifest.counts.notes).toBe(notes.length)
    const files = [...entries.keys()].filter((n) => n.startsWith('files/'))
    expect(files.length).toBeGreaterThan(0)
    for (const name of files) expect(name).toMatch(/^files\/blobs\/[0-9a-f]{2}\/[0-9a-f]{64}\.[a-z]+$/)
    expect(manifest.counts.files).toBe(files.length)
    const lessons = JSON.parse(entries.get('data/lessons.json')!.toString('utf-8')) as unknown[]
    expect(manifest.counts.lessons).toBe(lessons.length)

    // The provider's name and model, never its key.
    const providers = JSON.parse(entries.get('data/ai_providers.json')!.toString('utf-8')) as Record<string, unknown>[]
    const mine = providers.find((p) => p.name === PROVIDER_NAME)
    expect(mine).toMatchObject({ provider_type: 'openai', model_name: PROVIDER_MODEL })
    for (const field of ['api_key', 'api_key_enc', 'key_hint']) expect(mine).not.toHaveProperty(field)
    for (const [name, data] of entries) {
      const text = data.toString('latin1')
      for (const secret of [PROVIDER_KEY, PROVIDER_KEY.slice(-4) + '"', OWNER.password, 'e2e-github-secret']) {
        expect(text.includes(secret), `${secret} in ${name}`).toBe(false)
      }
      expect(text.includes(OWNER.email), `the account's email in ${name}`).toBe(false)
    }
    // No accounts and no login sessions; the chat history is the only entry with "sessions" in its name.
    expect(entries.has('data/chat_sessions.json')).toBe(true)
    const allNames = [...entries.keys()].filter((n) => n !== 'data/chat_sessions.json').join('\n')
    expect(allNames).not.toMatch(/session|token|user|account|app_settings|sync_key/i)

    // The API answers the same archive kind, and only with a session.
    const viaApi = await request.get(`${API}/api/data/backup`)
    expect(viaApi.status()).toBe(200)
    expect(viaApi.headers()['content-type']).toContain('application/zip')
  })

  test('Restore: needs a file and exactly REPLACE, replaces the data and names the providers needing a key', async ({
    page,
    request,
  }) => {
    expect(backup, 'the backup of the first test').not.toBeNull()
    // A note written after the backup: the restore removes it (scenario: Restore replaces the data).
    const before = await noteKeysOn(request)
    const extraTitle = `${NOTE_PREFIX} after the backup ${Date.now().toString(36)}`
    const extraId = await importExtraNote(request, extraTitle)

    await page.goto('/#/settings/data')
    const restore = dataCard(page, 'Restore')
    const button = restore.getByRole('button', { name: 'Restore' })
    await expect(button).toBeDisabled()
    await restore.getByLabel('Type REPLACE to confirm').fill('REPLACE')
    await expect(button).toBeDisabled()
    await restore.getByLabel('Backup file').setInputFiles({
      name: 'learninghub-backup.zip',
      mimeType: 'application/zip',
      buffer: backup!,
    })
    await expect(button).toBeEnabled()
    for (const wrong of ['replace', 'REPLACE ', 'REPLAC']) {
      await restore.getByLabel('Type REPLACE to confirm').fill(wrong)
      await expect(button).toBeDisabled()
    }
    await restore.getByLabel('Type REPLACE to confirm').fill('REPLACE')
    await button.click()

    const result = restore.getByRole('status')
    await expect(result).toContainText(/Restored: \d+ notes, \d+ files, \d+ lessons, \d+ providers\./, {
      timeout: 20_000,
    })
    await expect(result).toContainText(`Enter the key again for: ${PROVIDER_NAME}`)
    await expect(result.getByRole('link', { name: 'Open AI providers' })).toHaveAttribute('href', '#/settings')

    const after = await noteKeysOn(request)
    expect(after).toEqual(before)
    expect(after.some((k) => k.startsWith(`${extraTitle} |`))).toBe(false)
    expect((await request.get(`${API}/api/notes/${extraId}`)).status()).toBe(404)

    // Scenario: Provider keys entered again: listed on AI providers and marked as needing its key.
    const providers = (await (await request.get(`${API}/api/ai-providers`)).json()) as {
      id: string
      name: string
      has_key: boolean
    }[]
    const mine = providers.find((p) => p.name === PROVIDER_NAME)
    // Restored under a new id (multi-user: restore gives providers new ids), without its key.
    expect(mine).toMatchObject({ has_key: false })
    expect(mine!.id).not.toBe(providerId)
    expect(providers.filter((p) => p.name === PROVIDER_NAME)).toHaveLength(1)
    await result.getByRole('link', { name: 'Open AI providers' }).click()
    const card = page.getByRole('article', { name: PROVIDER_NAME })
    await expect(card).toBeVisible()
    await expect(card).toContainText(PROVIDER_MODEL)
    await expect(card).toContainText(/key/i)
  })

  test('Restore refuses a missing REPLACE, a non-backup and an unsafe archive without changing anything', async ({
    request,
  }) => {
    expect(backup).not.toBeNull()
    const before = (await noteIdsOn(request)).noteIds

    const unconfirmed = await restoreThroughApi(request, backup!, '')
    expect(unconfirmed.status()).toBe(422)
    expect(JSON.stringify(await unconfirmed.json())).toContain('REPLACE')

    // Scenario: Unsafe archive refused.
    const manifest = unzip(backup!).get('manifest.json')!
    const evil = await restoreThroughApi(request, zipOf({ 'manifest.json': manifest, '../evil.txt': 'evil' }))
    expect(evil.status()).toBe(422)
    expect((await evil.json()).detail).toContain('unsafe entry name')

    const notZip = await restoreThroughApi(request, Buffer.from('not a zip at all'))
    expect(notZip.status()).toBe(422)
    expect((await notZip.json()).detail).toBe('the file is not a zip archive')

    expect((await noteIdsOn(request)).noteIds).toEqual(before)
  })

  test('Sync: a key shown once, Send to the e2e backend itself, a wrong key, a refused address, Revoke', async ({
    page,
    request,
    playwright,
  }) => {
    test.slow()
    await page.goto('/#/settings/data')
    const receive = dataCard(page, 'Receive')
    await expect(receive.getByText('No sync key is active.')).toBeVisible()
    await expect(receive.getByRole('button', { name: 'Revoke' })).toHaveCount(0)

    // Create sync key: shown once, with its expiry.
    await receive.getByRole('button', { name: 'Create sync key' }).click()
    const keyField = receive.getByLabel('Sync key')
    await expect(keyField).toHaveValue(/^[A-Za-z0-9_-]{40,}$/)
    const key = await keyField.inputValue()
    await expect(receive.getByText('Shown once. Copy it now.')).toBeVisible()
    await expect(receive.getByText(/^Valid until .+; creating a new key replaces this one\.$/)).toBeVisible()
    const status = await (await request.get(`${API}/api/data/sync-key`)).json()
    expect(status.active).toBe(true)
    const hours = (Date.parse(status.expires_at) - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(23.5)
    expect(hours).toBeLessThanOrEqual(24.01)
    expect(JSON.stringify(status)).not.toContain(key)

    // After a reload only "active until" is left; the key is never shown again.
    await page.reload()
    await expect(receive.getByText(/^A sync key is active until .+\.$/)).toBeVisible()
    await expect(receive.getByLabel('Sync key')).toHaveCount(0)
    await expect(page.getByText(key)).toHaveCount(0)

    // Scenario: Key works only for uploads.
    const bearer = await playwright.request.newContext({ baseURL: APP, storageState: SIGNED_OUT })
    try {
      const notes = await bearer.get(`${API}/api/notes`, { headers: { Authorization: `Bearer ${key}` } })
      expect(notes.status()).toBe(401)
      const backupWithKey = await bearer.get(`${API}/api/data/backup`, { headers: { Authorization: `Bearer ${key}` } })
      expect(backupWithKey.status()).toBe(401)
    } finally {
      await bearer.dispose()
    }

    const before = await noteKeysOn(request)
    const lessonsBefore = unzip(Buffer.from(await (await request.get(`${API}/api/data/backup`)).body())).get(
      'data/lessons.json',
    )!
    const send = dataCard(page, 'Send')
    const sendButton = send.getByRole('button', { name: 'Send' })
    await expect(sendButton).toBeDisabled()

    // Scenario: Wrong key: the target answers 401 and changes nothing.
    await send.getByLabel('Target address').fill('http://127.0.0.1:8001')
    await send.getByLabel('Sync key').fill(`${key.slice(0, -4)}AAAA`)
    await sendButton.click()
    await expect(send.getByRole('alert')).toHaveText(WRONG_KEY, { timeout: 30_000 })
    await expect(send.getByLabel('Sync key')).toHaveValue('')

    // An address that is neither https nor localhost is refused before anything is sent.
    await send.getByLabel('Target address').fill('http://example.com')
    await send.getByLabel('Sync key').fill(key)
    await sendButton.click()
    await expect(send.getByRole('alert')).toHaveText('the target address must be https (http only on localhost)')
    const refused = await request.post(`${API}/api/data/sync`, {
      headers: H,
      data: { target_url: 'http://example.com', key },
    })
    expect(refused.status()).toBe(422)

    // Scenario: Send Local to Deploy, here to the e2e backend itself.
    const sentTitle = `${NOTE_PREFIX} sent by sync ${Date.now().toString(36)}`
    await importExtraNote(request, sentTitle)
    await send.getByLabel('Target address').fill('http://127.0.0.1:8001')
    await send.getByLabel('Sync key').fill(key)
    await sendButton.click()
    await expect(send.getByText(/Sending/)).toBeVisible()
    const sent = send.getByRole('status')
    await expect(sent).toContainText(/Sent: \d+ notes, \d+ files, \d+ lessons, \d+ providers\./, { timeout: 60_000 })
    await expect(sent).toContainText(`Enter the key again for: ${PROVIDER_NAME}`)
    await expect(send.getByLabel('Sync key')).toHaveValue('')
    const sentNotes = Number((await sent.textContent())!.match(/Sent: (\d+) notes/)![1])
    // The sync replaced this user's data with the same content (new ids, see noteKeysOn).
    const after = await noteKeysOn(request)
    expect(after).toEqual([...before, `${sentTitle} | - | active`].sort())
    expect(sentNotes).toBe(after.length)
    const extraId = await noteIdByTitle(request, sentTitle)
    const lessonsAfter = unzip(Buffer.from(await (await request.get(`${API}/api/data/backup`)).body())).get(
      'data/lessons.json',
    )!
    expect(JSON.parse(lessonsAfter.toString('utf-8'))).toEqual(JSON.parse(lessonsBefore.toString('utf-8')))
    // The note's file came across too: its original opens.
    expect((await request.get(`${API}/api/notes/${extraId}/original`)).status()).toBe(200)
    await sent.scrollIntoViewIfNeeded()
    await shot(page, 'data-sync')

    // Revoke: the key no longer works.
    page.once('dialog', (dialog) => void dialog.accept())
    await receive.getByRole('button', { name: 'Revoke' }).click()
    await expect(receive.getByText('No sync key is active.')).toBeVisible()
    expect((await (await request.get(`${API}/api/data/sync-key`)).json()).active).toBe(false)
    const revoked = await request.post(`${API}/api/data/sync`, {
      headers: H,
      data: { target_url: 'http://127.0.0.1:8001', key },
    })
    expect(revoked.status()).toBe(502)
    expect((await revoked.json()).detail).toBe(WRONG_KEY)
    expect(await noteKeysOn(request)).toEqual(after)
  })

  test('Without a session the data routes answer 401', async ({ playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: APP, storageState: SIGNED_OUT })
    try {
      expect((await anon.get(`${API}/api/data/backup`)).status()).toBe(401)
      expect((await anon.get(`${API}/api/data/sync-key`)).status()).toBe(401)
      expect((await anon.post(`${API}/api/data/sync-key`, { headers: H })).status()).toBe(401)
      const restore = await anon.post(`${API}/api/data/restore/upload`, { headers: H })
      expect(restore.status()).toBe(401)
      // An upload without a sync key is refused too.
      expect((await anon.post(`${API}/api/data/upload`, { headers: H })).status()).toBe(401)
    } finally {
      await anon.dispose()
    }
  })
})

