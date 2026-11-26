/**
 * Spec checks for the change unsorted-categories (openspec/changes/unsorted-categories/specs):
 * Unsorted grouped by category, Group with AI (Note sorter agent), rename a group, the assistant
 * saving a note with a category, and the Note sorter listed in Settings > Agents.
 *
 * The provider is the fake OpenAI-compatible server (e2e/fake_llm.py): the sorter keywords of a
 * note title are "kube" -> Kubernetes, "career" -> Career, "sql" -> Databases, any other title is
 * left out (Other); "[[learn:<title>|<category>]]" makes the assistant save a note with a category.
 * Every note made here starts with PREFIX and is removed afterwards.
 *
 * Not e2e-testable (the fake sorter always answers well, and a second user needs a second session):
 * Unreadable answer, Limits, Another user's notes, Saved with a node (backend pytest covers them).
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const API = 'http://127.0.0.1:8001/api'
const H = { 'X-LearningHub': '1' }
const FAKE = 'http://127.0.0.1:8002/v1'
const PREFIX = 'QC-cat'
const LABEL = 'Sorter main'
const ANSWER_TIMEOUT = 20_000
const RUN = Date.now().toString(36)

let counter = 0
const uid = () => `${RUN}${counter++}`

interface ApiNote {
  id: string
  title: string
  node_id: string | null
  category: string | null
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

async function allNotes(request: APIRequestContext): Promise<ApiNote[]> {
  const a = (await (await request.get(`${API}/notes`)).json()) as ApiNote[]
  const b = (await (await request.get(`${API}/notes?archived=true`)).json()) as ApiNote[]
  return [...a, ...b]
}

const mine = async (request: APIRequestContext) => (await allNotes(request)).filter((n) => n.title.startsWith(PREFIX))

test.afterEach(async ({ request }) => {
  for (const n of await mine(request)) await request.delete(`${API}/notes/${n.id}`, { headers: H })
  for (const agent of ['assistant', 'note-sorter']) {
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

async function assignProvider(request: APIRequestContext, agents: string[]) {
  const res = await request.post(`${API}/ai-providers`, {
    headers: H,
    data: { name: `${LABEL} ${uid()}`, provider_type: 'local', model_name: 'fake-ok', base_url: FAKE, config: {} },
  })
  expect(res.status(), await res.text()).toBe(201)
  const provider = (await res.json()) as { id: string }
  for (const agent of agents) {
    const put = await request.put(`${API}/agents/${agent}/provider`, {
      headers: H,
      data: { primary_provider_id: provider.id, fallback_provider_id: null },
    })
    expect(put.status(), await put.text()).toBe(200)
  }
}

async function unsortedNote(request: APIRequestContext, title: string): Promise<ApiNote> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>Body of ${title}.</p></body></html>`
  const res = await request.post(`${API}/notes/import`, {
    headers: H,
    multipart: { files: { name: `${title.replace(/\W+/g, '_')}.html`, mimeType: 'text/html', buffer: Buffer.from(html) } },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  return (await res.json()).results[0].note as ApiNote
}

const listOf = (page: Page) => page.getByRole('complementary', { name: 'Learned items' })
const unsortedOf = (page: Page) => listOf(page).getByRole('region', { name: 'Unsorted' })
/** A category is a top-level group of its own (no Unsorted section around it). */
const groupOf = (page: Page, name: string) => listOf(page).getByRole('region', { name, exact: true })
/** Opens the toolbar's List actions menu and chooses Group with AI. */
async function chooseGroupWithAi(scope: ReturnType<typeof listOf> | ReturnType<Page['getByRole']>) {
  await scope.getByRole('button', { name: 'List actions' }).click()
  await scope.page().getByRole('menu', { name: 'List actions' }).getByRole('menuitem', { name: 'Group with AI' }).click()
}
/** Opens a category's More actions menu and chooses Rename. */
async function openRename(scope: ReturnType<typeof listOf>, name: string) {
  await scope.getByRole('button', { name: `More actions for group ${name}` }).click()
  await scope.page().getByRole('menu', { name: 'Group actions' }).getByRole('menuitem', { name: 'Rename' }).click()
}
const noteBtn = (scope: ReturnType<typeof groupOf>, title: string) => scope.getByRole('button', { name: title, exact: true })

/** Five unsorted notes: two Kubernetes, two Career, one the fake sorter leaves out. */
async function fiveNotes(request: APIRequestContext) {
  const id = uid()
  const t = {
    k1: `${PREFIX} Pod limits kube ${id}`,
    k2: `${PREFIX} Helm charts kube ${id}`,
    c1: `${PREFIX} Salary talk career ${id}`,
    c2: `${PREFIX} Promotion career ${id}`,
    other: `${PREFIX} Loose idea ${id}`,
  }
  for (const title of Object.values(t)) await unsortedNote(request, title)
  return { ...t, id }
}

async function groupWithAi(page: Page) {
  await page.goto('/')
  await expect(listOf(page)).toBeVisible()
  await chooseGroupWithAi(listOf(page))
}

test('Group unsorted notes with AI: Group with AI makes Kubernetes and Career, the rest stays in Unsorted, last', async ({ page, request }) => {
  await assignProvider(request, ['note-sorter'])
  const t = await fiveNotes(request)
  await groupWithAi(page)

  const kube = groupOf(page, 'Kubernetes')
  const career = groupOf(page, 'Career')
  const other = unsortedOf(page)
  await expect(noteBtn(kube, t.k1)).toBeVisible({ timeout: ANSWER_TIMEOUT })
  await expect(noteBtn(kube, t.k2)).toBeVisible()
  await expect(noteBtn(career, t.c1)).toBeVisible()
  await expect(noteBtn(career, t.c2)).toBeVisible()
  await expect(noteBtn(other, t.other)).toBeVisible()
  await expect(kube.getByRole('heading', { level: 3, name: 'Kubernetes' })).toBeVisible()
  await expect(kube.getByRole('heading', { name: 'Unsorted' })).toHaveCount(0)
  const names = await listOf(page).getByRole('region').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  expect(names.filter((n) => n !== 'Archived').at(-1)).toBe('Unsorted')

  const notes = await mine(request)
  expect(notes.find((n) => n.title === t.k1)?.category).toBe('Kubernetes')
  expect(notes.find((n) => n.title === t.c2)?.category).toBe('Career')
  expect(notes.find((n) => n.title === t.other)?.category).toBeNull()

  // The filter applies inside the sub-groups.
  const filter = listOf(page).getByRole('searchbox', { name: 'Filter by title' })
  await filter.fill(`Helm charts kube ${t.id}`)
  await expect(noteBtn(kube, t.k2)).toBeVisible()
  await expect(noteBtn(kube, t.k1)).toHaveCount(0)
  await filter.fill('')
  await both(page, 'unsorted-categories-list')
})

test('Group unsorted notes with AI: phone screenshot of the grouped Unsorted list', async ({ page, request }) => {
  await assignProvider(request, ['note-sorter'])
  const t = await fiveNotes(request)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Learned', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Learned' })
  await expect(drawer).toBeVisible()
  await chooseGroupWithAi(drawer)
  const kube = drawer.getByRole('region', { name: 'Kubernetes', exact: true })
  await expect(noteBtn(kube, t.k1)).toBeVisible({ timeout: ANSWER_TIMEOUT })
  await expect(noteBtn(drawer.getByRole('region', { name: 'Unsorted', exact: true }), t.other)).toBeVisible()
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await shot(page, `unsorted-categories-phone-${scheme}`)
  }
  await page.emulateMedia({ colorScheme: 'light' })
})

test('Group unsorted notes with AI: no provider shows an error and changes nothing', async ({ page, request }) => {
  await unsortedNote(request, `${PREFIX} Pod limits kube ${uid()}`)
  await groupWithAi(page)
  await expect(listOf(page).getByRole('alert')).toContainText(/provider/i, { timeout: ANSWER_TIMEOUT })
  await listOf(page).getByRole('button', { name: 'List actions' }).click()
  await expect(page.getByRole('menu', { name: 'List actions' }).getByRole('menuitem', { name: 'Group with AI' })).toBeEnabled()
  await page.keyboard.press('Escape')
  expect((await mine(request))[0].category).toBeNull()
  await shot(page, 'unsorted-categories-no-provider')
})

test('Unsorted is grouped by category: a linked note leaves its category group', async ({ page, request }) => {
  await assignProvider(request, ['note-sorter'])
  const t = await fiveNotes(request)
  await groupWithAi(page)
  const kube = groupOf(page, 'Kubernetes')
  await expect(noteBtn(kube, t.k1)).toBeVisible({ timeout: ANSWER_TIMEOUT })

  await listOf(page).getByRole('button', { name: `More actions for ${t.k1}` }).click()
  await page.getByRole('menu', { name: 'Note actions' }).getByRole('menuitem', { name: 'Move to node' }).click()
  const dialog = page.getByRole('dialog', { name: 'Move to node' })
  await dialog.getByRole('combobox', { name: 'Destination node' }).selectOption('backend/redis')
  await dialog.getByRole('button', { name: 'Move' }).click()
  await expect(dialog).toBeHidden()

  const redis = listOf(page).getByRole('group', { name: 'Backend > Redis' })
  await expect(noteBtn(redis, t.k1)).toBeVisible()
  await expect(noteBtn(kube, t.k1)).toHaveCount(0)
  await expect(noteBtn(kube, t.k2)).toBeVisible()
  await shot(page, 'unsorted-categories-moved')
})

test('Rename a category group: Save rules, Cancel and Escape leave it, Save renames', async ({ page, request }) => {
  await assignProvider(request, ['note-sorter'])
  const t = await fiveNotes(request)
  await groupWithAi(page)
  await expect(noteBtn(groupOf(page, 'Kubernetes'), t.k1)).toBeVisible({ timeout: ANSWER_TIMEOUT })

  const newName = `K8s ${uid()}`
  const form = () => listOf(page).getByRole('form', { name: 'Rename group Kubernetes' })
  const input = () => form().getByRole('textbox', { name: 'New name' })
  const save = () => form().getByRole('button', { name: 'Save' })
  const open = () => openRename(listOf(page), 'Kubernetes')

  await open()
  await expect(input()).toHaveValue('Kubernetes')
  await expect(save()).toBeDisabled()
  await input().fill('')
  await expect(save()).toBeDisabled()
  await input().fill('Kubernetes')
  await expect(save()).toBeDisabled()
  await input().fill('x'.repeat(41))
  await expect(save()).toBeDisabled()
  await input().fill(newName)
  await expect(save()).toBeEnabled()
  await shot(page, 'unsorted-categories-rename')

  // Cancel leaves it as it was.
  await form().getByRole('button', { name: 'Cancel' }).click()
  await expect(form()).toHaveCount(0)
  await expect(noteBtn(groupOf(page, 'Kubernetes'), t.k1)).toBeVisible()

  // Escape leaves it too.
  await open()
  await input().fill(newName)
  await input().press('Escape')
  await expect(form()).toHaveCount(0)
  await expect(noteBtn(groupOf(page, 'Kubernetes'), t.k1)).toBeVisible()
  expect((await mine(request)).find((n) => n.title === t.k1)?.category).toBe('Kubernetes')

  // Save renames it, with the same notes.
  await open()
  await input().fill(newName)
  await save().click()
  const renamed = groupOf(page, newName)
  await expect(noteBtn(renamed, t.k1)).toBeVisible()
  await expect(noteBtn(renamed, t.k2)).toBeVisible()
  await expect(groupOf(page, 'Kubernetes')).toHaveCount(0)
  expect((await mine(request)).find((n) => n.title === t.k2)?.category).toBe(newName)
  await shot(page, 'unsorted-categories-renamed')
})

test('Unsorted is grouped by category: a category name with markup is shown as text', async ({ page, request }) => {
  const dialogs: string[] = []
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void d.dismiss()
  })
  await assignProvider(request, ['note-sorter'])
  const title = `${PREFIX} Query sql ${uid()}`
  await unsortedNote(request, title)
  await groupWithAi(page)
  await expect(noteBtn(groupOf(page, 'Databases'), title)).toBeVisible({ timeout: ANSWER_TIMEOUT })

  const markup = '<img src=x onerror=alert(1)>'
  await openRename(listOf(page), 'Databases')
  const form = listOf(page).getByRole('form', { name: 'Rename group Databases' })
  await form.getByRole('textbox', { name: 'New name' }).fill(markup)
  await form.getByRole('button', { name: 'Save' }).click()
  const group = groupOf(page, markup)
  await expect(noteBtn(group, title)).toBeVisible()
  await expect(group.getByRole('heading', { level: 3 })).toHaveText(markup)
  await expect(listOf(page).locator('img')).toHaveCount(0)
  await shot(page, 'unsorted-categories-markup')
  expect(dialogs).toEqual([])
})

test('A note the assistant saves without a topic gets a category: a second save in other letter case joins the group', async ({ page, request }) => {
  await assignProvider(request, ['assistant'])
  await page.goto('/')
  const agent = page.getByRole('complementary', { name: 'Agent' })
  const box = agent.getByRole('textbox', { name: 'Message the agent' })
  const log = agent.getByRole('log', { name: 'Conversation' })
  await expect(box).toBeVisible()

  const id = uid()
  const category = `QCgroup ${id}`
  const first = `${PREFIX} First topic ${id}`
  const second = `${PREFIX} Second topic ${id}`
  await box.fill(`explain it [[learn:${first}|${category}]]`)
  await box.press('Enter')
  await expect(log.getByText(`LEARN saved ${first}`)).toBeVisible({ timeout: ANSWER_TIMEOUT })
  await box.fill(`explain more [[learn:${second}|${category.toLowerCase()}]]`)
  await box.press('Enter')
  await expect(log.getByText(`LEARN saved ${second}`)).toBeVisible({ timeout: ANSWER_TIMEOUT })

  const notes = await mine(request)
  expect(notes.find((n) => n.title === first)?.category).toBe(category)
  expect(notes.find((n) => n.title === second)?.category).toBe(category)

  const group = groupOf(page, category)
  await expect(group.getByRole('button', { name: new RegExp(`^${first}`) })).toBeVisible()
  await expect(group.getByRole('button', { name: new RegExp(`^${second}`) })).toBeVisible()
  await expect(groupOf(page, category.toLowerCase())).toHaveCount(0)
  await both(page, 'unsorted-categories-assistant')
})

test('Note sorter agent: listed in Settings > Agents with a provider assignment', async ({ page, request }) => {
  await assignProvider(request, [])
  await page.goto('/#/settings')
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Agents' }).click()
  const card = page
    .getByRole('region', { name: 'Agents' })
    .getByRole('region', { name: 'Agent providers' })
    .getByRole('article', { name: 'Note sorter' })
  await expect(card).toBeVisible()
  await expect(card.getByRole('combobox').first()).toBeVisible()
  await shot(page, 'unsorted-categories-settings')
})
