/// <reference lib="dom" />
/**
 * Spec checks for the change responsive-layout (openspec/changes/responsive-layout/specs):
 * screen classes, no sideways page scroll, phone drawers, one side panel on a tablet, the compact
 * top bar, full visible height, the roadmap map on small screens and touch use.
 *
 * Run by the `phone` (390x844, touch) and `tablet` (820x1180, touch) projects only. With
 * `hasTouch` Edge already reports `(pointer: coarse)` and `(hover: none)`, so no extra media
 * emulation is needed; the first test asserts it so a change of the emulation shows up at once.
 *
 * Every note this file imports starts with NOTE_PREFIX; afterAll deletes them (other files expect
 * no leftover notes). Screenshots: e2e-results/screens/responsive-<page>-<phone|tablet>[-dark].png.
 */
import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test'
import { OWNER_STATE } from '../playwright.config.ts'

test.describe.configure({ timeout: 90_000 })

const API = 'http://127.0.0.1:8001'
const APP = 'http://127.0.0.1:5174'
const H = { 'X-LearningHub': '1' }
const SIGNED_OUT = { cookies: [], origins: [] }
const NOTE_PREFIX = 'Responsive e2e'
const RUN = Date.now().toString(36)

const cls = () => (test.info().project.name === 'phone' ? 'phone' : 'tablet')
const isPhone = () => test.info().project.name === 'phone'

/** The width the page screenshots are taken at: the project's own (phone 390, tablet 820). */
const nativeWidth = () => (test.info().project.name === 'tablet' ? 820 : 390)

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/responsive-${name}-${cls()}.png`, fullPage: true })
}

/** Light, then dark (`-dark` suffix) screenshots of the page as it is now. */
async function shotBoth(page: Page, name: string) {
  await page.emulateMedia({ colorScheme: 'light' })
  await shot(page, name)
  await page.emulateMedia({ colorScheme: 'dark' })
  await shot(page, `${name}-dark`)
  await page.emulateMedia({ colorScheme: 'light' })
}

async function noteList(request: APIRequestContext): Promise<{ id: string; title: string }[]> {
  const a = (await (await request.get(`${API}/api/notes`)).json()) as { id: string; title: string }[]
  const b = (await (await request.get(`${API}/api/notes?archived=true`)).json()) as { id: string; title: string }[]
  return [...a, ...b]
}

async function importNote(request: APIRequestContext, title: string) {
  const html = `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>Body text of the note.</p></body></html>`
  const res = await request.post(`${API}/api/notes/import`, {
    headers: H,
    multipart: { files: { name: `${title.replace(/\W+/g, '-')}.html`, mimeType: 'text/html', buffer: Buffer.from(html) } },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  const found = (await noteList(request)).find((n) => n.title === title)
  expect(found, `imported note "${title}"`).toBeTruthy()
  return found!.id
}

async function fakeNews(page: Page) {
  const now = Date.now()
  const source = { id: 'qc-lab', name: 'QC Lab News With A Rather Long Source Name', homepage: 'https://lab.example.test/' }
  const items = Array.from({ length: 6 }, (_, n) => ({
    id: `00000000-0000-4000-8000-${String(n + 700).padStart(12, '0')}`,
    source: source.id,
    source_name: source.name,
    title: `Responsive item ${n + 1}: a long headline about models, robots, benchmarks and supercalifragilisticexpialidocious_unbroken_words`,
    url: `${source.homepage}posts/${n}`,
    published_at: new Date(now - n * 3_600_000).toISOString(),
    summary: 'A short synthetic summary that is long enough to wrap over several lines on a narrow screen.',
  }))
  await page.route(
    (url) => url.pathname.startsWith('/api/news'),
    async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/news/refresh') {
        return route.fulfill({ json: { state: 'idle', started_at: null, finished_at: null, error: null, sources: [] } })
      }
      return route.fulfill({
        json: {
          items,
          sources: [{ ...source, count: items.length, last_ok: true, last_error: null, last_fetched_at: new Date(now).toISOString() }],
          last_refresh_at: new Date(now - 12 * 60_000).toISOString(),
          stale: false,
        },
      })
    },
  )
}

/** How far the page is wider than its window, for <html> and <body> (0 or less: fits). */
async function overflow(page: Page): Promise<{ html: number; body: number }> {
  return page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }))
}

type Box = { x: number; y: number; width: number; height: number }
async function box(loc: ReturnType<Page['locator']>): Promise<Box> {
  const b = await loc.boundingBox()
  expect(b, 'element has a box').not.toBeNull()
  return b!
}

const FAKE = 'http://127.0.0.1:8002/v1'
let providerId = ''
let noteId = ''
let noteTitle = ''

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  noteTitle = `${NOTE_PREFIX} ${cls()} ${RUN}`
  noteId = await importNote(ctx, noteTitle)
  // A working provider (the fake LLM server), so the chat shows its composer.
  const res = await ctx.post(`${API}/api/ai-providers`, {
    headers: H,
    data: { name: `${NOTE_PREFIX} provider ${cls()} ${RUN}`, provider_type: 'local', model_name: 'fake-ok', base_url: FAKE, config: {} },
  })
  expect(res.status(), await res.text()).toBe(201)
  providerId = (await res.json()).id
  for (const agent of ['assistant', 'lesson-writer']) {
    const a = await ctx.put(`${API}/api/agents/${agent}/provider`, { headers: H, data: { primary_provider_id: providerId, fallback_provider_id: null } })
    expect(a.status(), await a.text()).toBe(200)
  }
  await ctx.dispose()
})

test.afterAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  for (const agent of ['assistant', 'lesson-writer']) {
    await ctx.put(`${API}/api/agents/${agent}/provider`, { headers: H, data: { primary_provider_id: null, fallback_provider_id: null } })
  }
  if (providerId) await ctx.delete(`${API}/api/ai-providers/${providerId}`, { headers: H })
  for (const n of await noteList(ctx)) {
    if (n.title.startsWith(NOTE_PREFIX)) await ctx.delete(`${API}/api/notes/${n.id}`, { headers: H })
  }
  await ctx.dispose()
})

test('Touch use: the emulated touch device reports a coarse pointer and no hover', async ({ page }) => {
  await page.goto('/')
  const media = await page.evaluate(() => ({
    coarse: matchMedia('(pointer: coarse)').matches,
    noHover: matchMedia('(hover: none)').matches,
  }))
  expect(media).toEqual({ coarse: true, noHover: true })
})

// ---------------------------------------------------------------------------------------------
// No sideways page scroll
// ---------------------------------------------------------------------------------------------

const WIDTHS = [360, 390, 820]

type PageCase = { name: string; hash: () => string; ready: (page: Page) => Promise<void>; setup?: (page: Page) => Promise<void> }
const mainHeading = async (page: Page) => {
  await expect(page.getByRole('main', { name: 'Content' }).getByRole('heading').first()).toBeVisible({ timeout: 15_000 })
}
const PAGES: PageCase[] = [
  { name: 'home', hash: () => '#/', ready: (p) => expect(p.getByRole('heading', { name: 'What do you want to learn?' })).toBeVisible() },
  {
    name: 'roadmap',
    hash: () => '#/roadmap/frontend',
    ready: (p) => expect(p.getByTestId('node-frontend/web-basics')).toBeVisible({ timeout: 15_000 }),
  },
  { name: 'lesson', hash: () => '#/lesson/backend/caching', ready: mainHeading },
  {
    name: 'note',
    hash: () => `#/note/${noteId}`,
    ready: (p) => expect(p.getByRole('article', { name: `Note: ${noteTitle}` })).toBeVisible({ timeout: 15_000 }),
  },
  {
    name: 'news',
    hash: () => '#/news',
    setup: fakeNews,
    ready: (p) => expect(p.getByText(/Responsive item 1/).first()).toBeVisible({ timeout: 15_000 }),
  },
  { name: 'settings', hash: () => '#/settings', ready: (p) => expect(p.getByRole('navigation', { name: 'Settings sections' })).toBeVisible() },
  { name: 'settings-users', hash: () => '#/settings/users', ready: (p) => expect(p.getByRole('table')).toBeVisible({ timeout: 15_000 }) },
  { name: 'settings-signin', hash: () => '#/settings/sign-in', ready: (p) => expect(p.getByRole('navigation', { name: 'Settings sections' })).toBeVisible() },
  { name: 'settings-data', hash: () => '#/settings/data', ready: (p) => expect(p.getByRole('navigation', { name: 'Settings sections' })).toBeVisible() },
]

for (const pc of PAGES) {
  test(`No sideways page scroll: ${pc.name} page fits at 360, 390 and 820 px wide`, async ({ page }) => {
    if (pc.setup) await pc.setup(page)
    const offenders: string[] = []
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      await page.evaluate((h) => (location.hash = h), pc.hash())
      await page.reload()
      await pc.ready(page)
      // Let the layout settle (lists, images) before measuring.
      await page.waitForLoadState('networkidle')
      const o = await overflow(page)
      if (o.html > 0 || o.body > 0) {
        offenders.push(`${pc.name} at ${width}px: html scrollWidth exceeds clientWidth by ${o.html}px, body by ${o.body}px`)
      }
      if (width === nativeWidth()) await shotBoth(page, pc.name)
    }
    expect(offenders).toEqual([])
  })
}

test.describe('Sign-in page (signed out)', () => {
  test.use({ storageState: SIGNED_OUT })

  test('No sideways page scroll: the sign-in page fits at 360, 390 and 820 px wide', async ({ page }) => {
    const offenders: string[] = []
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      await expect(page.getByRole('main', { name: 'Log in' })).toBeVisible({ timeout: 15_000 })
      const o = await overflow(page)
      if (o.html > 0 || o.body > 0) offenders.push(`sign-in at ${width}px: html by ${o.html}px, body by ${o.body}px`)
      if (width === nativeWidth()) await shotBoth(page, 'signin')
    }
    expect(offenders).toEqual([])
  })
})

test('Screen classes: the layout switches exactly at 639/640 and 1099/1100 px and the page never scrolls sideways', async ({
  page,
}) => {
  const results: string[] = []
  const classOf = async () => {
    const phone = await page.getByRole('button', { name: 'Learned', exact: true }).isVisible()
    const radios = await page.getByRole('radiogroup', { name: 'Theme' }).isVisible()
    const chat = await page.getByRole('textbox', { name: 'Message the agent' }).isVisible()
    if (phone && !radios) return 'phone'
    if (radios && !chat) return 'tablet'
    if (radios && chat) return 'desktop'
    return `unknown(phoneButton=${phone}, radiogroup=${radios}, chat=${chat})`
  }
  for (const [width, expected] of [
    [639, 'phone'],
    [640, 'tablet'],
    [1099, 'tablet'],
    [1100, 'desktop'],
  ] as const) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'What do you want to learn?' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    // The panels settle after the first render: wait for the expected layout, then report what is shown.
    await expect.poll(classOf, { timeout: 8_000 }).toBe(expected).catch(() => undefined)
    const got = await classOf()
    if (got !== expected) results.push(`at ${width}px expected the ${expected} layout, got ${got}`)
    const o = await overflow(page)
    if (o.html > 0 || o.body > 0) results.push(`at ${width}px the page is wider than the window by ${o.html}px (html), ${o.body}px (body)`)
  }
  expect(results).toEqual([])
})

test('No sideways page scroll: Users table on a phone scrolls inside its own area', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/settings/users')
  const table = page.getByRole('table')
  await expect(table).toBeVisible({ timeout: 15_000 })
  const wrapper = table.locator('xpath=..')
  const m = await wrapper.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    overflowX: getComputedStyle(el).overflowX,
  }))
  expect(m.scrollWidth, `table wrapper scrollWidth ${m.scrollWidth} vs clientWidth ${m.clientWidth}`).toBeGreaterThan(m.clientWidth)
  expect(['auto', 'scroll']).toContain(m.overflowX)
  const o = await overflow(page)
  expect(o.html).toBeLessThanOrEqual(0)
  expect(o.body).toBeLessThanOrEqual(0)
  // The wrapper really scrolls: scrolling it moves the table, not the page.
  await wrapper.evaluate((el) => (el.scrollLeft = 80))
  expect(await wrapper.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.scrollX)).toBe(0)
})

// ---------------------------------------------------------------------------------------------
// Phone: drawers
// ---------------------------------------------------------------------------------------------

test.describe('phone only', () => {
  test.beforeEach(() => {
    test.skip(!isPhone(), 'phone project only')
  })

  test('Side panels as drawers on a phone: the app opens with both drawers closed and the home page visible', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('banner')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'What do you want to learn?' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Learned' })).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Agent' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Learned', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('button', { name: 'Agent', exact: true })).toHaveAttribute('aria-expanded', 'false')
    // The center takes the whole width.
    const main = await box(page.getByRole('main', { name: 'Content' }))
    expect(main.width).toBeGreaterThanOrEqual(390 - 1)
  })

  test('Side panels as drawers on a phone: Learned opens a dialog; tapping a note closes it and shows the note', async ({ page }) => {
    await page.goto('/')
    const opener = page.getByRole('button', { name: 'Learned', exact: true })
    await opener.tap()
    const drawer = page.getByRole('dialog', { name: 'Learned' })
    await expect(drawer).toBeVisible()
    await expect(opener).toHaveAttribute('aria-expanded', 'true')
    // Focus moves into the drawer.
    await expect(drawer.getByRole('button', { name: 'Close learned list' })).toBeFocused()
    await expect(drawer.getByRole('button', { name: noteTitle, exact: true })).toBeVisible({ timeout: 15_000 })
    const w = await box(drawer)
    expect(w.width).toBeLessThanOrEqual(360 + 1)
    await shotBoth(page, 'learned-drawer')
    await drawer.getByRole('button', { name: noteTitle, exact: true }).tap()
    await expect(drawer).toBeHidden()
    await expect(page.getByRole('article', { name: `Note: ${noteTitle}` })).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(new RegExp(`#/note/${noteId}$`))
  })

  test('Side panels as drawers on a phone: only one drawer is open at a time (Learned, then Agent)', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Learned', exact: true }).tap()
    await expect(page.getByRole('dialog', { name: 'Learned' })).toBeVisible()
    // The scrim covers the top bar's right side only below it; the top bar itself stays reachable.
    await page.getByRole('button', { name: 'Agent', exact: true }).tap()
    await expect(page.getByRole('dialog', { name: 'Agent' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Learned' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Learned', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('button', { name: 'Agent', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await shotBoth(page, 'agent-drawer')
    // And back: Learned closes the Agent drawer.
    await page.getByRole('button', { name: 'Learned', exact: true }).tap()
    await expect(page.getByRole('dialog', { name: 'Learned' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Agent' })).toHaveCount(0)
  })

  test('Side panels as drawers on a phone: Escape closes, focus returns to the opener and the typed chat text is kept', async ({ page }) => {
    await page.goto('/')
    const opener = page.getByRole('button', { name: 'Agent', exact: true })
    await opener.tap()
    const drawer = page.getByRole('dialog', { name: 'Agent' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Close agent' })).toBeFocused()
    const composer = drawer.getByRole('textbox', { name: 'Message the agent' })
    const draft = `A question typed on a phone ${RUN}`
    await composer.fill(draft)
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect(opener).toBeFocused()
    await opener.tap()
    await expect(page.getByRole('dialog', { name: 'Agent' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Message the agent' })).toHaveValue(draft)
    // The close button closes too.
    await page.getByRole('button', { name: 'Close agent' }).tap()
    await expect(page.getByRole('dialog', { name: 'Agent' })).toBeHidden()
    await expect(opener).toBeFocused()
    await opener.tap()
    await expect(page.getByRole('textbox', { name: 'Message the agent' })).toHaveValue(draft)
  })

  test('Side panels as drawers on a phone: a tap outside the drawer (the scrim) closes it, for both drawers', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Learned', exact: true }).tap()
    const learned = page.getByRole('dialog', { name: 'Learned' })
    await expect(learned).toBeVisible()
    await page.touchscreen.tap(385, 500)
    await expect(learned).toBeHidden()
    await expect(page.getByRole('button', { name: 'Learned', exact: true })).toBeFocused()

    await page.getByRole('button', { name: 'Agent', exact: true }).tap()
    const agent = page.getByRole('dialog', { name: 'Agent' })
    await expect(agent).toBeVisible()
    await page.touchscreen.tap(4, 500)
    await expect(agent).toBeHidden()
    await expect(page.getByRole('button', { name: 'Agent', exact: true })).toBeFocused()
  })

  test('Full visible height: with the Agent drawer open the composer and Send button are inside the viewport', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Agent', exact: true }).tap()
    const drawer = page.getByRole('dialog', { name: 'Agent' })
    await expect(drawer).toBeVisible()
    const vp = page.viewportSize()!
    for (const loc of [drawer.getByRole('textbox', { name: 'Message the agent' }), drawer.getByRole('button', { name: 'Send' })]) {
      await expect(loc).toBeVisible()
      // The drawer slides in from the right: measure once it has settled.
      await expect.poll(async () => { const s = await box(loc); return s.x + s.width }).toBeLessThanOrEqual(vp.width)
      const b = await box(loc)
      expect(b.y, 'top inside').toBeGreaterThanOrEqual(0)
      expect(b.y + b.height, `bottom ${b.y + b.height} within viewport height ${vp.height}`).toBeLessThanOrEqual(vp.height)
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width)
    }
    // The app frame itself fills the visible height, no more.
    const frame = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, win: window.innerHeight }))
    expect(frame.doc).toBeLessThanOrEqual(frame.win)
  })

  test('Touch use: a note\'s More actions is visible without hover and opens its menu with one tap; targets are at least 40 px tall', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Learned', exact: true }).tap()
    const drawer = page.getByRole('dialog', { name: 'Learned' })
    const more = drawer.getByRole('button', { name: `More actions for ${noteTitle}` })
    await expect(more).toBeVisible({ timeout: 15_000 })
    expect.soft(await more.evaluate((el) => getComputedStyle(el).opacity), 'More actions opacity without hover').toBe('1')
    // A learned-list row is at least 40 px tall.
    const row = await box(drawer.getByRole('button', { name: noteTitle, exact: true }))
    expect(row.height, 'learned-list row height').toBeGreaterThanOrEqual(40)
    await more.tap()
    await expect(page.getByRole('menu', { name: 'Note actions' })).toBeVisible()
    await shot(page, 'note-menu')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Close learned list' }).tap()
    await expect(drawer).toBeHidden()

    // The note page's own More actions menu: inside the window, no sideways scroll, items at least 40 px tall.
    await page.goto(`/#/note/${noteId}`)
    const article = page.getByRole('article', { name: `Note: ${noteTitle}` })
    const pageMore = article.getByRole('button', { name: 'More actions' })
    await expect(pageMore).toBeVisible({ timeout: 15_000 })
    expect((await box(pageMore)).height, 'note page More actions height').toBeGreaterThanOrEqual(40)
    await pageMore.tap()
    const pageMenu = article.getByRole('menu', { name: 'Note actions' })
    await expect(pageMenu.getByRole('menuitem')).toHaveText(['Edit page', 'Export PDF', 'Archive', 'Delete'])
    const menuBox = await box(pageMenu)
    expect(menuBox.x, 'menu left edge').toBeGreaterThanOrEqual(0)
    expect(menuBox.x + menuBox.width, 'menu right edge').toBeLessThanOrEqual(page.viewportSize()!.width)
    const scroll = await overflow(page)
    expect(scroll.html, 'no sideways scroll with the menu open').toBeLessThanOrEqual(0)
    for (const item of await pageMenu.getByRole('menuitem').all()) {
      expect((await box(item)).height, `${await item.innerText()} height`).toBeGreaterThanOrEqual(40)
    }
    await shotBoth(page, 'note-actions-menu')
    await page.keyboard.press('Escape')
    await expect(pageMenu).toHaveCount(0)
    // Back and More actions share the header's first line, More actions at its right end.
    const backBox = await box(article.getByRole('button', { name: '← Back' }))
    const moreBox = await box(pageMore)
    const headBox = await box(article.locator('header'))
    expect(Math.abs(backBox.y - moreBox.y), 'Back and More actions on one line').toBeLessThan(6)
    expect(moreBox.y - headBox.y, 'More actions on the first line').toBeLessThan(16)
    expect(headBox.x + headBox.width - (moreBox.x + moreBox.width), 'More actions at the right end').toBeLessThan(16)
    expect((await overflow(page)).html, 'no sideways scroll on the note page').toBeLessThanOrEqual(0)
    await shotBoth(page, 'note-header')

    // Top-bar controls.
    const short: string[] = []
    const controls = page.getByRole('banner').locator('a:visible, button:visible')
    const count = await controls.count()
    expect(count).toBeGreaterThanOrEqual(5)
    for (let i = 0; i < count; i++) {
      const c = controls.nth(i)
      const b = await box(c)
      if (b.height < 40) short.push(`${(await c.getAttribute('aria-label')) ?? (await c.innerText())} is ${b.height}px tall`)
    }
    expect(short, 'top-bar controls under 40 px').toEqual([])

    // Send button.
    await page.getByRole('button', { name: 'Agent', exact: true }).tap()
    const send = await box(page.getByRole('dialog', { name: 'Agent' }).getByRole('button', { name: 'Send' }))
    expect(send.height, 'Send button height').toBeGreaterThanOrEqual(40)
  })

  test('Compact top bar: at 360 px every control is inside the viewport on one row', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'What do you want to learn?' })).toBeVisible()
    const controls = page.getByRole('banner').locator('a:visible, button:visible')
    const count = await controls.count()
    expect(count).toBeGreaterThanOrEqual(6) // brand, Learned, News, theme, Agent, account
    const boxes: { name: string; b: Box }[] = []
    for (let i = 0; i < count; i++) {
      const c = controls.nth(i)
      const name = (await c.getAttribute('aria-label')) ?? ((await c.innerText()) || (await c.getAttribute('href')) || `#${i}`)
      boxes.push({ name, b: await box(c) })
    }
    const problems: string[] = []
    for (const { name, b } of boxes) {
      if (b.x < 0 || b.x + b.width > 360) problems.push(`${name} spans ${b.x.toFixed(1)}..${(b.x + b.width).toFixed(1)} (viewport 0..360)`)
    }
    const centers = boxes.map(({ b }) => b.y + b.height / 2)
    const spread = Math.max(...centers) - Math.min(...centers)
    if (spread > 12) problems.push(`controls are not on one row: vertical centers differ by ${spread.toFixed(1)}px`)
    expect(problems).toEqual([])
    expect((await overflow(page)).html).toBeLessThanOrEqual(0)
    await shotBoth(page, 'topbar-360')
  })

  test('Compact top bar: one theme button steps System, Light, Dark, System and the page theme really changes', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'What do you want to learn?' })).toBeVisible()
    const html = page.locator('html')
    await expect(page.getByRole('radiogroup', { name: 'Theme' })).toHaveCount(0)
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'))

    await page.getByRole('button', { name: 'Theme: System. Change theme' }).tap()
    await expect(page.getByRole('button', { name: 'Theme: Light. Change theme' })).toBeVisible()
    expect(await theme()).toBe('light')
    const light = await bg()
    await page.getByRole('button', { name: 'Theme: Light. Change theme' }).tap()
    await expect(page.getByRole('button', { name: 'Theme: Dark. Change theme' })).toBeVisible()
    expect(await theme()).toBe('dark')
    const dark = await bg()
    expect(dark, 'dark and light backgrounds differ').not.toBe(light)
    await page.getByRole('button', { name: 'Theme: Dark. Change theme' }).tap()
    await expect(page.getByRole('button', { name: 'Theme: System. Change theme' })).toBeVisible()
    expect(await theme()).toBeNull()
    await expect(html).not.toHaveAttribute('data-theme', /.+/)
  })

  test('Roadmap map on small screens: the first node is in view with a readable label and dragging moves the map', async ({ page }) => {
    await page.goto('/#/roadmap/frontend')
    const first = page.getByTestId('node-frontend/web-basics')
    await expect(first).toBeVisible({ timeout: 15_000 })
    await page.waitForLoadState('networkidle')
    const vp = page.viewportSize()!
    const b = await box(first)
    expect(b.x, 'first node left edge').toBeGreaterThanOrEqual(0)
    expect(b.x + b.width, 'first node right edge').toBeLessThanOrEqual(vp.width)
    expect(b.y, 'first node top').toBeGreaterThanOrEqual(0)
    expect(b.y + b.height, 'first node bottom').toBeLessThanOrEqual(vp.height)
    const label = await first.locator('.node-title').evaluate((el) => {
      const zoom = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')!).transform).a
      return { fontSize: parseFloat(getComputedStyle(el).fontSize), zoom }
    })
    expect(label.fontSize * label.zoom, `label font ${label.fontSize}px x zoom ${label.zoom}`).toBeGreaterThanOrEqual(11)
    await shotBoth(page, 'roadmap-start')

    // Drag the pane up by 250 px from an empty spot: the nodes follow.
    const before = await box(first)
    const startX = 6
    await page.mouse.move(startX, 600)
    await page.mouse.down()
    await page.mouse.move(startX, 450, { steps: 5 })
    await page.mouse.move(startX, 350, { steps: 5 })
    await page.mouse.up()
    const after = await box(first)
    expect(before.y - after.y, `first node moved up by ${before.y - after.y}px after a 250px drag`).toBeGreaterThan(100)
  })

  test('Roadmap map on small screens: the Zoom controls change the zoom', async ({ page }) => {
    await page.goto('/#/roadmap/frontend')
    await expect(page.getByTestId('node-frontend/web-basics')).toBeVisible({ timeout: 15_000 })
    const zoom = () =>
      page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')!).transform).a)
    const z0 = await zoom()
    await page.getByRole('button', { name: 'Zoom in' }).tap()
    await expect.poll(zoom).toBeGreaterThan(z0)
  })
})

// ---------------------------------------------------------------------------------------------
// Tablet
// ---------------------------------------------------------------------------------------------

test.describe('tablet only', () => {
  test.beforeEach(() => {
    test.skip(isPhone(), 'tablet project only')
  })

  test('One side panel at a time on a tablet: list open and chat collapsed at start; opening the chat collapses the list and the center keeps half the width', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'What do you want to learn?' })).toBeVisible()
    const list = page.getByRole('complementary', { name: 'Learned items' })
    const chat = page.getByRole('complementary', { name: 'Agent' })
    await expect(list).toHaveAttribute('data-collapsed', 'false')
    await expect(chat).toHaveAttribute('data-collapsed', 'true')
    await expect(page.getByRole('textbox', { name: 'Message the agent' })).toBeHidden()
    await shotBoth(page, 'home')
    await shotBoth(page, 'home-list-open')

    await page.getByRole('button', { name: 'Expand agent panel' }).tap()
    await expect(chat).toHaveAttribute('data-collapsed', 'false')
    await expect(list).toHaveAttribute('data-collapsed', 'true')
    await expect(page.getByRole('textbox', { name: 'Message the agent' })).toBeVisible()
    const center = await box(page.getByRole('main', { name: 'Content' }))
    expect(center.width, `center width ${center.width} of 820`).toBeGreaterThanOrEqual(410)
    expect((await overflow(page)).html).toBeLessThanOrEqual(0)
    await shotBoth(page, 'chat-open')

    // And back the other way: expanding the list collapses the chat.
    await page.getByRole('button', { name: 'Expand learned list' }).tap()
    await expect(list).toHaveAttribute('data-collapsed', 'false')
    await expect(chat).toHaveAttribute('data-collapsed', 'true')
  })

  test('Compact top bar: on a tablet the theme switch shows icons with three radios that keep their names', async ({ page }) => {
    await page.goto('/')
    const group = page.getByRole('radiogroup', { name: 'Theme' })
    await expect(group).toBeVisible()
    for (const name of ['System', 'Light', 'Dark']) {
      const radio = group.getByRole('radio', { name })
      await expect(radio).toBeVisible()
      // Icons only: the radio is a compact square-ish button, not a wide labelled one.
      expect((await box(radio)).width, `${name} radio width`).toBeLessThan(80)
    }
    await expect(group.getByRole('radio')).toHaveCount(3)
    await group.getByRole('radio', { name: 'Dark' }).tap()
    await expect(group.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    // No phone drawer buttons on a tablet.
    await expect(page.getByRole('button', { name: 'Learned', exact: true })).toHaveCount(0)
    const controls = page.getByRole('banner').locator('a:visible, button:visible')
    for (let i = 0; i < (await controls.count()); i++) {
      const b = await box(controls.nth(i))
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(820)
      const label = (await controls.nth(i).getAttribute('aria-label')) ?? (await controls.nth(i).innerText()) ?? `#${i}`
      expect.soft(b.height, `tablet top-bar control "${label.trim()}" height`).toBeGreaterThanOrEqual(40)
    }
  })

  test('Rotate a tablet: from 1180 px to 820 px the tablet layout shows, the same page stays and the typed question is kept', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1180, height: 820 })
    await page.goto('/#/lesson/backend/caching')
    await expect(page.getByRole('main', { name: 'Content' }).getByRole('heading').first()).toBeVisible({ timeout: 15_000 })
    // Desktop class: both panels open, the chat visible.
    const composer = page.getByRole('textbox', { name: 'Message the agent' })
    await expect(composer).toBeVisible()
    const draft = `Why does caching help? ${RUN}`
    await composer.fill(draft)

    await page.setViewportSize({ width: 820, height: 1180 })
    // The tablet layout: at most one panel open, no phone buttons, a theme radiogroup.
    await expect(page.getByRole('complementary', { name: 'Learned items' })).toHaveAttribute('data-collapsed', 'false')
    await expect(page.getByRole('complementary', { name: 'Agent' })).toHaveAttribute('data-collapsed', 'true')
    await expect(page.getByRole('button', { name: 'Learned', exact: true })).toHaveCount(0)
    await expect(page.getByRole('radiogroup', { name: 'Theme' })).toBeVisible()
    // The same page.
    await expect(page).toHaveURL(/#\/lesson\/backend\/caching$/)
    await expect(page.getByRole('main', { name: 'Content' }).getByRole('heading').first()).toBeVisible()
    // The typed question is still there once the chat is opened.
    await page.getByRole('button', { name: 'Expand agent panel' }).tap()
    await expect(page.getByRole('textbox', { name: 'Message the agent' })).toHaveValue(draft)
    await shotBoth(page, 'rotated')
  })

  test('Touch use: on a tablet the list rows, More actions and Send are touch sized and visible without hover', async ({ page }) => {
    await page.goto('/')
    const list = page.getByRole('complementary', { name: 'Learned items' })
    const more = list.getByRole('button', { name: `More actions for ${noteTitle}` })
    await expect(more).toBeVisible({ timeout: 15_000 })
    expect.soft(await more.evaluate((el) => getComputedStyle(el).opacity), 'More actions opacity without hover').toBe('1')
    expect((await box(list.getByRole('button', { name: noteTitle, exact: true }))).height).toBeGreaterThanOrEqual(40)
    await more.tap()
    await expect(page.getByRole('menu', { name: 'Note actions' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Expand agent panel' }).tap()
    expect((await box(page.getByRole('button', { name: 'Send' }))).height).toBeGreaterThanOrEqual(40)
  })

  test('Roadmap map on small screens: on a tablet the first node is in view with a readable label', async ({ page }) => {
    await page.goto('/#/roadmap/frontend')
    const first = page.getByTestId('node-frontend/web-basics')
    await expect(first).toBeVisible({ timeout: 15_000 })
    await page.waitForLoadState('networkidle')
    const b = await box(first)
    const vp = page.viewportSize()!
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width).toBeLessThanOrEqual(vp.width)
    expect(b.y + b.height).toBeLessThanOrEqual(vp.height)
    const px = await first.locator('.node-title').evaluate((el) => {
      const zoom = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')!).transform).a
      return parseFloat(getComputedStyle(el).fontSize) * zoom
    })
    expect(px).toBeGreaterThanOrEqual(11)
  })
})
