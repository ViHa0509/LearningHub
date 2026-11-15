/**
 * Spec checks for the change agent-settings-page (openspec/changes/agent-settings-page/specs/
 * agent-settings): the Agents page in Settings, extra instructions and tool choices per area
 * (Save and Cancel, the 4000 limit, what the model receives on the area's pages and elsewhere),
 * and area settings as the user's own data (another user's area answers 404).
 *
 * The fake model (e2e/fake_llm.py) answers "[[echo-system]] <marker>" with "SYSTEM has=yes|no"
 * and "[[echo-tools]]" with "TOOLS <names offered>". The phone screenshot of the page is taken by
 * responsive.e2e.ts (page "settings-agents").
 */
import { expect as baseExpect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'
import { OWNER_STATE } from '../playwright.config.ts'
import { latestOutboxToken, nextOutboxToken } from './outbox.ts'

test.describe.configure({ mode: 'serial', timeout: 120_000 })
const expect = baseExpect.configure({ timeout: 20_000 })

const APP = 'http://127.0.0.1:5174'
const API = 'http://127.0.0.1:8001'
const FAKE = 'http://127.0.0.1:8002/v1'
const H = { 'X-LearningHub': '1' }
const STAMP = Date.now().toString(36)
const MEMBER = { email: `agents-member-${STAMP}@example.test`, password: 'e2e-member-password-1', name: 'Agents Member' }
const SIGNED_OUT = { cookies: [], origins: [] }
const MARKER = `QCMARK${STAMP}`

const created: string[] = []
const member: { context: BrowserContext | null } = { context: null }
let fieldId: string | null = null

interface ApiArea {
  domain_id: string
  title: string
  instructions: string
  tools: string[] | null
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

async function areas(request: APIRequestContext): Promise<ApiArea[]> {
  const res = await request.get(`${API}/api/agents/areas`)
  expect(res.status()).toBe(200)
  return res.json()
}

async function saveArea(request: APIRequestContext, id: string, instructions: string, tools: string[] | null) {
  const res = await request.put(`${API}/api/agents/areas/${id}`, { headers: H, data: { instructions, tools } })
  expect(res.status(), await res.text()).toBe(200)
}

async function resetAreas(request: APIRequestContext) {
  for (const a of await areas(request)) {
    if (a.instructions !== '' || a.tools !== null) await saveArea(request, a.domain_id, '', null)
  }
}

async function makeProvider(request: APIRequestContext) {
  if (created.length > 0) return
  const res = await request.post(`${API}/api/ai-providers`, {
    headers: H,
    data: { name: `Agents page ${STAMP}`, provider_type: 'local', model_name: 'fake-ok', base_url: FAKE, config: {} },
  })
  expect(res.status(), await res.text()).toBe(201)
  const body = await res.json()
  created.push(body.id)
  for (const agent of ['assistant', 'lesson-writer']) {
    const put = await request.put(`${API}/api/agents/${agent}/provider`, {
      headers: H,
      data: { primary_provider_id: body.id, fallback_provider_id: null },
    })
    expect(put.status(), await put.text()).toBe(200)
  }
}

/** Opens a page, sends one message to the assistant and returns the model's echoed answer. */
async function chatFrom(page: Page, hash: string, message: string): Promise<string> {
  await page.goto(`/${hash}`)
  const agent = page.getByRole('complementary', { name: 'Agent' })
  const box = agent.getByRole('textbox', { name: 'Message the agent' })
  await expect(box).toBeVisible()
  const answer = agent.getByText(/^(SYSTEM has=|TOOLS )/)
  // The panel may still show the answers of earlier pages: wait for one more.
  const before = await answer.count()
  await box.fill(message)
  await box.press('Enter')
  await expect(answer).toHaveCount(before + 1, { timeout: 60_000 })
  return (await answer.last().innerText()).trim()
}

function areaCard(page: Page, title: string) {
  return page.getByRole('article', { name: `Area: ${title}` })
}

test.beforeAll(async ({ playwright }) => {
  const admin = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    await resetAreas(admin)
  } finally {
    await admin.dispose()
  }
})

test.afterEach(async ({ request }) => {
  await resetAreas(request)
})

test.afterAll(async ({ playwright }) => {
  const admin = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    await resetAreas(admin)
    for (const agent of ['assistant', 'lesson-writer']) {
      await admin.put(`${API}/api/agents/${agent}/provider`, { headers: H, data: { primary_provider_id: null, fallback_provider_id: null } })
    }
    while (created.length > 0) await admin.delete(`${API}/api/ai-providers/${created.pop()}`, { headers: H })
    if (fieldId) await admin.delete(`${API}/api/fields/${fieldId}`, { headers: H })
    const users = (await (await admin.get('/api/admin/users')).json()) as Array<{ id: string; email: string }>
    const found = users.find((u) => u.email === MEMBER.email)
    if (found) await admin.delete(`/api/admin/users/${found.id}`, { headers: H, data: { confirm_email: MEMBER.email } })
    const pending = (await (await admin.get('/api/admin/invitations')).json()) as Array<{ id: string; email: string }>
    for (const i of pending.filter((x) => x.email === MEMBER.email)) await admin.delete(`/api/admin/invitations/${i.id}`, { headers: H })
  } finally {
    await admin.dispose()
    await member.context?.close()
  }
})

test.describe('Agents page in Settings', () => {
  test('Open the Agents page: three agent cards and the Areas section', async ({ page }) => {
    await page.goto('/#/settings')
    const nav = page.getByRole('navigation', { name: 'Settings sections' })
    await nav.getByRole('link', { name: 'Agents' }).click()
    await expect(page).toHaveURL(/#\/settings\/agents$/)
    const region = page.getByRole('region', { name: 'Agents' })
    await expect(region.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible()
    const cards = region.getByRole('region', { name: 'Agent providers' })
    for (const name of ['Learning assistant', 'Lesson writer', 'Topic outline']) {
      await expect(cards.getByRole('article', { name })).toBeVisible()
    }
    const section = region.getByRole('region', { name: 'Areas' })
    await expect(section).toBeVisible()
    await expect(section.getByRole('article', { name: 'Area: Backend' })).toBeVisible()
    await shot(page, 'agents-settings')
    await page.emulateMedia({ colorScheme: 'dark' })
    await shot(page, 'agents-settings-dark')
    await page.emulateMedia({ colorScheme: 'light' })
  })

  test('Providers page shows no agent cards', async ({ page }) => {
    await page.goto('/#/settings')
    await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    for (const name of ['Learning assistant', 'Lesson writer', 'Topic outline']) {
      await expect(page.getByRole('article', { name })).toHaveCount(0)
    }
    await expect(page.getByRole('region', { name: 'Agent providers' })).toHaveCount(0)
  })
})

test.describe('Extra instructions and tools per area', () => {
  test('Save and Cancel: Save is disabled until an edit, Cancel restores, nothing is sent until Save, Save persists', async ({ page }) => {
    await page.goto('/#/settings/agents')
    const card = areaCard(page, 'Backend')
    const box = card.getByLabel('Extra instructions for Backend')
    const save = card.getByRole('button', { name: 'Save' })
    const cancel = card.getByRole('button', { name: 'Cancel' })
    await expect(box).toBeVisible()
    await expect(save).toBeDisabled()

    const puts: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().includes('/api/agents/areas/')) puts.push(r.url())
    })
    await box.fill('Draft that is never saved')
    await expect(save).toBeEnabled()
    await cancel.click()
    await expect(box).toHaveValue('')
    await expect(save).toBeDisabled()
    await box.fill('Draft that is never saved')
    expect(puts).toEqual([])
    expect((await areas(page.request)).find((a) => a.domain_id === 'backend')?.instructions).toBe('')

    await box.fill('Answer in short sentences.')
    await card.getByRole('checkbox', { name: /write_lesson/ }).uncheck()
    await save.click()
    await expect(card.getByRole('status')).toHaveText('Saved')
    expect(puts).toHaveLength(1)
    const stored = (await areas(page.request)).find((a) => a.domain_id === 'backend')
    expect(stored?.instructions).toBe('Answer in short sentences.')
    expect(stored?.tools).not.toBeNull()
    expect(stored?.tools).not.toContain('write_lesson')

    await page.reload()
    const again = areaCard(page, 'Backend')
    await expect(again.getByLabel('Extra instructions for Backend')).toHaveValue('Answer in short sentences.')
    await expect(again.getByRole('checkbox', { name: /write_lesson/ })).not.toBeChecked()
    await expect(again.getByRole('checkbox', { name: /search_notes/ })).toBeChecked()
    await expect(again.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  test('Too long: 4001 characters are refused with 422 naming 4000, and the page shows the limit', async ({ page, request }) => {
    const res = await request.put(`${API}/api/agents/areas/backend`, { headers: H, data: { instructions: 'x'.repeat(4001), tools: null } })
    expect(res.status()).toBe(422)
    expect(await res.text()).toContain('4000')
    expect((await areas(request)).find((a) => a.domain_id === 'backend')?.instructions).toBe('')
    const unknown = await request.put(`${API}/api/agents/areas/backend`, { headers: H, data: { instructions: '', tools: ['no_such_tool'] } })
    expect(unknown.status()).toBe(422)

    await page.goto('/#/settings/agents')
    const card = areaCard(page, 'Backend')
    const box = card.getByLabel('Extra instructions for Backend')
    await expect(box).toHaveAttribute('maxlength', '4000')
    await box.fill('y'.repeat(3600))
    await expect(card).toContainText(/\/\s*4000/)
  })

  test('Instructions reach the agent on the area and not elsewhere', async ({ page, request }) => {
    await makeProvider(request)
    await saveArea(request, 'backend', `Always mention ${MARKER}.`, null)
    expect(await chatFrom(page, '#/lesson/backend/caching', `[[echo-system]] ${MARKER}`)).toBe('SYSTEM has=yes')
    expect(await chatFrom(page, '#/', `[[echo-system]] ${MARKER}`)).toBe('SYSTEM has=no')
    expect(await chatFrom(page, '#/lesson/devops/docker', `[[echo-system]] ${MARKER}`)).toBe('SYSTEM has=no')
  })

  test('Tool off on the area: write_lesson is not offered on backend pages, still offered on devops', async ({ page, request }) => {
    await makeProvider(request)
    const tools = (await (await request.get(`${API}/api/agents/tools`)).json()) as Array<{ name: string }>
    const names = tools.map((t) => t.name)
    expect(names).toContain('write_lesson')
    await saveArea(
      request,
      'backend',
      '',
      names.filter((n) => n !== 'write_lesson'),
    )

    const off = await chatFrom(page, '#/lesson/backend/caching', '[[echo-tools]]')
    expect(off.startsWith('TOOLS ')).toBe(true)
    expect(off.slice(6).split(',')).not.toContain('write_lesson')
    expect(off.slice(6).split(',')).toContain('read_lesson')

    const on = await chatFrom(page, '#/lesson/devops/docker', '[[echo-tools]]')
    expect(on.slice(6).split(',')).toContain('write_lesson')
  })
})

test.describe("Area settings are the user's own data", () => {
  test("Another user's area answers 404 and nothing is stored", async ({ request, browser }) => {
    const slug = `qc-agents-${STAMP}`
    const field = await request.post(`${API}/api/fields`, { headers: H, data: { title: `QC agents field ${STAMP}` } })
    expect(field.status(), await field.text()).toBe(201)
    fieldId = (await field.json()).id
    const area = await request.post(`${API}/api/fields/${fieldId}/areas`, { headers: H, data: { slug, title: 'QC agents area' } })
    expect(area.status(), await area.text()).toBe(201)

    // The owner can save it.
    await saveArea(request, slug, 'owner only', null)
    expect((await areas(request)).map((a) => a.domain_id)).toContain(slug)

    const previous = latestOutboxToken('invite')
    const invited = await request.post(`${API}/api/admin/invitations`, { headers: H, data: { email: MEMBER.email } })
    expect(invited.status(), await invited.text()).toBe(201)
    const token = await nextOutboxToken('invite', previous)
    member.context = await browser.newContext({ baseURL: APP, storageState: SIGNED_OUT })
    const accepted = await member.context.request.post(`${API}/api/auth/invitation/accept`, {
      headers: H,
      data: { token, password: MEMBER.password, display_name: MEMBER.name },
    })
    expect(accepted.status(), await accepted.text()).toBe(201)

    const m = member.context.request
    const put = await m.put(`${API}/api/agents/areas/${slug}`, { headers: H, data: { instructions: 'intruder', tools: null } })
    expect(put.status()).toBe(404)
    const mine = (await (await m.get(`${API}/api/agents/areas`)).json()) as ApiArea[]
    expect(mine.map((a) => a.domain_id)).not.toContain(slug)
    expect((await areas(request)).find((a) => a.domain_id === slug)?.instructions).toBe('owner only')
  })
})
