/**
 * End-to-end checks for the change vercel-deploy (specs: data-sync, knowledge-import, auth, delivery).
 * Black box: the browser and the public API. Only the scenarios that run without Vercel are here
 * (parts upload, browser-side upload limit, stored sign-ins, streamed big answers).
 *
 * Every note this file imports starts with NOTE_PREFIX; afterAll deletes them (other files expect
 * no leftover notes). The restore here puts back a backup taken from this server a moment before.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { OWNER_STATE } from '../playwright.config.ts'

const API = 'http://127.0.0.1:8001'
const APP = 'http://127.0.0.1:5174'
const FAKE = 'http://127.0.0.1:8002'
const H = { 'X-LearningHub': '1' }
const SIGNED_OUT = { cookies: [], origins: [] }
const MB = 1024 * 1024
const NOTE_PREFIX = 'Vercel deploy e2e'
const RUN = Date.now().toString(36)

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

/** An HTML file of about `bytes` bytes; the filler is random, so it neither compresses nor repeats. */
function htmlOf(title: string, bytes: number): Buffer {
  const filler = randomBytes(Math.floor((bytes * 3) / 4)).toString('base64')
  return Buffer.from(`<!doctype html><html><head><title>${title}</title></head><body><h1 id="big-title">${title}</h1><!-- ${filler} --></body></html>`)
}

async function noteTitles(request: APIRequestContext): Promise<{ id: string; title: string }[]> {
  const a = (await (await request.get(`${API}/api/notes`)).json()) as { id: string; title: string }[]
  const b = (await (await request.get(`${API}/api/notes?archived=true`)).json()) as { id: string; title: string }[]
  return [...a, ...b]
}

async function importViaApi(request: APIRequestContext, title: string, bytes: number) {
  const res = await request.post(`${API}/api/notes/import`, {
    headers: H,
    multipart: { files: { name: `${title.replace(/\W+/g, '-')}.html`, mimeType: 'text/html', buffer: htmlOf(title, bytes) } },
    timeout: 60_000,
  })
  expect(res.ok(), await res.text()).toBeTruthy()
}

test.describe('vercel-deploy', () => {
  test.describe.configure({ mode: 'serial' })

  test.afterAll(async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
    await ctx.delete(`${API}/api/data/sync-key`, { headers: H })
    for (const n of await noteTitles(ctx)) {
      if (n.title.startsWith(NOTE_PREFIX)) await ctx.delete(`${API}/api/notes/${n.id}`, { headers: H })
    }
    await ctx.dispose()
  })

  test('Large answers are streamed: a note over 5 MB opens whole in the sandbox and the backup downloads as a valid zip', async ({
    page,
    request,
  }) => {
    test.slow()
    const title = `${NOTE_PREFIX} big ${RUN}`
    await importViaApi(request, title, 7 * MB)
    const note = (await noteTitles(request)).find((n) => n.title === title)!
    expect(note).toBeTruthy()

    const original = await request.get(`${API}/api/notes/${note.id}/original`, { timeout: 60_000 })
    expect(original.status()).toBe(200)
    expect(original.headers()['content-security-policy']).toContain('sandbox')
    const body = await original.body()
    expect(body.length).toBeGreaterThan(5 * MB)
    expect(body.subarray(body.length - 20).toString()).toContain('</html>')

    await page.goto(`/#/note/${note.id}`)
    const frame = page.frameLocator(`iframe[title="Original page: ${title}"]`)
    await expect(frame.locator('#big-title')).toHaveText(title, { timeout: 30_000 })
    await expect(page.locator('iframe.original')).toHaveAttribute('sandbox', 'allow-scripts')
    await shot(page, 'vercel-big-note')

    const backup = await request.get(`${API}/api/data/backup`, { timeout: 60_000 })
    expect(backup.status()).toBe(200)
    const zip = await backup.body()
    expect(zip.length).toBeGreaterThan(5 * MB)
    expect(zip.readUInt32LE(0)).toBe(0x04034b50)
    expect(zip.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true)
  })

  test('Restore from the browser in parts: parts of at most 4 MB, progress shown, counts shown; the button waits for REPLACE', async ({
    page,
    request,
  }) => {
    test.slow()
    const backup = Buffer.from(await (await request.get(`${API}/api/data/backup`, { timeout: 60_000 })).body())
    expect(backup.length).toBeGreaterThan(5 * MB)
    const before = (await noteTitles(request)).map((n) => n.title).sort()

    const parts: number[] = []
    let starts = 0
    let legacy = 0
    page.on('request', (r) => {
      const u = new URL(r.url())
      if (r.method() === 'PUT' && /\/api\/data\/restore\/upload\/[^/]+\/\d+$/.test(u.pathname)) {
        parts.push(r.postDataBuffer()?.length ?? 0)
      }
      if (r.method() === 'POST' && u.pathname === '/api/data/restore/upload') starts++
      if (r.method() === 'POST' && u.pathname === '/api/data/restore') legacy++
    })
    // Slow each part a little, so the progress line stays on screen long enough to be seen.
    await page.route('**/api/data/restore/upload/*/[0-9]*', async (route) => {
      await new Promise((r) => setTimeout(r, 700))
      await route.continue()
    })

    await page.goto('/#/settings/data')
    const restore = page.getByRole('article', { name: 'Restore' })
    const button = restore.getByRole('button', { name: 'Restore' })
    await restore.getByLabel('Backup file').setInputFiles({ name: 'big-backup.zip', mimeType: 'application/zip', buffer: backup })
    await expect(button).toBeDisabled()
    await restore.getByLabel('Type REPLACE to confirm').fill('REPLACE')
    await expect(button).toBeEnabled()
    await button.click()
    await expect(restore.getByText(/Uploading part \d+ of \d+/)).toBeVisible()
    await shot(page, 'vercel-restore-progress')

    const result = restore.getByRole('status')
    await expect(result).toContainText(/Restored: \d+ notes, \d+ files, \d+ lessons, \d+ providers\./, { timeout: 60_000 })
    await shot(page, 'vercel-restore-done')

    expect(starts).toBe(1)
    expect(legacy).toBe(0)
    expect(parts.length).toBe(Math.ceil(backup.length / (4 * MB)))
    expect(parts.length).toBeGreaterThanOrEqual(2)
    for (const size of parts) expect(size).toBeLessThanOrEqual(4 * MB)
    expect(parts.reduce((a, b) => a + b, 0)).toBe(backup.length)
    expect((await noteTitles(request)).map((n) => n.title).sort()).toEqual(before)
    // The old single-request route is gone.
    const old = await request.post(`${API}/api/data/restore`, {
      headers: H,
      multipart: { file: { name: 'b.zip', mimeType: 'application/zip', buffer: Buffer.from('x') }, confirm: 'REPLACE' },
    })
    expect([404, 405]).toContain(old.status())
  })

  test('Restore from the browser in parts: a wrong checksum or a missing REPLACE restores nothing and removes the upload; a sync key is refused with 401', async ({
    request,
    playwright,
  }) => {
    const backup = Buffer.from(await (await request.get(`${API}/api/data/backup`, { timeout: 60_000 })).body())
    const before = (await noteTitles(request)).map((n) => n.title).sort()
    const sha = createHash('sha256').update(backup).digest('hex')

    const start = async () => {
      const res = await request.post(`${API}/api/data/restore/upload`, { headers: H })
      expect(res.status(), await res.text()).toBeLessThan(300)
      return ((await res.json()) as { upload_id: string }).upload_id
    }
    const put = async (id: string, index: number, data: Buffer) =>
      request.put(`${API}/api/data/restore/upload/${id}/${index}`, { headers: { ...H, 'Content-Type': 'application/octet-stream' }, data })

    // Missing REPLACE: 422, nothing changes, the upload is gone.
    const a = await start()
    expect((await put(a, 0, backup)).ok()).toBeTruthy()
    const noConfirm = await request.post(`${API}/api/data/restore/upload/${a}/finish`, { headers: H, data: { parts: 1, sha256: sha, confirm: '' } })
    expect(noConfirm.status()).toBe(422)
    expect(JSON.stringify(await noConfirm.json())).toContain('REPLACE')
    expect((await put(a, 0, Buffer.from('x'))).status()).toBe(404)

    // Wrong checksum: refused.
    const b = await start()
    expect((await put(b, 0, backup)).ok()).toBeTruthy()
    const wrong = await request.post(`${API}/api/data/restore/upload/${b}/finish`, {
      headers: H,
      data: { parts: 1, sha256: '0'.repeat(64), confirm: 'REPLACE' },
    })
    expect(wrong.status()).toBeGreaterThanOrEqual(400)
    expect(wrong.status()).toBeLessThan(500)
    expect((await put(b, 0, Buffer.from('x'))).status()).toBe(404)
    expect((await noteTitles(request)).map((n) => n.title).sort()).toEqual(before)

    // Sync key: refused on every browser restore route.
    const keyRes = await request.post(`${API}/api/data/sync-key`, { headers: H })
    const key = ((await keyRes.json()) as { key: string }).key
    const c = await start()
    const bearer = await playwright.request.newContext({ baseURL: APP, storageState: SIGNED_OUT })
    try {
      const auth = { ...H, Authorization: `Bearer ${key}` }
      expect((await bearer.post(`${API}/api/data/restore/upload`, { headers: auth })).status()).toBe(401)
      expect(
        (await bearer.put(`${API}/api/data/restore/upload/${c}/0`, { headers: { ...auth, 'Content-Type': 'application/octet-stream' }, data: Buffer.from('x') })).status(),
      ).toBe(401)
      expect(
        (await bearer.post(`${API}/api/data/restore/upload/${c}/finish`, { headers: auth, data: { parts: 1, sha256: sha, confirm: 'REPLACE' } })).status(),
      ).toBe(401)
    } finally {
      await bearer.dispose()
    }
    await request.post(`${API}/api/data/restore/upload/${c}/finish`, { headers: H, data: { parts: 1, sha256: sha, confirm: '' } })
    expect((await noteTitles(request)).map((n) => n.title).sort()).toEqual(before)
  })

  test('Sync to another Learning Hub: a backup larger than 4 MB is sent in parts of at most 4 MB and restored whole', async ({
    page,
    request,
  }) => {
    test.slow()
    // The big note from the first test is still on the server, so the backup is over 4 MB.
    const created = await (await request.post(`${API}/api/data/sync-key`, { headers: H })).json()
    const key = (created as { key: string }).key
    const before = (await noteTitles(request)).map((n) => n.title).sort()
    const backup = await (await request.get(`${API}/api/data/backup`, { timeout: 60_000 })).body()
    expect(backup.length).toBeGreaterThan(5 * MB)

    // The target is this server itself; the part sizes are checked at the source by the backend tests.
    await page.goto('/#/settings/data')
    const send = page.getByRole('article', { name: 'Send' })
    await send.getByLabel('Target address').fill('http://127.0.0.1:8001')
    await send.getByLabel('Sync key').fill(key)
    await send.getByRole('button', { name: 'Send' }).click()
    const sent = send.getByRole('status')
    await expect(sent).toContainText(/Sent: \d+ notes, \d+ files, \d+ lessons, \d+ providers\./, { timeout: 90_000 })
    expect((await noteTitles(request)).map((n) => n.title).sort()).toEqual(before)
    await shot(page, 'vercel-sync-large')
  })

  test('Upload limit checked in the browser: three 3 MB files are sent in three requests and create three notes', async ({ page, request }) => {
    test.slow()
    const status = await (await request.get(`${API}/api/auth/status`)).json()
    expect(status.max_upload_bytes).toBeGreaterThan(0)

    const imports: number[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/notes/import') imports.push(r.postDataBuffer()?.length ?? 0)
    })
    const names = [1, 2, 3].map((i) => `${NOTE_PREFIX} multi ${i} ${RUN}`)
    await page.goto('/')
    await page.getByRole('button', { name: /^(Import|Import HTML or PDF files)$/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Import HTML or PDF files' })
    await dialog.getByLabel('HTML or PDF files').setInputFiles(
      names.map((n) => ({ name: `${n.replace(/\W+/g, '-')}.html`, mimeType: 'text/html', buffer: htmlOf(n, 3 * MB) })),
    )
    for (const n of names) await expect(dialog.getByText(`${n.replace(/\W+/g, '-')}.html`)).toBeVisible({ timeout: 60_000 })
    await expect(dialog.getByText('Imported', { exact: true })).toHaveCount(3)
    await shot(page, 'vercel-import-three')
    expect(imports).toHaveLength(3)
    for (const size of imports) expect(size).toBeLessThan(4 * MB)
    await dialog.getByRole('button', { name: 'Done' }).click()
    const titles = (await noteTitles(request)).map((n) => n.title)
    for (const n of names) expect(titles.filter((t) => t === n)).toHaveLength(1)
  })

  test('Upload limit checked in the browser: a file over the limit is shown as rejected "larger than N MB" without a request; the others are imported', async ({
    page,
    request,
  }) => {
    test.slow()
    const status = await (await request.get(`${API}/api/auth/status`)).json()
    const limitMb = Math.round(status.max_upload_bytes / MB)
    const small = `${NOTE_PREFIX} small ${RUN}`
    const bigName = `${NOTE_PREFIX}-too-big-${RUN}.html`
    const smallName = `${small.replace(/\W+/g, '-')}.html`

    const sentFiles: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/notes/import') {
        sentFiles.push(r.postData() ?? r.postDataBuffer()?.toString('latin1').slice(0, 2000) ?? '')
      }
    })
    await page.goto('/')
    await page.getByRole('button', { name: /^(Import|Import HTML or PDF files)$/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Import HTML or PDF files' })
    await dialog.getByLabel('HTML or PDF files').setInputFiles([
      { name: bigName, mimeType: 'text/html', buffer: Buffer.alloc((limitMb + 2) * MB, 'a') },
      { name: smallName, mimeType: 'text/html', buffer: htmlOf(small, 1 * MB) },
    ])
    const bigRow = dialog.getByRole('listitem').filter({ hasText: bigName })
    await expect(bigRow).toContainText(`Rejected: larger than ${limitMb} MB`, { timeout: 60_000 })
    const smallRow = dialog.getByRole('listitem').filter({ hasText: smallName })
    await expect(smallRow).toContainText('Imported')
    await shot(page, 'vercel-import-too-large')
    expect(sentFiles).toHaveLength(1)
    expect(sentFiles[0]).not.toContain(bigName)
    await dialog.getByRole('button', { name: 'Done' }).click()
    expect((await noteTitles(request)).some((n) => n.title === small)).toBe(true)
  })

  test('Started sign-ins are stored on the server: the sign-in with the fake GitHub works, and a replayed callback is refused', async ({
    playwright,
  }) => {
    await (await playwright.request.newContext()).post(`${FAKE}/oauth-control`, { data: {} })
    const first = await playwright.request.newContext({ baseURL: APP, storageState: SIGNED_OUT })
    try {
      const started = await first.get('/api/auth/oauth/github/start?next=%23%2Fsettings%2Fdata', { maxRedirects: 0 })
      expect(started.status()).toBe(302)
      const cookies = (await first.storageState()).cookies
      expect(cookies.length).toBeGreaterThan(0)
      const setCookie = started.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value).join('\n')
      expect(setCookie).toMatch(/httponly/i)

      const authorize = await first.get(started.headers()['location'], { maxRedirects: 0 })
      expect(authorize.status()).toBe(302)
      const callback = authorize.headers()['location']
      expect(callback).toContain('/api/auth/oauth/github/callback')

      // A second browser holding the same started-sign-in cookie, as if another instance answered.
      const replayer = await playwright.request.newContext({ baseURL: APP, storageState: { cookies, origins: [] } })
      try {
        const done = await first.get(callback, { maxRedirects: 0 })
        expect(done.status()).toBe(302)
        expect(done.headers()['location']).toContain('/#/settings/data')
        expect((await first.get('/api/auth/me')).status()).toBe(200)

        const replay = await replayer.get(callback, { maxRedirects: 0 })
        expect(replay.status()).toBe(302)
        expect(replay.headers()['location']).toMatch(/#\/auth\/login\?error=/)
        expect((replay.headers()['set-cookie'] ?? '').includes('lh_session=')).toBeFalsy()
        expect((await replayer.get('/api/auth/me')).status()).toBe(401)
      } finally {
        await replayer.dispose()
      }
    } finally {
      await first.dispose()
    }
  })

  test('Started sign-ins are stored on the server: in the browser, a replayed callback address shows a sign-in error', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: APP, storageState: SIGNED_OUT })
    try {
      const page = await ctx.newPage()
      let callback = ''
      page.on('request', (r) => {
        if (new URL(r.url()).pathname === '/api/auth/oauth/github/callback') callback = r.url()
      })
      await page.goto('/#/')
      await page.getByRole('link', { name: 'Continue with GitHub' }).click()
      await expect(page.getByRole('button', { name: /^Account menu/ })).toBeVisible()
      expect(callback).toContain('state=')
      await shot(page, 'vercel-github-signed-in')

      // Signed out again, the replayed callback address (its stored sign-in is used up) is refused.
      await ctx.clearCookies()
      await page.goto(callback)
      await expect(page.getByRole('main', { name: 'Log in' }).getByRole('alert')).toContainText(/sign-in/i)
      expect((await page.request.get('/api/auth/me')).status()).toBe(401)
      await shot(page, 'vercel-github-replay-refused')
    } finally {
      await ctx.close()
    }
  })
})
