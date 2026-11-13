/**
 * Spec checks for the change learned-list-curation: list actions (rename, move, archive),
 * the Archived section, the archived note page, archive/restore in the notes API,
 * archived notes ignored by node queries, map markers and home progress, and the
 * sixth home card. Data is created through the API with unique titles and removed afterwards.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const API = 'http://127.0.0.1:8001/api'
const H = { 'X-LearningHub': '1' }
const PREFIX = 'QC-cur'
let seq = 0

interface ApiNote {
  id: string
  title: string
  node_id: string | null
  archived_at?: string | null
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  return errors
}

function uniqueTitle(tag: string) {
  seq += 1
  return `${PREFIX} ${tag} ${Date.now().toString(36)}${seq}`
}

/** Import one HTML note through the API, optionally linked to a node. */
async function createNote(request: APIRequestContext, tag: string, node: string | null = null): Promise<ApiNote> {
  const title = uniqueTitle(tag)
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${title}</p></body></html>`
  const res = await request.post(`${API}/notes/import`, {
    headers: H,
    multipart: { files: { name: `${title.replace(/ /g, '_')}.html`, mimeType: 'text/html', buffer: Buffer.from(html) } },
  })
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  expect(body.results[0].outcome).toBe('created')
  let note: ApiNote = body.results[0].note
  if (node) note = await patch(request, note.id, { node_id: node })
  return note
}

async function patch(request: APIRequestContext, id: string, data: Record<string, unknown>): Promise<ApiNote> {
  const res = await request.patch(`${API}/notes/${id}`, { headers: H, data })
  expect(res.ok()).toBeTruthy()
  return res.json()
}

async function listNotes(request: APIRequestContext, query = ''): Promise<ApiNote[]> {
  const res = await request.get(`${API}/notes${query}`)
  expect(res.ok()).toBeTruthy()
  return res.json()
}

test.afterEach(async ({ request }) => {
  const all = [...(await listNotes(request)), ...(await listNotes(request, '?archived=true'))]
  for (const n of all) if (n.title.startsWith(PREFIX)) await request.delete(`${API}/notes/${n.id}`, { headers: H })
})

const listOf = (page: Page) => page.getByRole('complementary', { name: 'Learned items' })

async function openMenu(page: Page, title: string, item: 'Rename' | 'Move to node' | 'Archive') {
  await listOf(page).getByRole('button', { name: `More actions for ${title}` }).click()
  await page.getByRole('menu', { name: 'Note actions' }).getByRole('menuitem', { name: item }).click()
}

async function expandArchived(page: Page) {
  const region = listOf(page).getByRole('region', { name: 'Archived' })
  const toggle = region.getByRole('button', { name: /^Archived \(/ })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  return region
}

test('Learned-items list: rename from the list with Enter, Escape leaves the title', async ({ page, request }) => {
  const errors = watchErrors(page)
  const note = await createNote(request, 'rename', 'backend/redis')
  await page.goto('/')
  const list = listOf(page)
  await expect(list.getByRole('button', { name: note.title, exact: true })).toBeVisible()

  await openMenu(page, note.title, 'Rename')
  const box = list.getByRole('textbox', { name: 'New title' })
  await box.fill(`${note.title} X`)
  await box.press('Escape')
  await expect(list.getByRole('button', { name: note.title, exact: true })).toBeVisible()
  await expect(list.getByRole('textbox', { name: 'New title' })).toHaveCount(0)

  await openMenu(page, note.title, 'Rename')
  const newTitle = `${PREFIX} Redis TTL ${Date.now().toString(36)}`
  const box2 = list.getByRole('textbox', { name: 'New title' })
  await box2.fill(newTitle)
  await shot(page, 'curation-rename')
  await box2.press('Enter')
  await expect(list.getByRole('button', { name: newTitle, exact: true })).toBeVisible()
  await expect(list.getByRole('button', { name: note.title, exact: true })).toHaveCount(0)
  expect((await listNotes(request)).some((n) => n.title === newTitle)).toBeTruthy()
  expect(errors).toEqual([])
})

test('Learned-items list: move from the list to a node and back to Unsorted', async ({ page, request }) => {
  const errors = watchErrors(page)
  const note = await createNote(request, 'move')
  await page.goto('/')
  const list = listOf(page)
  const unsorted = list.getByRole('region', { name: 'Unsorted' })
  await expect(unsorted.getByRole('button', { name: note.title, exact: true })).toBeVisible()

  await openMenu(page, note.title, 'Move to node')
  const dialog = page.getByRole('dialog', { name: 'Move to node' })
  const picker = dialog.getByRole('combobox', { name: 'Destination node' })
  await expect(picker.locator('option', { hasText: 'Unsorted' })).toHaveCount(1)
  await picker.selectOption('backend/redis')
  await shot(page, 'curation-move-dialog')
  await dialog.getByRole('button', { name: 'Move' }).click()
  await expect(dialog).toBeHidden()
  const redis = list.getByRole('group', { name: 'Backend > Redis' })
  await expect(redis.getByRole('button', { name: note.title, exact: true })).toBeVisible()
  await expect(unsorted.getByRole('button', { name: note.title, exact: true })).toHaveCount(0)

  // Cancel changes nothing; Unsorted is a valid destination.
  await openMenu(page, note.title, 'Move to node')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(redis.getByRole('button', { name: note.title, exact: true })).toBeVisible()
  await openMenu(page, note.title, 'Move to node')
  await dialog.getByRole('combobox', { name: 'Destination node' }).selectOption({ label: 'Unsorted' })
  await dialog.getByRole('button', { name: 'Move' }).click()
  await expect(unsorted.getByRole('button', { name: note.title, exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('Learned-items list: archive, expand, restore, then delete only after confirmation', async ({ page, request }) => {
  const errors = watchErrors(page)
  const keep = await createNote(request, 'keep', 'backend/redis')
  const note = await createNote(request, 'arch', 'backend/redis')
  await page.goto('/')
  const list = listOf(page)
  const region = list.getByRole('region', { name: 'Archived' })
  const redis = list.getByRole('group', { name: 'Backend > Redis' })
  await expect(region).toHaveCount(0) // absent when nothing is archived

  await openMenu(page, note.title, 'Archive')
  await expect(list.getByRole('status').filter({ hasText: `Archived ‘${note.title}’.` })).toBeVisible()
  await expect(list.getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
  await expect(redis.getByRole('button', { name: note.title, exact: true })).toHaveCount(0)
  await expect(redis.getByRole('button', { name: keep.title, exact: true })).toBeVisible()

  const toggle = region.getByRole('button', { name: 'Archived (1)' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(region.getByRole('button', { name: note.title, exact: true })).toHaveCount(0)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(region.getByRole('button', { name: note.title, exact: true })).toBeVisible()
  await shot(page, 'curation-archived-section')

  // Restore
  await region.getByRole('button', { name: `Restore ${note.title}` }).click()
  await expect(redis.getByRole('button', { name: note.title, exact: true })).toBeVisible()
  await expect(region).toHaveCount(0)

  // Archive again, then delete with confirmation (cancel first).
  await openMenu(page, note.title, 'Archive')
  await expandArchived(page)
  await region.getByRole('button', { name: `Delete ${note.title}` }).click()
  const confirm = region.getByRole('alertdialog', { name: `Confirm delete ${note.title}` })
  await expect(confirm).toBeVisible()
  await shot(page, 'curation-confirm-delete')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toBeHidden()
  expect((await listNotes(request, '?archived=true')).some((n) => n.id === note.id)).toBeTruthy()
  await region.getByRole('button', { name: `Delete ${note.title}` }).click()
  await region.getByRole('button', { name: 'Yes, delete' }).click()
  await expect(list.getByText(note.title, { exact: true })).toHaveCount(0)
  expect((await request.get(`${API}/notes/${note.id}`)).status()).toBe(404)
  expect(errors).toEqual([])
})

test('Learned-items list: Undo after archiving puts the note back', async ({ page, request }) => {
  const note = await createNote(request, 'revert', 'backend/redis')
  await page.goto('/')
  const list = listOf(page)
  await openMenu(page, note.title, 'Archive')
  await list.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(list.getByRole('group', { name: 'Backend > Redis' }).getByRole('button', { name: note.title, exact: true })).toBeVisible()
  expect((await listNotes(request, '?archived=true')).some((n) => n.id === note.id)).toBeFalsy()
})

test('Read a note: Edit page, Export PDF, Archive and Delete are in the More actions menu, which works with the keyboard', async ({
  page,
  request,
}) => {
  const errors = watchErrors(page)
  const note = await createNote(request, 'menu', 'backend/redis')
  await page.goto(`/#/note/${note.id}`)
  const article = page.getByRole('article', { name: `Note: ${note.title}` })
  const header = article.locator('header')
  const more = article.getByRole('button', { name: 'More actions' })
  const menu = article.getByRole('menu', { name: 'Note actions' })
  const items = menu.getByRole('menuitem')

  // Scenario: More actions menu - none of the four is a separate control in the header.
  await expect(more).toBeVisible()
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  for (const name of ['Edit page', 'Export PDF', 'Archive', 'Delete']) {
    await expect(header.getByRole('button', { name, exact: true })).toHaveCount(0)
    await expect(header.getByRole('link', { name, exact: true })).toHaveCount(0)
  }
  await more.click()
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await expect(items).toHaveText(['Edit page', 'Export PDF', 'Archive', 'Delete'])
  // The menu hangs under its button, inside the window.
  const box = (await menu.boundingBox())!
  const button = (await more.boundingBox())!
  const width = page.viewportSize()!.width
  expect(box.y).toBeGreaterThanOrEqual(button.y + button.height)
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(width)
  await page.emulateMedia({ colorScheme: 'light' })
  await shot(page, 'note-actions-menu')
  await page.emulateMedia({ colorScheme: 'dark' })
  await shot(page, 'note-actions-menu-dark')
  await page.emulateMedia({ colorScheme: 'light' })

  // Scenario: Menu with the keyboard.
  await expect(items.nth(0)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(items.nth(1)).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(items.nth(3)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(more).toBeFocused()

  // A click outside closes it, and so does a click into the note's own page.
  await more.click()
  await article.getByRole('textbox', { name: 'Note title' }).click()
  await expect(menu).toHaveCount(0)
  await more.click()
  await expect(menu).toBeVisible()
  await page.locator(`iframe[title="Original page: ${note.title}"]`).click()
  await expect(menu).toHaveCount(0)

  // Scenario: Choosing an action closes the menu.
  await more.click()
  await menu.getByRole('menuitem', { name: 'Archive' }).click()
  await expect(menu).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'This note is archived.' })).toBeVisible()
  await more.click()
  await expect(items).toHaveText(['Edit page', 'Export PDF', 'Restore', 'Delete'])
  await menu.getByRole('menuitem', { name: 'Restore' }).click()
  await expect(page.getByText('This note is archived.')).toHaveCount(0)

  // Scenario: Menu while editing the page.
  await more.click()
  await menu.getByRole('menuitem', { name: 'Edit page' }).click()
  await expect(page.getByRole('region', { name: 'Edit page' })).toBeVisible()
  await more.click()
  await expect(items).toHaveText(['Archive', 'Delete'])
  await page.keyboard.press('Escape')
  await page.getByRole('region', { name: 'Edit page' }).getByRole('button', { name: 'Cancel' }).click()

  // Scenario: Delete needs confirmation - asked in the header, after the menu closed.
  await more.click()
  await menu.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(menu).toHaveCount(0)
  const confirm = page.getByRole('alertdialog', { name: 'Confirm delete' })
  await expect(confirm).toBeVisible()
  expect((await listNotes(request)).some((n) => n.id === note.id)).toBeTruthy()
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toHaveCount(0)
  await more.click()
  await menu.getByRole('menuitem', { name: 'Delete' }).click()
  await confirm.getByRole('button', { name: 'Yes, delete' }).click()
  await expect(article).toHaveCount(0)
  expect((await listNotes(request)).some((n) => n.id === note.id)).toBeFalsy()
  expect(errors).toEqual([])
})

test('Read a note: archived note page says so and Restore puts it back', async ({ page, request }) => {
  const errors = watchErrors(page)
  const note = await createNote(request, 'page', 'backend/redis')
  await page.goto('/')
  const list = listOf(page)
  const article = page.getByRole('article', { name: `Note: ${note.title}` })

  // Archive in the header's More actions menu archives an active note.
  await list.getByRole('button', { name: note.title, exact: true }).click()
  const more = article.getByRole('button', { name: 'More actions' })
  const menu = article.getByRole('menu', { name: 'Note actions' })
  await more.click()
  await expect(menu.getByRole('menuitem', { name: 'Archive' })).toBeVisible()
  await expect(page.getByText('This note is archived.')).toHaveCount(0)
  await menu.getByRole('menuitem', { name: 'Archive' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'This note is archived.' })).toBeVisible()
  await shot(page, 'curation-note-archived')
  await more.click()
  await expect(menu.getByRole('menuitem', { name: 'Restore', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  // Open it from the Archived section after a reload, then restore from the banner.
  await page.reload()
  await (await expandArchived(page)).getByRole('button', { name: note.title, exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'This note is archived.' })).toBeVisible()
  await page.getByRole('button', { name: 'Restore this note' }).click()
  await expect(page.getByText('This note is archived.')).toHaveCount(0)
  await expect(list.getByRole('group', { name: 'Backend > Redis' }).getByRole('button', { name: note.title, exact: true })).toBeVisible()
  expect((await listNotes(request)).some((n) => n.id === note.id)).toBeTruthy()
  expect(errors).toEqual([])
})

test('List, read, rename and delete notes: archive and restore through the API keep title and link', async ({ request }) => {
  const note = await createNote(request, 'api', 'backend/redis')
  const archived = await patch(request, note.id, { archived: true })
  expect(archived.archived_at).toBeTruthy()
  expect(archived.title).toBe(note.title)
  expect(archived.node_id).toBe('backend/redis')
  expect((await listNotes(request)).some((n) => n.id === note.id)).toBeFalsy()
  const arch = await listNotes(request, '?archived=true')
  expect(arch.some((n) => n.id === note.id)).toBeTruthy()
  expect(arch.every((n) => !!n.archived_at)).toBeTruthy()
  expect((await request.get(`${API}/notes/${note.id}/original`)).ok()).toBeTruthy()

  const restored = await patch(request, note.id, { archived: false })
  expect(restored.archived_at ?? null).toBeNull()
  expect(restored.node_id).toBe('backend/redis')
  expect((await listNotes(request)).some((n) => n.id === note.id)).toBeTruthy()
  expect((await listNotes(request, '?archived=true')).some((n) => n.id === note.id)).toBeFalsy()
})

test('Query notes by node: archived notes are left out of node, unsorted and count queries', async ({ request }) => {
  const a = await createNote(request, 'q1', 'backend/auth')
  const b = await createNote(request, 'q2', 'backend/auth')
  const u = await createNote(request, 'q3')
  const counts = async () => (await (await request.get(`${API}/domains/backend/counts`)).json()).counts
  const ids = async (q: string) => (await listNotes(request, q)).map((n) => n.id)
  const before = (await counts()).auth ?? 0
  expect(before).toBeGreaterThanOrEqual(2)

  await patch(request, a.id, { archived: true })
  await patch(request, u.id, { archived: true })
  const node = await ids('?node=backend/auth')
  expect(node).toContain(b.id)
  expect(node).not.toContain(a.id)
  expect(await ids('?unsorted=true')).not.toContain(u.id)
  expect((await counts()).auth).toBe(before - 1)

  await patch(request, b.id, { archived: true })
  expect((await counts()).auth ?? 0).toBe(before - 2)
  await patch(request, a.id, { archived: false })
  expect((await counts()).auth).toBe(before - 1)
})

test('Roadmap map markers ignore archived notes', async ({ page, request }) => {
  const errors = watchErrors(page)
  const note = await createNote(request, 'marker', 'backend/auth')
  await page.goto('/#/roadmap/backend')
  const node = page.getByTestId('node-backend/auth')
  await expect(node.getByLabel(/^\d+ notes$/)).toBeVisible()
  await shot(page, 'curation-marker-on')
  await patch(request, note.id, { archived: true })
  await page.reload()
  await expect(node).toBeVisible()
  await expect(node.getByLabel(/^\d+ notes$/)).toHaveCount(0)
  await shot(page, 'curation-marker-off')
  expect(errors).toEqual([])
})

test('Home page: six cards including AI Engineer, archived notes do not count as progress', async ({ page, request }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  const home = page.getByRole('region', { name: 'Home' })
  await expect(home.getByRole('link')).toHaveCount(6)
  await expect(home.getByRole('link').locator('h2')).toHaveText([
    'Frontend',
    'Backend',
    'DevOps',
    'QA',
    'Data Engineer',
    'AI Engineer',
  ])
  const text = (await home.getByRole('link', { name: /^DevOps/ }).textContent()) ?? ''
  const total = Number(/\/ (\d+) topics/.exec(text)?.[1])
  expect(total).toBeGreaterThan(0)
  await expect(home.getByRole('link', { name: /^AI Engineer/ })).toContainText(/\/ \d+ topics/)
  await shot(page, 'curation-home-six')

  const aws = await createNote(request, 'aws', 'devops/aws')
  await createNote(request, 'cloud', 'devops/cloud')
  await page.goto('/')
  await expect(home.getByRole('link', { name: /^DevOps/ })).toContainText(`2 / ${total} topics`)
  await patch(request, aws.id, { archived: true })
  await page.reload()
  await expect(home.getByRole('link', { name: /^DevOps/ })).toContainText(`1 / ${total} topics`)
  await shot(page, 'curation-home-progress')
  expect(errors).toEqual([])
})

test('Learned-items list: the filter stays on top and uncovered while the list scrolls', async ({ page, request }) => {
  const nodes = ['backend/caching', 'devops/docker', 'frontend/html', null]
  for (let i = 0; i < 30; i++) await createNote(request, `scroll ${i}`, nodes[i % nodes.length])
  const errors = watchErrors(page)
  await page.goto('/#/')
  const list = listOf(page)
  const filter = list.getByRole('searchbox', { name: 'Filter by title' })
  await expect(filter).toBeVisible()
  const scroller = list.locator('.learned-list')
  const before = await filter.boundingBox()

  for (const where of ['middle', 'bottom']) {
    await scroller.evaluate((el, w) => {
      el.scrollTop = w === 'bottom' ? el.scrollHeight : el.scrollHeight / 2
    }, where)
    // The list really scrolled, so rows pass under the filter bar.
    expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
    await expect(filter).toBeVisible()
    const box = (await filter.boundingBox())!
    // Pinned at the same place as before scrolling.
    expect(Math.abs(box.y - before!.y)).toBeLessThan(2)
    // Nothing is painted over the filter: the topmost element at its centre is the input itself.
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const topmost = await page.evaluate(
      `(() => { const e = document.elementFromPoint(${cx}, ${cy}); return e ? e.getAttribute('aria-label') : null })()`,
    )
    expect(topmost, `filter covered after scrolling to the ${where}`).toBe('Filter by title')
    // The row just under the bar is not visible through it either (top edge of the bar).
    const edge = await page.evaluate(
      `(() => { const e = document.elementFromPoint(${box.x + 4}, ${box.y - 4}); return !!(e && e.closest('.note-item')) })()`,
    )
    expect(edge, 'a note row shows above the filter').toBe(false)
  }
  await filter.fill('scroll 29')
  await expect(list.getByRole('button', { name: /^QC-cur scroll 29 / })).toBeVisible()
  await page.screenshot({ path: 'e2e-results/screens/learned-filter-sticky.png' })
  expect(errors).toEqual([])
})
