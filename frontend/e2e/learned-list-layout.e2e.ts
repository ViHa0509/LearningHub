/**
 * Spec checks for the change learned-list-layout (openspec/changes/learned-list-layout/specs):
 * merged top-level groups (categories beside domains, Unsorted last), the category and list
 * "more" menus, and resizable side panes (drag, keys, reset, limits, reload, collapse, phone).
 *
 * Group with AI runs against the fake OpenAI-compatible server (e2e/fake_llm.py): the title
 * keywords "kube" -> Kubernetes, "career" -> Career, any other title is left out.
 * Every note made here starts with PREFIX and is removed afterwards.
 *
 * Not e2e-testable: the order by newest note with ties (unit test in grouping.test.ts), and a
 * localStorage that throws or holds broken JSON (paneWidths.test.tsx).
 */
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

const API = 'http://127.0.0.1:8001/api'
const H = { 'X-LearningHub': '1' }
const FAKE = 'http://127.0.0.1:8002/v1'
const PREFIX = 'QC-lll'
const LABEL = 'LLL sorter'
const ANSWER_TIMEOUT = 20_000
const RUN = Date.now().toString(36)
let counter = 0
const uid = () => `${RUN}${counter++}`

interface ApiNote {
  id: string
  title: string
  node_id: string | null
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}
async function both(page: Page, name: string) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await shot(page, `${name}-${scheme}`)
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

async function mine(request: APIRequestContext): Promise<ApiNote[]> {
  const a = (await (await request.get(`${API}/notes`)).json()) as ApiNote[]
  const b = (await (await request.get(`${API}/notes?archived=true`)).json()) as ApiNote[]
  return [...a, ...b].filter((n) => n.title.startsWith(PREFIX))
}

test.afterEach(async ({ request }) => {
  for (const n of await mine(request)) await request.delete(`${API}/notes/${n.id}`, { headers: H })
  await request.put(`${API}/agents/note-sorter/provider`, {
    headers: H,
    data: { primary_provider_id: null, fallback_provider_id: null },
  })
  const providers = (await (await request.get(`${API}/ai-providers`)).json()) as Array<{ id: string; name: string }>
  for (const p of providers.filter((x) => x.name.startsWith(LABEL))) {
    await request.delete(`${API}/ai-providers/${p.id}`, { headers: H })
  }
})

async function assignSorter(request: APIRequestContext) {
  const res = await request.post(`${API}/ai-providers`, {
    headers: H,
    data: { name: `${LABEL} ${uid()}`, provider_type: 'local', model_name: 'fake-ok', base_url: FAKE, config: {} },
  })
  expect(res.status(), await res.text()).toBe(201)
  const provider = (await res.json()) as { id: string }
  const put = await request.put(`${API}/agents/note-sorter/provider`, {
    headers: H,
    data: { primary_provider_id: provider.id, fallback_provider_id: null },
  })
  expect(put.status(), await put.text()).toBe(200)
}

async function makeNote(request: APIRequestContext, title: string, node?: string): Promise<ApiNote> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>Body of ${title}.</p></body></html>`
  const res = await request.post(`${API}/notes/import`, {
    headers: H,
    multipart: { files: { name: `${title.replace(/\W+/g, '_')}.html`, mimeType: 'text/html', buffer: Buffer.from(html) } },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  let note = (await res.json()).results[0].note as ApiNote
  if (node) {
    const linked = await request.patch(`${API}/notes/${note.id}`, { headers: H, data: { node_id: node } })
    expect(linked.ok()).toBeTruthy()
    note = (await linked.json()) as ApiNote
  }
  return note
}

const listOf = (page: Page) => page.getByRole('complementary', { name: 'Learned items' })
const agentOf = (page: Page) => page.getByRole('complementary', { name: 'Agent' })
const centerOf = (page: Page) => page.getByRole('main', { name: 'Content' })
const region = (scope: Locator, name: string) => scope.getByRole('region', { name, exact: true })
const noteBtn = (scope: Locator, title: string) => scope.getByRole('button', { name: title, exact: true })

async function groupWithAi(page: Page) {
  await listOf(page).getByRole('button', { name: 'List actions' }).click()
  await page.getByRole('menu', { name: 'List actions' }).getByRole('menuitem', { name: 'Group with AI' }).click()
}

/** The top-level group names in list order (the Archived section is not a group). */
async function groupNames(page: Page): Promise<string[]> {
  const all = await listOf(page).getByRole('region').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
  return all.filter((n) => n !== 'Archived')
}

/** Notes: one linked to backend/caching (oldest), two Career, two Kubernetes, one loose; then grouped. */
async function seedGrouped(page: Page, request: APIRequestContext) {
  await assignSorter(request)
  const id = uid()
  const t = {
    linked: `${PREFIX} Cache TTL ${id}`,
    c1: `${PREFIX} Salary talk career ${id}`,
    c2: `${PREFIX} Promotion career ${id}`,
    k1: `${PREFIX} Pod limits kube ${id}`,
    k2: `${PREFIX} Helm charts kube ${id}`,
    other: `${PREFIX} Loose idea ${id}`,
  }
  await makeNote(request, t.linked, 'backend/caching')
  for (const title of [t.c1, t.c2, t.k1, t.k2, t.other]) await makeNote(request, title)
  await page.goto('/')
  await expect(listOf(page)).toBeVisible()
  await groupWithAi(page)
  await expect(noteBtn(region(listOf(page), 'Kubernetes'), t.k1)).toBeVisible({ timeout: ANSWER_TIMEOUT })
  return t
}

test.describe('Learned list groups and menus', () => {
  test('Unsorted is grouped by category: categories sit beside domains, Unsorted is last, no UNSORTED heading', async ({ page, request }) => {
    const t = await seedGrouped(page, request)
    const list = listOf(page)
    await expect(noteBtn(region(list, 'Career'), t.c1)).toBeVisible()
    await expect(noteBtn(region(list, 'Backend'), t.linked)).toBeVisible()
    await expect(noteBtn(region(list, 'Unsorted'), t.other)).toBeVisible()

    const names = await groupNames(page)
    expect(names.at(-1)).toBe('Unsorted')
    // The linked note is older than both categories' notes, so Backend comes after them.
    expect(names.indexOf('Kubernetes')).toBeGreaterThanOrEqual(0)
    expect(names.indexOf('Kubernetes')).toBeLessThan(names.indexOf('Backend'))
    expect(names.indexOf('Career')).toBeLessThan(names.indexOf('Backend'))
    // Categories are not nested in a section: no Unsorted heading inside them.
    await expect(region(list, 'Kubernetes').getByRole('heading', { name: 'Unsorted' })).toHaveCount(0)
    await expect(list.getByRole('heading', { name: 'Unsorted' })).toHaveCount(1)
    await expect(region(list, 'Kubernetes').getByRole('heading', { level: 3, name: 'Kubernetes' })).toBeVisible()
    await both(page, 'learned-list-layout-groups')

    // A linked note leaves its category group.
    await list.getByRole('button', { name: `More actions for ${t.k1}` }).click()
    await page.getByRole('menu', { name: 'Note actions' }).getByRole('menuitem', { name: 'Move to node' }).click()
    const dialog = page.getByRole('dialog', { name: 'Move to node' })
    await dialog.getByRole('combobox', { name: 'Destination node' }).selectOption('backend/redis')
    await dialog.getByRole('button', { name: 'Move' }).click()
    await expect(noteBtn(list.getByRole('group', { name: 'Backend > Redis' }), t.k1)).toBeVisible()
    await expect(noteBtn(region(list, 'Kubernetes'), t.k1)).toHaveCount(0)
    await expect(noteBtn(region(list, 'Kubernetes'), t.k2)).toBeVisible()
  })

  test('Rename a category group: the menu button shows only on hover or focus, Rename has Save and Cancel', async ({ page, request }) => {
    const t = await seedGrouped(page, request)
    const list = listOf(page)
    const more = list.getByRole('button', { name: 'More actions for group Kubernetes' })
    // Domain and Unsorted headings have no such menu.
    await expect(list.getByRole('button', { name: /^More actions for group (Backend|Unsorted)$/ })).toHaveCount(0)

    await page.mouse.move(0, 0)
    await expect(more).toHaveCSS('opacity', '0')
    await region(list, 'Kubernetes').getByRole('heading', { name: 'Kubernetes' }).hover()
    await expect(more).toHaveCSS('opacity', '1')
    await page.mouse.move(0, 0)
    await expect(more).toHaveCSS('opacity', '0')
    await more.focus()
    await expect(more).toHaveCSS('opacity', '1')
    await shot(page, 'learned-list-layout-group-menu')

    const name = `K8s ${uid()}`
    const form = list.getByRole('form', { name: 'Rename group Kubernetes' })
    const input = form.getByRole('textbox', { name: 'New name' })
    const open = async () => {
      await more.click()
      await page.getByRole('menu', { name: 'Group actions' }).getByRole('menuitem', { name: 'Rename' }).click()
    }
    await open()
    await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled()
    await input.fill(name)
    await form.getByRole('button', { name: 'Cancel' }).click()
    await expect(form).toHaveCount(0)
    await expect(noteBtn(region(list, 'Kubernetes'), t.k1)).toBeVisible()

    await open()
    await input.fill(name)
    await input.press('Escape')
    await expect(form).toHaveCount(0)
    await expect(region(list, name)).toHaveCount(0)

    await open()
    await input.fill(name)
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(noteBtn(region(list, name), t.k1)).toBeVisible()
    await expect(noteBtn(region(list, name), t.k2)).toBeVisible()
    await expect(region(list, 'Kubernetes')).toHaveCount(0)
  })

  test('Group unsorted notes with AI: the List actions menu item groups the notes, Unsorted keeps the rest', async ({ page, request }) => {
    await assignSorter(request)
    const id = uid()
    const titles = {
      k: [`${PREFIX} Pod kube ${id}`, `${PREFIX} Helm kube ${id}`],
      c: [`${PREFIX} Pay career ${id}`, `${PREFIX} Raise career ${id}`],
      other: `${PREFIX} Loose ${id}`,
    }
    for (const title of [...titles.k, ...titles.c, titles.other]) await makeNote(request, title)
    await page.goto('/')
    const list = listOf(page)
    await list.getByRole('button', { name: 'List actions' }).click()
    const menu = page.getByRole('menu', { name: 'List actions' })
    await expect(menu.getByRole('menuitem', { name: 'Group with AI' })).toBeEnabled()
    await shot(page, 'learned-list-layout-list-actions')
    await menu.getByRole('menuitem', { name: 'Group with AI' }).click()
    for (const title of titles.k) await expect(noteBtn(region(list, 'Kubernetes'), title)).toBeVisible({ timeout: ANSWER_TIMEOUT })
    for (const title of titles.c) await expect(noteBtn(region(list, 'Career'), title)).toBeVisible()
    await expect(noteBtn(region(list, 'Unsorted'), titles.other)).toBeVisible()
  })

  test('Nothing without a topic: the toolbar shows no List actions menu when every note has a topic', async ({ page, request }) => {
    await makeNote(request, `${PREFIX} Linked ${uid()}`, 'backend/caching')
    // The shared e2e database may hold notes of other files; show every note as linked.
    await page.route(/\/api\/notes(\?[^/]*)?$/, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const res = await route.fetch()
      const notes = (await res.json()) as ApiNote[]
      await route.fulfill({ response: res, json: notes.map((n) => ({ ...n, node_id: n.node_id ?? 'backend/caching' })) })
    })
    await page.goto('/')
    await expect(listOf(page).getByRole('searchbox', { name: 'Filter by title' })).toBeVisible()
    await expect(listOf(page).getByRole('button', { name: 'Import' })).toBeVisible()
    await expect(listOf(page).getByRole('button', { name: 'List actions' })).toHaveCount(0)
    await shot(page, 'learned-list-layout-no-list-actions')
  })

  test('Phone: the grouped list in the drawer', async ({ page, request }) => {
    await assignSorter(request)
    const id = uid()
    const kube = `${PREFIX} Pod kube ${id}`
    await makeNote(request, kube)
    await makeNote(request, `${PREFIX} Loose ${id}`)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Learned', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: 'Learned' })
    await expect(drawer).toBeVisible()
    await drawer.getByRole('button', { name: 'List actions' }).click()
    await page.getByRole('menu', { name: 'List actions' }).getByRole('menuitem', { name: 'Group with AI' }).click()
    await expect(noteBtn(region(drawer, 'Kubernetes'), kube)).toBeVisible({ timeout: ANSWER_TIMEOUT })
    await expect(drawer.getByRole('button', { name: 'More actions for group Kubernetes' })).toBeVisible()
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await shot(page, `learned-list-layout-phone-${scheme}`)
    }
    await page.emulateMedia({ colorScheme: 'light' })
  })
})

test.describe('Three-pane layout: resizable panes', () => {
  const width = async (loc: Locator) => Math.round((await loc.boundingBox())!.width)
  const leftHandle = (page: Page) => page.getByRole('separator', { name: 'Resize Learned list' })
  const rightHandle = (page: Page) => page.getByRole('separator', { name: 'Resize Agent panel' })

  async function drag(page: Page, handle: Locator, dx: number) {
    const box = (await handle.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx / 2, y, { steps: 5 })
    await page.mouse.move(x + dx, y, { steps: 5 })
    await page.mouse.up()
  }

  async function open(page: Page) {
    await page.goto('/')
    await expect(listOf(page)).toBeVisible()
    await expect(leftHandle(page)).toBeVisible()
    await expect(rightHandle(page)).toBeVisible()
  }

  test('Resize a side panel: dragging the left handle 100 px right widens it, narrows the center, and a reload keeps it', async ({ page }) => {
    await open(page)
    const [left0, center0] = [await width(listOf(page)), await width(centerOf(page))]
    await drag(page, leftHandle(page), 100)
    await expect.poll(() => width(listOf(page))).toBe(left0 + 100)
    expect(await width(centerOf(page))).toBe(center0 - 100)
    await expect(leftHandle(page)).toHaveAttribute('aria-valuenow', String(left0 + 100))
    await both(page, 'learned-list-layout-resized')

    await page.reload()
    await expect(leftHandle(page)).toBeVisible()
    await expect.poll(() => width(listOf(page))).toBe(left0 + 100)
  })

  test('Limits while resizing: the right panel stops at 640 px or where the center would drop under 360 px', async ({ page }) => {
    await open(page)
    await drag(page, rightHandle(page), -1000)
    await expect.poll(() => width(agentOf(page))).toBeLessThanOrEqual(640)
    expect(await width(agentOf(page))).toBeGreaterThanOrEqual(639)
    expect(await width(centerOf(page))).toBeGreaterThanOrEqual(360)
    await shot(page, 'learned-list-layout-right-max')

    // With the left panel at its widest, the center minimum is reached first.
    await rightHandle(page).dblclick()
    await leftHandle(page).focus()
    await page.keyboard.press('End')
    await expect.poll(() => width(listOf(page))).toBe(480)
    await drag(page, rightHandle(page), -1000)
    await expect.poll(() => width(centerOf(page))).toBeGreaterThanOrEqual(359)
    expect(await width(centerOf(page))).toBeLessThanOrEqual(361)
    expect(await width(agentOf(page))).toBeLessThan(640)
    await shot(page, 'learned-list-layout-center-min')
  })

  test('Keyboard and reset: ArrowRight twice grows the left panel by 32 px, a double-click restores the default', async ({ page }) => {
    await open(page)
    const left0 = await width(listOf(page))
    await leftHandle(page).focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => width(listOf(page))).toBe(left0 + 32)
    await expect(leftHandle(page)).toHaveAttribute('aria-valuenow', String(left0 + 32))
    await leftHandle(page).dblclick()
    await expect.poll(() => width(listOf(page))).toBe(left0)
  })

  test('Collapse a side panel: the center widens and the panel returns at the width it had', async ({ page }) => {
    await open(page)
    await leftHandle(page).focus()
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
    // The grid animates its columns: wait for the final width before measuring.
    const left = Number(await leftHandle(page).getAttribute('aria-valuenow'))
    await expect.poll(() => width(listOf(page))).toBe(left)
    const center = await width(centerOf(page))
    await listOf(page).getByRole('button', { name: 'Collapse learned list' }).click()
    await expect.poll(() => width(centerOf(page))).toBeGreaterThan(center)
    await page.getByRole('button', { name: 'Expand learned list' }).click()
    await expect.poll(() => width(listOf(page))).toBe(left)
    await expect.poll(() => width(centerOf(page))).toBe(center)
  })

  test('Phone: no resize handle is shown on a 390 px wide screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Learned', exact: true })).toBeVisible()
    await expect(page.getByRole('separator')).toHaveCount(0)
    await page.getByRole('button', { name: 'Learned', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Learned' })).toBeVisible()
    await expect(page.getByRole('separator')).toHaveCount(0)
    await shot(page, 'learned-list-layout-phone-no-handles')
  })
})
