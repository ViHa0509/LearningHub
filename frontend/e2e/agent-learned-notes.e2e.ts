/**
 * Spec checks for the change agent-learned-notes (openspec/changes/agent-learned-notes/specs):
 * the assistant saves a new topic as a learned note (agent-chat), the Learned list shows it with an
 * "agent" badge, the saved page shows the write-up with HTML as text, a known title is not saved
 * again, and notes are listed newest first (learning-views).
 *
 * The provider is the fake OpenAI-compatible server (e2e/fake_llm.py): "[[learn:<title>]]" makes
 * the assistant call save_learned_note and then answer "LEARN saved <title>" or
 * "LEARN refused <title>" by what the tool result said. Notes and providers made here are removed.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const API = 'http://127.0.0.1:8001/api'
const H = { 'X-LearningHub': '1' }
const FAKE = 'http://127.0.0.1:8002/v1'
const PREFIX = 'QC-learn'
const LABEL = 'Learn main'
const ANSWER_TIMEOUT = 20_000

let counter = 0
const unique = (text: string) => `${PREFIX} ${text} ${Date.now().toString(36)}${counter++}`

interface ApiNote {
  id: string
  title: string
  node_id: string | null
  source: string
  updated_at: string
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

async function listNotes(request: APIRequestContext): Promise<ApiNote[]> {
  const res = await request.get(`${API}/notes`)
  expect(res.ok()).toBeTruthy()
  return res.json()
}

const mine = async (request: APIRequestContext) => (await listNotes(request)).filter((n) => n.title.startsWith(PREFIX))

test.afterEach(async ({ request }) => {
  const all = [...(await listNotes(request))]
  const arch = await request.get(`${API}/notes?archived=true`)
  if (arch.ok()) all.push(...((await arch.json()) as ApiNote[]))
  for (const n of all.filter((x) => x.title.startsWith(PREFIX))) {
    await request.delete(`${API}/notes/${n.id}`, { headers: H })
  }
  for (const agent of ['assistant', 'lesson-writer']) {
    await request.put(`${API}/agents/${agent}/provider`, {
      headers: H,
      data: { primary_provider_id: null, fallback_provider_id: null },
    })
  }
  const providers = (await (await request.get(`${API}/ai-providers`)).json()) as Array<{ id: string; name: string }>
  for (const p of providers.filter((x) => x.name.startsWith(LABEL))) {
    await request.delete(`${API}/ai-providers/${p.id}`, { headers: H })
  }
})

async function makeProvider(request: APIRequestContext) {
  const res = await request.post(`${API}/ai-providers`, {
    headers: H,
    data: { name: `${LABEL} ${Date.now().toString(36)}${counter++}`, provider_type: 'local', model_name: 'fake-ok', base_url: FAKE, config: {} },
  })
  expect(res.status(), await res.text()).toBe(201)
  const provider = (await res.json()) as { id: string }
  const assigned = await request.put(`${API}/agents/assistant/provider`, {
    headers: H,
    data: { primary_provider_id: provider.id, fallback_provider_id: null },
  })
  expect(assigned.status(), await assigned.text()).toBe(200)
}

async function openChat(page: Page, request: APIRequestContext) {
  await makeProvider(request)
  await page.goto('/')
  const agent = page.getByRole('complementary', { name: 'Agent' })
  const box = agent.getByRole('textbox', { name: 'Message the agent' })
  await expect(box).toBeVisible()
  return { agent, box, log: agent.getByRole('log', { name: 'Conversation' }) }
}

const listOf = (page: Page) => page.getByRole('complementary', { name: 'Learned items' })

async function importNote(request: APIRequestContext, title: string, node: string) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1></body></html>`
  const res = await request.post(`${API}/notes/import`, {
    headers: H,
    multipart: { files: { name: `${title.replace(/ /g, '_')}.html`, mimeType: 'text/html', buffer: Buffer.from(html) } },
  })
  expect(res.ok()).toBeTruthy()
  const note = (await res.json()).results[0].note as ApiNote
  const linked = await request.patch(`${API}/notes/${note.id}`, { headers: H, data: { node_id: node } })
  expect(linked.ok()).toBeTruthy()
  return (await linked.json()) as ApiNote
}

test('New topic and Already known: the assistant saves a note, the list shows it with the badge, the page escapes HTML, asking again saves nothing', async ({
  page,
  request,
}) => {
  const dialogs: string[] = []
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void d.dismiss()
  })
  const title = unique('gRPC')
  const { agent, box, log } = await openChat(page, request)
  expect(await mine(request)).toHaveLength(0)

  // Scenario: New topic.
  await box.fill(`explain ${title} [[learn:${title}]]`)
  await box.press('Enter')
  await expect(log.getByText(`LEARN saved ${title}`)).toBeVisible({ timeout: ANSWER_TIMEOUT })
  const notes = await mine(request)
  expect(notes).toHaveLength(1)
  expect(notes[0].title).toBe(title)
  expect(notes[0].source).toBe('agent')
  const id = notes[0].id

  // The chat trace shows the save.
  await log.getByText('Used 1 tool').click()
  await expect(log.getByText(`Saved note '${title}'`)).toBeVisible()

  // The Learned list shows it, at the top of its group, with the "agent" badge, without a reload.
  const list = listOf(page)
  const item = list.getByRole('button', { name: new RegExp(`^${title}`) })
  await expect(item).toBeVisible()
  await expect(item.getByText('agent', { exact: true })).toBeVisible()
  const group = list.getByRole('region', { name: 'Unsorted' })
  await expect(group.getByRole('listitem').first()).toContainText(title)
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await shot(page, `agent-learned-notes-list-${scheme}`)
  }
  await page.emulateMedia({ colorScheme: 'light' })

  // Opening it shows the write-up as a page; the script text is text and nothing runs.
  await item.click()
  const frame = page.frameLocator(`iframe[title="Original page: ${title}"]`)
  await expect(frame.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: ANSWER_TIMEOUT })
  await expect(frame.getByRole('heading', { name: 'Takeaways' })).toBeVisible()
  await expect(frame.getByText('<script>alert(1)</script>')).toBeVisible()
  await expect(frame.locator('script')).toHaveCount(0)
  const original = await request.get(`${API}/notes/${id}/original`)
  const html = await original.text()
  expect(html).not.toMatch(/<script[\s>]/i)
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  await page.waitForTimeout(500)
  expect(dialogs).toEqual([])
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await shot(page, `agent-learned-notes-page-${scheme}`)
  }
  await page.emulateMedia({ colorScheme: 'light' })

  // Scenario: Already known - the same title again: the tool refuses, no second note.
  const again = agent.getByRole('textbox', { name: 'Message the agent' })
  await again.fill(`tell me about ${title} again [[learn:${title}]]`)
  await again.press('Enter')
  await expect(log.getByText(`LEARN refused ${title}`)).toBeVisible({ timeout: ANSWER_TIMEOUT })
  expect(await mine(request)).toHaveLength(1)

  // A different capitalization of the same title is also refused.
  await again.fill(`and once more [[learn:${title.toUpperCase()}]]`)
  await again.press('Enter')
  await expect(log.getByText(`LEARN refused ${title.toUpperCase()}`)).toBeVisible({ timeout: ANSWER_TIMEOUT })
  expect(await mine(request)).toHaveLength(1)
  expect(dialogs).toEqual([])
})

test('Newest first: groups and notes follow the last update', async ({ page, request }) => {
  const older = await importNote(request, unique('older'), 'backend/redis')
  await page.waitForTimeout(1100)
  const newer = await importNote(request, unique('newer'), 'backend/caching')
  await page.waitForTimeout(1100)
  await page.goto('/')
  const list = listOf(page)
  const redis = list.getByRole('group', { name: 'Backend > Redis' })
  const caching = list.getByRole('group', { name: 'Backend > Caching' })
  await expect(redis.getByRole('button', { name: older.title, exact: true })).toBeVisible()
  await expect(caching.getByRole('button', { name: newer.title, exact: true })).toBeVisible()

  const headings = () => list.locator('section[aria-label="Backend"] h4').allTextContents()
  const order = async () => {
    const h = await headings()
    return [h.indexOf('Caching'), h.indexOf('Redis')]
  }
  // The group of the most recently updated note comes first.
  let [c, r] = await order()
  expect(c).toBeGreaterThanOrEqual(0)
  expect(c).toBeLessThan(r)
  await shot(page, 'agent-learned-notes-order-light')

  // Notes in one group: the more recently updated note first.
  const second = await importNote(request, unique('second'), 'backend/redis')
  await page.waitForTimeout(1100)
  await page.reload()
  await expect(redis.getByRole('button', { name: second.title, exact: true })).toBeVisible()
  const titles = await redis.getByRole('listitem').locator('.note-select').allTextContents()
  expect(titles.findIndex((t) => t.startsWith(second.title))).toBeLessThan(titles.findIndex((t) => t.startsWith(older.title)))

  // Updating the older note (rename) makes it the most recent: its group and place move up.
  const renamed = unique('renamed')
  const res = await request.patch(`${API}/notes/${older.id}`, { headers: H, data: { title: renamed } })
  expect(res.ok()).toBeTruthy()
  const stamps = Object.fromEntries((await listNotes(request)).map((n) => [n.id, n.updated_at]))
  expect(Date.parse(stamps[older.id])).toBeGreaterThan(Date.parse(stamps[newer.id]))
  await page.reload()
  await expect(redis.getByRole('button', { name: renamed, exact: true })).toBeVisible()
  ;[c, r] = await order()
  expect(r).toBeGreaterThanOrEqual(0)
  expect(r).toBeLessThan(c)
  const after = await redis.getByRole('listitem').locator('.note-select').allTextContents()
  expect(after[0].startsWith(renamed)).toBe(true)
  await page.emulateMedia({ colorScheme: 'dark' })
  await shot(page, 'agent-learned-notes-order-dark')
  await page.emulateMedia({ colorScheme: 'light' })
})
