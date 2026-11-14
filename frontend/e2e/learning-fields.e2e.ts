/**
 * Spec checks for the change learning-fields (openspec/changes/learning-fields/specs):
 * learning-fields (fields, areas, topics, draft with the agent, publishing), home-page (tabs per
 * field) and roadmap-catalog (an own area is a domain; another user's private area is unknown).
 *
 * Runs signed in as the admin owner. The member for the publish checks is invited through the
 * API and works in a fresh browser context. Everything made here (fields with their areas and
 * topics, notes, providers, the member) carries the STAMP and is removed in afterEach/afterAll.
 * The "draft with agent" check relies on e2e/fake_llm.py: the outline agent (the request offers
 * propose_topics) gets one propose_topics call for the area named in the message.
 *
 * Run by the `app` project (desktop) and, for the phone test only, the `phone` project.
 */
import { expect as baseExpect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { OWNER_STATE } from '../playwright.config.ts'
import { latestOutboxToken, nextOutboxToken } from './outbox.ts'

test.describe.configure({ mode: 'serial', timeout: 120_000 })
const expect = baseExpect.configure({ timeout: 15_000 })

const API = 'http://127.0.0.1:8001'
const APP = 'http://127.0.0.1:5174'
const FAKE = 'http://127.0.0.1:8002'
const H = { 'X-LearningHub': '1' }
const SIGNED_OUT = { cookies: [], origins: [] }
const STAMP = Date.now().toString(36)
const PREFIX = 'QC-fields'
const LABEL = `${PREFIX} provider`
const MEMBER = { email: `fields-member-${STAMP}@example.test`, password: 'e2e-member-password-1', name: 'Fields Member' }

interface ApiField {
  id: string
  title: string
  published: boolean
  editable: boolean
  areas: Array<{ id: string; title: string; editable: boolean }>
}

const cloudTitle = (n: number) => `${PREFIX} Cloud ${STAMP}${n}`
const slugOf = (name: string) => `${name}-${STAMP}`

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

async function shotBoth(page: Page, name: string) {
  await page.emulateMedia({ colorScheme: 'light' })
  await shot(page, `${name}-light`)
  await page.emulateMedia({ colorScheme: 'dark' })
  await shot(page, `${name}-dark`)
  await page.emulateMedia({ colorScheme: 'light' })
}

/** The visible fields (own, published, IT) as the API lists them. */
async function listFields(request: APIRequestContext): Promise<ApiField[]> {
  const res = await request.get(`${API}/api/fields`)
  expect(res.status()).toBe(200)
  return res.json()
}

async function makeField(request: APIRequestContext, title: string): Promise<ApiField> {
  const res = await request.post(`${API}/api/fields`, { headers: H, data: { title } })
  expect(res.status(), await res.text()).toBe(201)
  return res.json()
}

async function makeArea(request: APIRequestContext, fieldId: string, slug: string, title: string) {
  const res = await request.post(`${API}/api/fields/${fieldId}/areas`, { headers: H, data: { slug, title } })
  expect(res.status(), await res.text()).toBe(201)
}

const TOPICS = [
  { slug: 'iam', title: 'IAM', description: null, parent: null },
  { slug: 'ec2', title: 'EC2', description: null, parent: null },
]

async function putTopics(request: APIRequestContext, area: string, topics: unknown[] = TOPICS) {
  const res = await request.put(`${API}/api/areas/${area}/topics`, { headers: H, data: { topics } })
  expect(res.status(), await res.text()).toBe(200)
}

async function topicSlugs(request: APIRequestContext, area: string): Promise<string[]> {
  const res = await request.get(`${API}/api/domains/${area}/roadmap`)
  expect(res.status()).toBe(200)
  return ((await res.json()) as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id)
}

/** Imports a small HTML note and links it to `nodeId`. */
async function makeNote(request: APIRequestContext, title: string, nodeId: string | null = null) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>QC fields note</p></body></html>`
  const res = await request.post(`${API}/api/notes/import`, {
    headers: H,
    multipart: { files: { name: `${title.replace(/ /g, '_')}.html`, mimeType: 'text/html', buffer: Buffer.from(html) } },
  })
  expect(res.status(), await res.text()).toBe(200)
  const note = ((await res.json()) as { results: Array<{ note: { id: string } }> }).results[0].note
  if (nodeId) {
    const linked = await request.patch(`${API}/api/notes/${note.id}`, { headers: H, data: { node_id: nodeId } })
    expect(linked.status(), await linked.text()).toBe(200)
  }
  return note.id
}

async function deleteNotes(request: APIRequestContext) {
  const res = await request.get(`${API}/api/notes`)
  if (res.status() !== 200) return
  const notes = (await res.json()) as Array<{ id: string; title: string }>
  for (const n of notes.filter((x) => x.title.startsWith(PREFIX))) {
    await request.delete(`${API}/api/notes/${n.id}`, { headers: H })
  }
}

async function removeProviders(request: APIRequestContext) {
  await request.put(`${API}/api/agents/outline/provider`, {
    headers: H,
    data: { primary_provider_id: null, fallback_provider_id: null },
  })
  const list = (await (await request.get(`${API}/api/ai-providers`)).json()) as Array<{ id: string; name: string }>
  for (const p of list.filter((x) => x.name.startsWith(LABEL))) {
    await request.delete(`${API}/api/ai-providers/${p.id}`, { headers: H })
  }
}

async function deleteMyFields(request: APIRequestContext) {
  const fields = (await listFields(request)).filter((f) => f.title.startsWith(PREFIX) && f.editable)
  for (const f of fields) await request.delete(`${API}/api/fields/${f.id}`, { headers: H })
}

async function cleanOwner(request: APIRequestContext) {
  await deleteNotes(request)
  await deleteMyFields(request)
  await removeProviders(request)
}

const member: { context: BrowserContext | null } = { context: null }

test.beforeAll(async ({ playwright }) => {
  const admin = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    await cleanOwner(admin)
  } finally {
    await admin.dispose()
  }
})

test.afterEach(async ({ request }) => {
  await cleanOwner(request)
})

test.afterAll(async ({ playwright }) => {
  test.setTimeout(120_000)
  const admin = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    await cleanOwner(admin)
    const users = (await (await admin.get('/api/admin/users')).json()) as Array<{ id: string; email: string }>
    const found = users.find((u) => u.email === MEMBER.email)
    if (found) await admin.delete(`/api/admin/users/${found.id}`, { headers: H, data: { confirm_email: MEMBER.email } })
    const pending = (await (await admin.get('/api/admin/invitations')).json()) as Array<{ id: string; email: string }>
    for (const i of pending.filter((x) => x.email === MEMBER.email)) {
      await admin.delete(`/api/admin/invitations/${i.id}`, { headers: H })
    }
  } finally {
    await admin.dispose()
    await member.context?.close()
  }
})

test.beforeEach(({}, testInfo) => {
  const isPhoneTest = testInfo.title.startsWith('phone:')
  test.skip(testInfo.project.name === 'phone' ? !isPhoneTest : isPhoneTest, 'phone test runs in the phone project only')
})

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Fields' })
const fieldPanel = (page: Page) => page.getByRole('tabpanel')

/** Opens the home page on the given field's tab. */
async function openField(page: Page, title: string) {
  await page.goto('/')
  await expect(tabs(page)).toBeVisible()
  await tabs(page).getByRole('tab', { name: title, exact: true }).click()
  await expect(tabs(page).getByRole('tab', { name: title, exact: true })).toHaveAttribute('aria-selected', 'true')
}

async function openAreaMap(page: Page, slug: string) {
  await page.goto(`/#/roadmap/${slug}`)
}

test('IT tab only: a user without fields sees the IT tab with the six role cards and New field', async ({ page, request }) => {
  const own = (await listFields(request)).filter((f) => f.id !== 'it')
  expect(own, 'the owner starts without fields').toHaveLength(0)
  await page.goto('/')
  await expect(tabs(page).getByRole('tab')).toHaveText(['IT'])
  await expect(fieldPanel(page).getByRole('heading', { level: 2 })).toHaveCount(6)
  await expect(page.getByRole('button', { name: 'New field' })).toBeVisible()
})

test('New field and area: the Cloud tab gets an AWS card that opens its map; Cancel closes the form', async ({ page }) => {
  const title = cloudTitle(1)
  const slug = slugOf('aws')
  await page.goto('/')
  await page.getByRole('button', { name: 'New field' }).click()
  const form = page.getByRole('form', { name: 'New field' })
  await form.getByLabel('Field name').fill(title)
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form).toHaveCount(0)
  await expect(tabs(page).getByRole('tab', { name: title, exact: true })).toHaveAttribute('aria-selected', 'true')

  await page.getByRole('button', { name: 'New area' }).click()
  const areaForm = page.getByRole('form', { name: 'New area' })
  await areaForm.getByLabel('Area title').fill('AWS')
  await areaForm.getByLabel('Slug').fill(slug)
  await areaForm.getByRole('button', { name: 'Save' }).click()
  await expect(areaForm).toHaveCount(0)
  const card = fieldPanel(page).getByRole('link', { name: /AWS/ })
  await expect(card).toBeVisible()
  await shotBoth(page, 'learning-fields-home-tabs')

  await card.click()
  await expect(page).toHaveURL(new RegExp(`#/roadmap/${slug}$`))
  await expect(page.getByRole('tablist', { name: 'Domains' }).getByRole('tab', { name: 'AWS', selected: true })).toBeVisible()
  await expect(page.getByText('This area has no topics yet.')).toBeVisible()

  // A rename form can be cancelled without changing anything.
  await page.goto('/')
  await tabs(page).getByRole('tab', { name: title, exact: true }).click()
  await page.getByRole('button', { name: 'New area' }).click()
  await page.getByRole('form', { name: 'New area' }).getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('form', { name: 'New area' })).toHaveCount(0)
})

test('Slug taken: a built-in id and another area slug are refused with a message', async ({ page, request }) => {
  const title = cloudTitle(2)
  const field = await makeField(request, title)
  const taken = slugOf('azure')
  await makeArea(request, field.id, taken, 'Azure')
  await openField(page, title)

  for (const slug of ['backend', taken]) {
    await page.getByRole('button', { name: 'New area' }).click()
    const form = page.getByRole('form', { name: 'New area' })
    await form.getByLabel('Area title').fill('Duplicate')
    await form.getByLabel('Slug').fill(slug)
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(form.getByRole('alert')).toContainText(/taken/i)
    await form.getByRole('button', { name: 'Cancel' }).click()
  }
  const res = await request.post(`${API}/api/fields/${field.id}/areas`, { headers: H, data: { slug: 'backend', title: 'X' } })
  expect(res.status()).toBe(409)
  const after = (await listFields(request)).find((f) => f.id === field.id)!
  expect(after.areas.map((a) => a.title)).toEqual(['Azure'])
})

test('Tabs: Cloud shows its AWS and Azure cards and is still chosen after a reload', async ({ page, request }) => {
  const title = cloudTitle(3)
  const field = await makeField(request, title)
  await makeArea(request, field.id, slugOf('aws'), 'AWS')
  await makeArea(request, field.id, slugOf('azure'), 'Azure')
  await openField(page, title)
  await expect(fieldPanel(page).getByRole('link', { name: /AWS/ })).toBeVisible()
  await expect(fieldPanel(page).getByRole('link', { name: /Azure/ })).toBeVisible()
  await page.reload()
  await expect(tabs(page).getByRole('tab', { name: title, exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(fieldPanel(page).getByRole('link', { name: /AWS/ })).toBeVisible()
  await expect(fieldPanel(page).getByRole('link', { name: /Azure/ })).toBeVisible()
  // The IT tab is not chosen any more; its roles are not on the page.
  await expect(tabs(page).getByRole('tab', { name: 'IT', exact: true })).toHaveAttribute('aria-selected', 'false')
})

test('Save topics: the editor saves IAM and EC2, the map shows both and each has a lesson page', async ({ page, request }) => {
  const field = await makeField(request, cloudTitle(4))
  const slug = slugOf('aws')
  await makeArea(request, field.id, slug, 'AWS')
  await openAreaMap(page, slug)
  await page.getByRole('button', { name: 'Add topics' }).click()
  const editor = page.getByRole('form', { name: 'Topics of AWS' })
  const save = editor.getByRole('button', { name: 'Save' })
  await expect(save).toBeDisabled()
  await editor.getByRole('button', { name: 'Add topic' }).click()
  await editor.getByLabel('Title of topic 1').fill('IAM')
  await editor.getByLabel('Slug of topic 1').fill('iam')
  await editor.getByLabel('Description of topic 1').fill('Identity and access')
  await editor.getByRole('button', { name: 'Add topic' }).click()
  await editor.getByLabel('Title of topic 2').fill('EC2')
  await editor.getByLabel('Slug of topic 2').fill('ec2')
  await expect(save).toBeEnabled()
  await shotBoth(page, 'learning-fields-topic-editor')
  await save.click()
  await expect(editor).toHaveCount(0)

  const flow = page.locator('.flow')
  await expect(flow.getByText('IAM', { exact: true })).toBeVisible()
  await expect(flow.getByText('EC2', { exact: true })).toBeVisible()
  expect(await topicSlugs(request, slug)).toEqual(['iam', 'ec2'])
  await flow.getByText('EC2', { exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`#/lesson/${slug}/ec2$`))
  await expect(page.getByRole('heading', { name: 'EC2', level: 1 })).toBeVisible()
  await page.goto(`/#/lesson/${slug}/iam`)
  await expect(page.getByRole('heading', { name: 'IAM', level: 1 })).toBeVisible()
})

test('Invalid topics: a duplicate slug shows what is wrong and saves nothing; a missing parent is refused by the API', async ({
  page,
  request,
}) => {
  const field = await makeField(request, cloudTitle(5))
  const slug = slugOf('aws')
  await makeArea(request, field.id, slug, 'AWS')
  await putTopics(request, slug, [TOPICS[0]])
  await openAreaMap(page, slug)
  // Wait for the map: "Edit topics" shown while the map still loads would open an empty editor.
  await expect(page.locator('.flow').getByText('IAM', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit topics' }).click()
  const editor = page.getByRole('form', { name: 'Topics of AWS' })
  await editor.getByRole('button', { name: 'Add topic' }).click()
  await editor.getByLabel('Title of topic 2').fill('Duplicate of IAM')
  await editor.getByLabel('Slug of topic 2').fill('iam')
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(editor.getByRole('alert')).toBeVisible()
  await expect(editor.getByRole('alert')).toContainText(/duplicate|unique|twice|already/i)
  await expect(editor).toBeVisible()
  expect(await topicSlugs(request, slug)).toEqual(['iam'])

  const missingParent = await request.put(`${API}/api/areas/${slug}/topics`, {
    headers: H,
    data: { topics: [{ slug: 'ec2', title: 'EC2', parent: 'nope' }] },
  })
  expect(missingParent.status()).toBe(422)
  expect(await topicSlugs(request, slug)).toEqual(['iam'])
})

test('Cancel discards the changes of the editor', async ({ page, request }) => {
  const field = await makeField(request, cloudTitle(6))
  const slug = slugOf('aws')
  await makeArea(request, field.id, slug, 'AWS')
  await putTopics(request, slug)
  page.on('dialog', (d) => void d.accept())
  await openAreaMap(page, slug)
  // Wait for the map: "Edit topics" shown while the map still loads would open an empty editor.
  await expect(page.locator('.flow').getByText('IAM', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit topics' }).click()
  const editor = page.getByRole('form', { name: 'Topics of AWS' })
  await editor.getByLabel('Title of topic 1').fill('Changed title')
  await editor.getByRole('button', { name: 'Add topic' }).click()
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect(editor).toHaveCount(0)
  const flow = page.locator('.flow')
  await expect(flow.getByText('IAM', { exact: true })).toBeVisible()
  await expect(flow.getByText('Changed title')).toHaveCount(0)
  expect(await topicSlugs(request, slug)).toEqual(['iam', 'ec2'])
})

test('Removed topic keeps its note: the note shows that its linked topic no longer exists', async ({ page, request }) => {
  const field = await makeField(request, cloudTitle(7))
  const slug = slugOf('aws')
  await makeArea(request, field.id, slug, 'AWS')
  await putTopics(request, slug)
  const noteId = await makeNote(request, `${PREFIX} IAM note ${STAMP}`, `${slug}/iam`)

  await openAreaMap(page, slug)
  // Wait for the map: "Edit topics" shown while the map still loads would open an empty editor.
  await expect(page.locator('.flow').getByText('IAM', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit topics' }).click()
  const editor = page.getByRole('form', { name: 'Topics of AWS' })
  await editor.getByRole('button', { name: 'Remove IAM' }).click()
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(editor).toHaveCount(0)
  expect(await topicSlugs(request, slug)).toEqual(['ec2'])

  const note = await request.get(`${API}/api/notes/${noteId}`)
  expect(note.status()).toBe(200)
  expect(((await note.json()) as { node_id: string; node_missing: boolean }).node_missing).toBe(true)
  await page.goto(`/#/note/${noteId}`)
  await page.reload()
  await expect(page.getByText(`Linked node ${slug}/iam no longer exists`)).toBeVisible()
})

test('Own area is a domain: a note links to <area>/<topic> and its lesson page opens', async ({ page, request }) => {
  const field = await makeField(request, cloudTitle(8))
  const slug = slugOf('aws')
  await makeArea(request, field.id, slug, 'AWS')
  await putTopics(request, slug)
  const noteId = await makeNote(request, `${PREFIX} linked note ${STAMP}`)

  const linked = await request.patch(`${API}/api/notes/${noteId}`, { headers: H, data: { node_id: `${slug}/iam` } })
  expect(linked.status(), await linked.text()).toBe(200)
  expect(((await linked.json()) as { node_id: string }).node_id).toBe(`${slug}/iam`)

  await page.goto(`/#/lesson/${slug}/iam`)
  await expect(page.getByRole('heading', { name: 'IAM', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible()
  await expect(page.getByText(`${PREFIX} linked note ${STAMP}`).first()).toBeVisible()
  const domains = (await (await request.get(`${API}/api/domains`)).json()) as Array<{ id: string }>
  expect(domains.map((d) => d.id)).toContain(slug)
})

test('Draft and review: the agent answer offers Review in editor, which opens it filled; nothing is saved until Save', async ({
  page,
  request,
}) => {
  const field = await makeField(request, cloudTitle(9))
  const slug = slugOf('aws')
  await makeArea(request, field.id, slug, 'AWS')
  const created = await request.post(`${API}/api/ai-providers`, {
    headers: H,
    data: { name: `${LABEL} ${STAMP}`, provider_type: 'local', model_name: 'fake-ok', base_url: `${FAKE}/v1`, config: {} },
  })
  expect(created.status(), await created.text()).toBe(201)
  const provider = (await created.json()) as { id: string }
  const assigned = await request.put(`${API}/api/agents/outline/provider`, {
    headers: H,
    data: { primary_provider_id: provider.id, fallback_provider_id: null },
  })
  expect(assigned.status(), await assigned.text()).toBe(200)

  await openAreaMap(page, slug)
  await page.getByRole('button', { name: 'Draft topics with agent' }).click()
  const agent = page.getByRole('complementary', { name: 'Agent' })
  const review = agent.getByRole('button', { name: 'Review in editor' })
  await expect(review).toBeVisible({ timeout: 30_000 })
  expect(await topicSlugs(request, slug)).toEqual([])
  await review.click()

  const editor = page.getByRole('form', { name: 'Topics of AWS' })
  await expect(editor).toBeVisible()
  await expect(editor.getByLabel('Title of topic 1')).toHaveValue('IAM')
  await expect(editor.getByLabel('Slug of topic 2')).toHaveValue('iam-policies')
  await expect(editor.getByLabel('Parent of topic 2')).toHaveValue('iam')
  expect(await topicSlugs(request, slug)).toEqual([])
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(editor).toHaveCount(0)
  expect((await topicSlugs(request, slug)).length).toBeGreaterThanOrEqual(8)
})

test('Publish: a member sees the published field read only and can link notes and write lessons; cannot publish their own', async ({
  page,
  request,
  browser,
}) => {
  const title = `${PREFIX} Driving licence ${STAMP}`
  const field = await makeField(request, title)
  const slug = slugOf('driving')
  await makeArea(request, field.id, slug, 'Driving rules')
  await putTopics(request, slug, [{ slug: 'signs', title: 'Road signs', description: null, parent: null }])

  // The member joins through an invitation, in a browser of their own.
  const previous = latestOutboxToken('invite')
  const invited = await request.post(`${API}/api/admin/invitations`, { headers: H, data: { email: MEMBER.email } })
  expect(invited.status(), await invited.text()).toBe(201)
  const token = await nextOutboxToken('invite', previous)
  member.context = await newMemberContext(browser)
  const accepted = await member.context.request.post(`${API}/api/auth/invitation/accept`, {
    headers: H,
    data: { token, password: MEMBER.password, display_name: MEMBER.name },
  })
  expect(accepted.status(), await accepted.text()).toBe(201)
  const mp = await member.context.newPage()

  // Private first: the member does not see it.
  await mp.goto('/')
  await expect(tabs(mp)).toBeVisible()
  await expect(tabs(mp).getByRole('tab', { name: title, exact: true })).toHaveCount(0)

  // The admin publishes it from the field menu.
  await openField(page, title)
  await page.getByRole('button', { name: 'Field actions' }).click()
  await page.getByRole('menuitem', { name: 'Publish' }).click()
  await expect(page.getByText('Published', { exact: true })).toBeVisible()
  expect((await listFields(request)).find((f) => f.id === field.id)!.published).toBe(true)

  // The member sees the tab and its area, with no edit controls.
  await mp.goto('/')
  await tabs(mp).getByRole('tab', { name: title, exact: true }).click()
  await expect(fieldPanel(mp).getByRole('link', { name: /Driving rules/ })).toBeVisible()
  await expect(mp.getByRole('button', { name: 'New area' })).toHaveCount(0)
  await expect(mp.getByRole('button', { name: 'Field actions' })).toHaveCount(0)
  await shot(mp, 'learning-fields-member-published')
  await fieldPanel(mp).getByRole('link', { name: /Driving rules/ }).click()
  await expect(mp.locator('.flow').getByText('Road signs', { exact: true })).toBeVisible()
  await expect(mp.getByRole('button', { name: 'Edit topics' })).toHaveCount(0)
  await expect(mp.getByRole('button', { name: 'Area actions' })).toHaveCount(0)
  const edit = await mp.request.put(`${API}/api/areas/${slug}/topics`, { headers: H, data: { topics: [] } })
  expect(edit.status()).toBe(403)

  // They can link a note and write a lesson on its topic.
  const noteId = await makeNote(mp.request, `${PREFIX} member note ${STAMP}`, `${slug}/signs`)
  const lesson = await mp.request.put(`${API}/api/lessons/${slug}/signs`, {
    headers: H,
    data: { body: 'Stop signs are red.' },
  })
  expect([200, 201], await lesson.text()).toContain(lesson.status())
  await mp.goto(`/#/lesson/${slug}/signs`)
  await expect(mp.getByRole('heading', { name: 'Road signs', level: 1 })).toBeVisible()
  await mp.request.delete(`${API}/api/notes/${noteId}`, { headers: H })

  // A member cannot publish their own field: admin only.
  const own = await mp.request.post(`${API}/api/fields`, { headers: H, data: { title: `${PREFIX} member field ${STAMP}` } })
  expect(own.status()).toBe(201)
  const ownField = (await own.json()) as ApiField
  const publish = await mp.request.patch(`${API}/api/fields/${ownField.id}`, { headers: H, data: { published: true } })
  expect(publish.status()).toBe(403)
  await mp.goto('/')
  await tabs(mp).getByRole('tab', { name: ownField.title, exact: true }).click()
  await mp.getByRole('button', { name: 'Field actions' }).click()
  await expect(mp.getByRole('menuitem', { name: 'Publish' })).toHaveCount(0)
  await mp.request.delete(`${API}/api/fields/${ownField.id}`, { headers: H })

  // Unpublished again: the member loses it.
  await request.patch(`${API}/api/fields/${field.id}`, { headers: H, data: { published: false } })
  const listed = (await (await mp.request.get(`${API}/api/fields`)).json()) as ApiField[]
  expect(listed.map((f) => f.id)).not.toContain(field.id)
})

test("Another user's private area is unknown: reading it answers 404 and a note cannot be linked to it", async ({ request, browser }) => {
  const field = await makeField(request, cloudTitle(10))
  const slug = slugOf('aws')
  await makeArea(request, field.id, slug, 'AWS')
  await putTopics(request, slug)

  if (!member.context) {
    const previous = latestOutboxToken('invite')
    const invited = await request.post(`${API}/api/admin/invitations`, { headers: H, data: { email: MEMBER.email } })
    expect(invited.status(), await invited.text()).toBe(201)
    const token = await nextOutboxToken('invite', previous)
    member.context = await newMemberContext(browser)
    const accepted = await member.context.request.post(`${API}/api/auth/invitation/accept`, {
      headers: H,
      data: { token, password: MEMBER.password, display_name: MEMBER.name },
    })
    expect(accepted.status(), await accepted.text()).toBe(201)
  }
  const m = member.context.request
  const fields = (await (await m.get(`${API}/api/fields`)).json()) as ApiField[]
  expect(fields.map((f) => f.id)).not.toContain(field.id)
  expect(fields.map((f) => f.title)).not.toContain(cloudTitle(10))
  expect((await m.get(`${API}/api/domains/${slug}/roadmap`)).status()).toBe(404)
  const noteId = await makeNote(m, `${PREFIX} member private ${STAMP}`)
  const link = await m.patch(`${API}/api/notes/${noteId}`, { headers: H, data: { node_id: `${slug}/iam` } })
  expect(link.status()).toBe(422)
  expect(await link.text()).toMatch(/unknown node/)
  await m.delete(`${API}/api/notes/${noteId}`, { headers: H })
})

test('phone: the home tabs fit a phone and the Cloud tab shows its cards', async ({ page, request }) => {
  const title = cloudTitle(11)
  const field = await makeField(request, title)
  await makeArea(request, field.id, slugOf('aws'), 'AWS')
  await makeArea(request, field.id, slugOf('azure'), 'Azure')
  await page.goto('/')
  await expect(tabs(page)).toBeVisible()
  await tabs(page).getByRole('tab', { name: title, exact: true }).click()
  await expect(fieldPanel(page).getByRole('link', { name: /AWS/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New field' })).toBeVisible()
  // No sideways page scroll.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await shotBoth(page, 'learning-fields-home-tabs-phone')
})

function newMemberContext(browser: Browser) {
  return browser.newContext({ baseURL: APP, storageState: SIGNED_OUT })
}
