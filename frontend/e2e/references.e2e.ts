/**
 * End-to-end checks for the roadmap-resources change: the References section of the lesson page,
 * its empty state with Sync references, a failed sync, the grouped links and Draft lesson from
 * references. The sync reads a synthetic source on the fake server (e2e/fake_llm.py, port 8002:
 * /roadmap-api and /roadmap-raw, links on example.test only), never GitHub or roadmap.sh.
 * POST /roadmap-control {"fail": true} on the fake server makes the source answer 500.
 *
 * The tests run in order and share the e2e database: the empty state and the failed sync come
 * before the successful sync, which the later tests build on.
 */
import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test'

const API = 'http://127.0.0.1:8001'
const FAKE = 'http://127.0.0.1:8002'
const H = { 'X-LearningHub': '1' }
const NODE = 'frontend/html'
const SYNC_TIMEOUT = 20_000

const created: string[] = []

async function shot(page: Page, name: string) {
  await page.screenshot({
    path: `e2e-results/screens/${name}.png`,
    fullPage: true,
  })
}

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  return errors
}

async function setSourceFailing(request: APIRequestContext, fail: boolean) {
  const res = await request.post(`${FAKE}/roadmap-control`, { data: { fail } })
  expect(res.ok(), await res.text()).toBeTruthy()
}

async function openReferences(page: Page, node = NODE) {
  await page.goto(`/#/lesson/${node}`)
  const refs = page.getByRole('region', { name: 'References' })
  await expect(refs.getByRole('heading', { name: 'References' })).toBeVisible()
  return refs
}

test.afterEach(async ({ request }) => {
  await setSourceFailing(request, false)
  for (const agent of ['assistant', 'lesson-writer']) {
    await request.put(`${API}/api/agents/${agent}/provider`, {
      headers: H,
      data: { primary_provider_id: null, fallback_provider_id: null },
    })
  }
  while (created.length > 0) {
    await request.delete(`${API}/api/ai-providers/${created.pop()}`, {
      headers: H,
    })
  }
})

test('A domain without a mapping offers no Sync references', async ({ page, request }) => {
  const errors = watchErrors(page)
  const refs = await openReferences(page, 'devops/docker')
  await expect(refs.getByText('No references for this roadmap yet.')).toBeVisible()
  await expect(refs.getByRole('button', { name: 'Sync references' })).toHaveCount(0)
  await expect(refs.getByRole('link')).toHaveCount(0)
  // A known roadmap without a mapping is "unavailable" (200, so the page logs no error); it cannot be synced.
  const status = await request.get(`${API}/api/resources/sync/devops`)
  expect(status.status()).toBe(200)
  expect((await status.json()).state).toBe('unavailable')
  const start = await request.post(`${API}/api/resources/sync`, {
    headers: { 'X-LearningHub': '1' },
    data: { domain: 'devops' },
  })
  expect(start.status()).toBe(404)
  expect(errors).toEqual([])
})

test('Not synced yet: empty state with Sync references and no links', async ({ page, request }) => {
  const errors = watchErrors(page)
  const api = await (await request.get(`${API}/api/resources/${NODE}`)).json()
  expect(api.items).toEqual([])
  const refs = await openReferences(page)
  await expect(refs.getByText('No references synced yet.')).toBeVisible()
  await expect(refs.getByRole('button', { name: 'Sync references' })).toBeEnabled()
  await expect(refs.getByRole('link')).toHaveCount(0)
  await expect(refs.getByRole('button', { name: 'Draft lesson from references' })).toHaveCount(0)
  await shot(page, 'references-empty')
  expect(errors).toEqual([])
})

test('Sync needs the app header: refused with 403 and nothing runs', async ({ request }) => {
  const res = await request.post(`${API}/api/resources/sync`, {
    data: { domain: 'frontend' },
  })
  expect(res.status()).toBe(403)
  const status = await (await request.get(`${API}/api/resources/sync/frontend`)).json()
  expect(status.state).toBe('idle')
})

test('Failed sync shows the error, keeps the button and stores nothing', async ({ page, request }) => {
  await setSourceFailing(request, true)
  const refs = await openReferences(page)
  await refs.getByRole('button', { name: 'Sync references' }).click()
  await expect(refs.getByRole('status')).toHaveText('Syncing references…')
  const alert = refs.getByRole('alert')
  await expect(alert).toBeVisible({ timeout: SYNC_TIMEOUT })
  await expect(alert).toContainText('Sync failed:')
  await expect(alert).toContainText('500')
  await expect(refs.getByRole('button', { name: 'Sync references' })).toBeEnabled()
  await expect(refs.getByRole('link')).toHaveCount(0)
  await shot(page, 'references-failed')

  const status = await (await request.get(`${API}/api/resources/sync/frontend`)).json()
  expect(status.state).toBe('failed')
  expect(status.error).toContain('500')
  expect((await (await request.get(`${API}/api/resources/${NODE}`)).json()).items).toEqual([])
})

test('Sync from the empty state shows progress, then grouped links without a reload', async ({ page, request }) => {
  const errors = watchErrors(page)
  const refs = await openReferences(page)
  // A marker on window survives only if the page is not reloaded.
  await page.evaluate('window.__noReload = true')
  const post = page.waitForRequest((r: Request) => r.url().endsWith('/api/resources/sync') && r.method() === 'POST')
  await refs.getByRole('button', { name: 'Sync references' }).click()
  const sent = await post
  expect(sent.headers()['x-learninghub']).toBe('1')
  expect(sent.postDataJSON()).toEqual({ domain: 'frontend' })
  await expect(refs.getByRole('status')).toHaveText('Syncing references…')

  const groups = refs.locator('h3')
  await expect(groups.first()).toBeVisible({ timeout: SYNC_TIMEOUT })
  expect(await page.evaluate('window.__noReload === true')).toBe(true)
  await expect(refs.getByRole('status')).toHaveCount(0)
  await expect(refs.getByRole('alert')).toHaveCount(0)
  await expect(refs.getByRole('button', { name: 'Sync references' })).toHaveCount(0)

  // Grouped by type, Official before Articles before Videos.
  await expect(groups).toHaveText(['Official', 'Articles', 'Videos'])
  const official = refs.locator('.reference-group', {
    has: page.getByRole('heading', { name: 'Official' }),
  })
  await expect(official.getByRole('link', { name: 'Synthetic official frontend html' })).toHaveAttribute(
    'href',
    'https://example.test/frontend-html-official',
  )
  const articles = refs.locator('.reference-group', {
    has: page.getByRole('heading', { name: 'Articles' }),
  })
  await expect(articles.getByRole('link', { name: 'Synthetic article frontend html' })).toHaveAttribute(
    'href',
    'https://example.test/frontend-html-article',
  )
  // Links of "html/*" are part of the node too.
  await expect(
    articles.getByRole('link', {
      name: 'Synthetic article html e2e-extra-topic',
    }),
  ).toBeVisible()
  const videos = refs.locator('.reference-group', {
    has: page.getByRole('heading', { name: 'Videos' }),
  })
  await expect(videos.getByRole('link')).toHaveText(['Synthetic video frontend html'])

  // Every link opens a new tab without access to the app.
  const links = refs.getByRole('link')
  const count = await links.count()
  expect(count).toBeGreaterThan(3)
  for (let i = 0; i < count; i++) {
    const link = links.nth(i)
    await expect(link).toHaveAttribute('target', '_blank')
    const rel = ((await link.getAttribute('rel')) ?? '').split(/\s+/)
    expect(rel).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
  }

  // Source line: roadmap.sh link and the sync date.
  const source = refs.locator('.reference-source')
  await expect(source).toContainText(/^Source: roadmap\.sh · synced \w{3} \d{1,2}, \d{4}$/)
  await expect(source.getByRole('link', { name: 'roadmap.sh' })).toHaveAttribute('href', 'https://roadmap.sh/frontend')

  const status = await (await request.get(`${API}/api/resources/sync/frontend`)).json()
  expect(status.state).toBe('done')
  expect(status.nodes).toBeGreaterThan(0)
  expect(status.links).toBeGreaterThan(0)
  const api = await (await request.get(`${API}/api/resources/${NODE}`)).json()
  expect(api.items.length).toBe(await refs.locator('.reference-list').getByRole('link').count())
  expect(api.items.every((i: { url: string }) => i.url.startsWith('https://example.test/'))).toBe(true)

  await shot(page, 'references-light')
  await page.getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await refs.scrollIntoViewIfNeeded()
  await shot(page, 'references-dark')
  await page.getByRole('radio', { name: 'System' }).click()
  expect(errors).toEqual([])
})

test('Sync again stores the links once', async ({ request }) => {
  const before = await (await request.get(`${API}/api/resources/${NODE}`)).json()
  const start = await request.post(`${API}/api/resources/sync`, {
    headers: H,
    data: { domain: 'frontend' },
  })
  expect(start.status()).toBe(202)
  await expect
    .poll(async () => (await (await request.get(`${API}/api/resources/sync/frontend`)).json()).state, {
      timeout: SYNC_TIMEOUT,
    })
    .toBe('done')
  const after = await (await request.get(`${API}/api/resources/${NODE}`)).json()
  const urls = after.items.map((i: { url: string }) => i.url)
  expect(new Set(urls).size).toBe(urls.length)
  expect(urls).toEqual(before.items.map((i: { url: string }) => i.url))
})

test('Failed sync keeps the earlier links', async ({ page, request }) => {
  const before = await (await request.get(`${API}/api/resources/${NODE}`)).json()
  expect(before.items.length).toBeGreaterThan(0)
  await setSourceFailing(request, true)
  const start = await request.post(`${API}/api/resources/sync`, {
    headers: H,
    data: { domain: 'frontend' },
  })
  expect(start.status()).toBe(202)
  await expect
    .poll(async () => (await (await request.get(`${API}/api/resources/sync/frontend`)).json()).state, {
      timeout: SYNC_TIMEOUT,
    })
    .toBe('failed')
  const after = await (await request.get(`${API}/api/resources/${NODE}`)).json()
  expect(after.items).toEqual(before.items)
  const refs = await openReferences(page)
  await expect(refs.getByRole('link', { name: 'Synthetic official frontend html' })).toBeVisible()
})

test('Draft lesson from references asks the lesson writer', async ({ page, request }) => {
  const name = `Refs writer ${Date.now().toString(36)}`
  const res = await request.post(`${API}/api/ai-providers`, {
    headers: H,
    data: {
      name,
      provider_type: 'local',
      model_name: 'fake-ok',
      base_url: `${FAKE}/v1`,
      config: {},
    },
  })
  expect(res.status(), await res.text()).toBe(201)
  const provider = await res.json()
  created.push(provider.id)
  const assigned = await request.put(`${API}/api/agents/lesson-writer/provider`, {
    headers: H,
    data: { primary_provider_id: provider.id, fallback_provider_id: null },
  })
  expect(assigned.status()).toBe(200)

  const refs = await openReferences(page)
  const draft = refs.getByRole('button', {
    name: 'Draft lesson from references',
  })
  await expect(draft).toBeVisible()
  const req = page.waitForRequest((r: Request) => r.url().endsWith('/api/agent/chat') && r.method() === 'POST')
  await draft.click()
  const body = (await req).postDataJSON() as {
    agent_id: string
    messages: { role: string; content: string }[]
  }
  expect(body.agent_id).toBe('lesson-writer')
  expect(body.messages.at(-1)?.content).toContain(`references (${NODE})`)
  const agent = page.getByRole('complementary', { name: 'Agent' })
  await expect(agent.getByText('OK from fake')).toBeVisible({
    timeout: SYNC_TIMEOUT,
  })
  await expect(agent.locator('.agent-caption')).toContainText(`${name} · fake-ok`)
})
