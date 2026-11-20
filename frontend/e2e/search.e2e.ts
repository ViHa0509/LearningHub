/**
 * Spec checks for the change global-search (app-search): the top-bar search box, its dropdown
 * (groups, nothing found, markup stays text) and opening a result (click, keyboard only, Escape),
 * plus the member scoping seen from the box. The phone scenario is in responsive.e2e.ts.
 *
 * Data: a lesson on backend/caching (restored in afterAll), notes whose titles carry a unique
 * stamp, and one invited member (all removed in afterAll). Screenshots: e2e-results/screens/search-*.png.
 */
import { expect as baseExpect, test, type APIRequestContext, type Page } from '@playwright/test'
import { OWNER_STATE } from '../playwright.config.ts'
import { latestOutboxToken, nextOutboxToken } from './outbox.ts'

test.describe.configure({ mode: 'serial', timeout: 120_000 })
const expect = baseExpect.configure({ timeout: 20_000 })

const API = 'http://127.0.0.1:8001'
const APP = 'http://127.0.0.1:5174'
const H = { 'X-LearningHub': '1' }
const STAMP = Date.now().toString(36)
const LESSON_NODE = 'backend/caching'
const WT = `write-through-${STAMP}`
const MEMBER = { email: `search-member-${STAMP}@example.test`, password: 'e2e-member-password-1', name: 'Search Member' }

const BOX = 'Search topics, lessons and notes'
const MARKUP = '<img src=x onerror=alert(1)>'
const MARKUP_KEY = `mk${STAMP}`
const NOTE_KB = `Caching keyboard ${STAMP}`
const NOTE_Z = `Zebra notes ${STAMP}`

const created: string[] = []
let previousLesson = ''
let memberId = ''
const ids: Record<string, string> = {}

function searchBox(page: Page) {
  return page.getByRole('combobox', { name: BOX })
}
function results(page: Page) {
  return page.getByRole('listbox', { name: 'Search results' })
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/search-${name}.png`, fullPage: true })
}

async function importNote(request: APIRequestContext, title: string, text: string): Promise<string> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><p>${text}</p></body></html>`
  const res = await request.post(`${API}/api/notes/import`, {
    headers: H,
    multipart: { files: { name: `search-${Math.random().toString(36).slice(2)}.html`, mimeType: 'text/html', buffer: Buffer.from(html) } },
  })
  expect(res.status(), await res.text()).toBe(200)
  const body = await res.json()
  const note = body.results[0].note as { id: string; title: string }
  created.push(note.id)
  return note.id
}

test.beforeAll(async ({ playwright }) => {
  const admin = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    const old = await admin.get(`${API}/api/lessons/${LESSON_NODE}`)
    if (old.ok()) previousLesson = ((await old.json()) as { body?: string }).body ?? ''
    const saved = await admin.put(`${API}/api/lessons/${LESSON_NODE}`, {
      headers: H,
      data: { body: `Caching writes. Use ${WT} so the cache and the store agree. Use a TTL so stale entries expire.`, source: 'user' },
    })
    expect(saved.ok(), await saved.text()).toBeTruthy()
    ids.kb = await importNote(admin, NOTE_KB, `Body about ${STAMP} keyboard.`)
    // The importer strips tags from a <title>, so the markup title is set through the rename route.
    ids.markup = await importNote(admin, `Markup ${MARKUP_KEY}`, 'Plain body of the markup note.')
    const renamed = await admin.patch(`${API}/api/notes/${ids.markup}`, { headers: H, data: { title: `${MARKUP} ${MARKUP_KEY}` } })
    expect(renamed.status(), await renamed.text()).toBe(200)
    ids.zebra = await importNote(admin, NOTE_Z, 'Admin zebra body.')
    ids.secret = await importNote(admin, `Secret ${STAMP}`, `zebra-protocol-${STAMP} lives only here.`)
  } finally {
    await admin.dispose()
  }
})

test.afterAll(async ({ playwright }) => {
  test.setTimeout(120_000)
  const admin = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    await admin.put(`${API}/api/lessons/${LESSON_NODE}`, { headers: H, data: { body: previousLesson, source: 'user' } })
    for (const id of created) await admin.delete(`${API}/api/notes/${id}`, { headers: H })
    if (memberId) {
      await admin.delete(`${API}/api/admin/users/${memberId}`, { headers: H, data: { confirm_email: MEMBER.email } })
    }
    const pending = (await (await admin.get(`${API}/api/admin/invitations`)).json()) as Array<{ id: string; email: string }>
    for (const inv of pending) {
      if (inv.email === MEMBER.email) await admin.delete(`${API}/api/admin/invitations/${inv.id}`, { headers: H })
    }
  } finally {
    await admin.dispose()
  }
})

test('Search box in the top bar: every signed-in page shows the box; a single character sends no request', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/search')) requests.push(r.url())
  })
  for (const route of ['/', '/#/settings', '/#/news']) {
    await page.goto(route)
    await expect(searchBox(page)).toBeVisible()
    await expect(searchBox(page)).toHaveAttribute('placeholder', 'Search')
  }
  await searchBox(page).fill('a')
  await page.waitForTimeout(800) // longer than the 250 ms debounce: proves that nothing is sent
  expect(requests).toEqual([])
  await expect(results(page)).toHaveCount(0)
})

test('Search box in the top bar: not shown when signed out', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: APP, storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Sign in' }).or(page.getByLabel('Password').first())).toBeVisible()
  await expect(searchBox(page)).toHaveCount(0)
  await context.close()
})

test('Search box in the top bar: nothing found shows No results for the text', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('qqzzxx')
  await expect(results(page)).toContainText('No results for “qqzzxx”')
  await expect(results(page).getByRole('option')).toHaveCount(0)
})

test('Search box in the top bar: results sit under Topics, Lessons and Notes; empty groups are left out (light and dark screenshots)', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill(WT)
  const list = results(page)
  await expect(list.getByText('Lessons', { exact: true })).toBeVisible()
  await expect(list.getByText('Topics', { exact: true })).toHaveCount(0)
  await expect(list.getByText('Notes', { exact: true })).toHaveCount(0)
  // Case is ignored, and the lesson shows an excerpt around the match.
  await searchBox(page).fill('STALE entries')
  await expect(list.getByRole('option', { name: /Caching/ })).toContainText(/stale entries/i)

  // All three groups: "caching" is a topic title, in the lesson text and in a note title.
  await searchBox(page).fill('caching')
  await expect(list.getByText('Topics', { exact: true })).toBeVisible()
  await expect(list.getByText('Lessons', { exact: true })).toBeVisible()
  await expect(list.getByText('Notes', { exact: true })).toBeVisible()
  await expect(list.getByRole('option', { name: new RegExp(NOTE_KB) })).toBeVisible()
  const headings = await list.getByText(/^(Topics|Lessons|Notes)$/).allTextContents()
  expect(headings).toEqual(['Topics', 'Lessons', 'Notes'])

  await page.emulateMedia({ colorScheme: 'light' })
  await shot(page, 'dropdown')
  await page.emulateMedia({ colorScheme: 'dark' })
  await shot(page, 'dropdown-dark')
  await page.emulateMedia({ colorScheme: 'light' })
})

test('Search box in the top bar: markup in a note title stays text and creates no element', async ({ page }) => {
  let dialogs = 0
  page.on('dialog', async (d) => {
    dialogs++
    await d.dismiss()
  })
  await page.goto('/')
  await searchBox(page).fill(MARKUP_KEY)
  const option = results(page).getByRole('option', { name: new RegExp(MARKUP_KEY) })
  await expect(option).toBeVisible()
  await expect(option).toContainText(MARKUP)
  await expect(page.locator('img[src="x"]')).toHaveCount(0)
  expect(dialogs).toBe(0)
})

test('Opening a search result: clicking a lesson opens the lesson page, closes the dropdown and clears the box', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill(WT)
  const list = results(page)
  await expect(list.getByText('Lessons', { exact: true })).toBeVisible()
  await list.getByRole('option', { name: /Caching/ }).click()
  await expect(page).toHaveURL(new RegExp(`#/lesson/${LESSON_NODE}$`))
  await expect(page.getByRole('article', { name: 'Lesson: Caching' })).toBeVisible()
  await expect(results(page)).toHaveCount(0)
  await expect(searchBox(page)).toHaveValue('')
})

test('Opening a search result: keyboard only, Arrow Down moves across Topics to the first note and Enter opens it; Arrow Up moves back', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('caching')
  const list = results(page)
  const note = list.getByRole('option', { name: new RegExp(NOTE_KB) })
  await expect(note).toBeVisible()
  await expect(list.getByText('Topics', { exact: true })).toBeVisible()
  const options = list.getByRole('option')
  await expect(list.locator('[aria-selected="true"]')).toHaveCount(0)
  await page.keyboard.press('ArrowDown')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(options.first()).not.toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowUp')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  const total = await options.count()
  for (let i = 0; i < total; i++) {
    if ((await note.getAttribute('aria-selected')) === 'true') break
    await page.keyboard.press('ArrowDown')
  }
  await expect(note).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`#/note/${ids.kb}$`))
  await expect(page.getByRole('article', { name: `Note: ${NOTE_KB}` })).toBeVisible()
  await expect(searchBox(page)).toHaveValue('')
  await expect(results(page)).toHaveCount(0)
})

test('Opening a search result: a topic opens its lesson page', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('caching')
  const topic = results(page).getByRole('option').first()
  await expect(topic).toBeVisible()
  await topic.click()
  await expect(page).toHaveURL(/#\/lesson\/[a-z0-9-]+\/[a-z0-9-]+$/)
  await expect(results(page)).toHaveCount(0)
})

test('Opening a search result: Escape closes the dropdown and the page does not change', async ({ page }) => {
  await page.goto('/#/news')
  await searchBox(page).fill('caching')
  await expect(results(page).getByRole('option').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(results(page)).toHaveCount(0)
  await expect(page).toHaveURL(/#\/news$/)
})

test('Search is scoped to the user: a member does not find the admin lesson or notes, and each user finds their own', async ({ browser, playwright }) => {
  const admin = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  const previous = latestOutboxToken('invite')
  const invited = await admin.post(`${API}/api/admin/invitations`, { headers: H, data: { email: MEMBER.email } })
  expect(invited.status(), await invited.text()).toBeLessThan(300)
  const token = await nextOutboxToken('invite', previous)
  const context = await browser.newContext({ baseURL: APP, storageState: { cookies: [], origins: [] } })
  try {
    const accepted = await context.request.post(`${API}/api/auth/invitation/accept`, {
      headers: H,
      data: { token, password: MEMBER.password, display_name: MEMBER.name },
    })
    expect(accepted.status(), await accepted.text()).toBe(201)
    memberId = (await accepted.json()).id
    // The member's own note with the same title as the admin's.
    ids.memberZebra = await importNote(context.request, NOTE_Z, 'Member zebra body.')
    const page = await context.newPage()
    await page.goto('/')
    const zone = page.getByRole('dialog', { name: 'Your time zone' })
    if (await zone.isVisible().catch(() => false)) await zone.getByRole('button', { name: 'Save' }).click()
    await expect(searchBox(page)).toBeVisible()

    await searchBox(page).fill(`zebra-protocol-${STAMP}`)
    await expect(results(page)).toContainText(`No results for “zebra-protocol-${STAMP}”`)

    await searchBox(page).fill(WT)
    await expect(results(page)).toContainText(`No results for “${WT}”`)

    await searchBox(page).fill(`zebra notes ${STAMP}`)
    const options = results(page).getByRole('option', { name: new RegExp(NOTE_Z) })
    await expect(options).toHaveCount(1)
    await options.click()
    await expect(page).toHaveURL(new RegExp(`#/note/${ids.memberZebra}$`))
    await shot(page, 'member')
  } finally {
    await context.close()
    await admin.dispose()
  }

  // The admin finds only their own "Zebra notes" note.
  const adminContext = await browser.newContext({ baseURL: APP, storageState: OWNER_STATE })
  const apage = await adminContext.newPage()
  await apage.goto('/')
  await searchBox(apage).fill(`zebra notes ${STAMP}`)
  const mine = results(apage).getByRole('option', { name: new RegExp(NOTE_Z) })
  await expect(mine).toHaveCount(1)
  await mine.click()
  await expect(apage).toHaveURL(new RegExp(`#/note/${ids.zebra}$`))
  await adminContext.close()
})
