/**
 * Spec checks for the change ai-news.
 *
 * No real feed is ever read. The e2e backend's sources (e2e/news-sources.e2e.yaml) sit on a
 * loopback address, which the backend's safe fetch refuses before connecting, so a real refresh
 * in this run always fails every source with a reason. The backend cannot be pointed at a local
 * fake feed server (https and global addresses only, by design), so the scenarios that need
 * stored items answer /api/news* in the browser with synthetic data (page.route).
 */
import { expect, test, type APIRequestContext, type Page, type Request, type Route } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const API = 'http://127.0.0.1:8001'
const FAKE = 'http://127.0.0.1:8002/v1'
const H = { 'X-LearningHub': '1' }
const created: string[] = []

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  return errors
}

// ---- Synthetic news (browser-side answers) -------------------------------------------------

interface Item {
  id: string
  source: string
  source_name: string
  title: string
  url: string
  published_at: string
  summary: string
}

const SOURCES = [
  { id: 'qc-lab', name: 'QC Lab News', homepage: 'https://lab.example.test/' },
  { id: 'qc-research', name: 'QC Research Blog', homepage: 'https://research.example.test/' },
]

/** A local time `daysAgo` days back at `hour`:`minute`, as ISO. */
function at(daysAgo: number, hour: number, minute = 0): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute).toISOString()
}

function item(n: number, source: 0 | 1, title: string, published: string, summary = ''): Item {
  const s = SOURCES[source]
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    source: s.id,
    source_name: s.name,
    title,
    url: `${s.homepage}posts/${n}`,
    published_at: published,
    summary,
  }
}

const ITEMS: Item[] = [
  item(1, 0, 'Robots learn to fold laundry', at(0, 11, 30), 'A lab robot folds towels from a few demonstrations.'),
  item(2, 1, 'Sparse attention <img src=x onerror="document.title=1"> explained', at(0, 9, 5), 'Markup in feeds is text.'),
  item(3, 1, 'Benchmarks for small models', at(1, 16), 'Yesterday’s results on reasoning benchmarks.'),
  item(4, 0, 'Robot hands with touch sensors', at(5, 8), 'Tactile sensing for grasping.'),
]

interface NewsFake {
  items: Item[]
  /** Answers of GET /api/news/refresh, in order; the last one repeats. */
  statuses: object[]
  /** Answer of POST /api/news/refresh. */
  started: object
  stale: boolean
  posts: Request[]
  listQueries: URLSearchParams[]
  /** When set, GET /api/news answers no items until the refresh status has been read this often. */
  itemsAfterStatusReads?: number
  statusReads: number
}

function status(state: string, results: Array<[0 | 1, boolean | null, string | null]>, error: string | null = null) {
  return {
    state,
    started_at: at(0, 0),
    finished_at: state === 'running' ? null : new Date().toISOString(),
    error,
    sources: results.map(([s, ok, err]) => ({
      id: SOURCES[s].id,
      name: SOURCES[s].name,
      ok,
      items: ok ? 2 : ok === false ? 0 : null,
      error: err,
    })),
  }
}

const IDLE = { state: 'idle', started_at: null, finished_at: null, error: null, sources: [] }

async function fakeNews(page: Page, fake: Partial<NewsFake> = {}): Promise<NewsFake> {
  const state: NewsFake = {
    items: ITEMS,
    statuses: [IDLE],
    started: status('running', [[0, null, null], [1, null, null]]),
    stale: false,
    posts: [],
    listQueries: [],
    statusReads: 0,
    ...fake,
  }
  await page.route(
    (url) => url.pathname.startsWith('/api/news'),
    async (route: Route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.pathname === '/api/news/refresh') {
        if (request.method() === 'POST') {
          state.posts.push(request)
          return route.fulfill({ status: 202, json: state.started })
        }
        const answer = state.statuses[Math.min(state.statusReads, state.statuses.length - 1)]
        state.statusReads += 1
        return route.fulfill({ json: answer })
      }
      state.listQueries.push(url.searchParams)
      const visible =
        state.itemsAfterStatusReads === undefined || state.statusReads >= state.itemsAfterStatusReads
      const source = url.searchParams.get('source')
      const q = (url.searchParams.get('q') ?? '').toLowerCase()
      const before = url.searchParams.get('before')
      const limit = Number(url.searchParams.get('limit') ?? '50')
      const all = visible ? state.items : []
      const matching = all
        .filter((i) => !source || i.source === source)
        .filter((i) => !q || i.title.toLowerCase().includes(q) || i.summary.toLowerCase().includes(q))
        .filter((i) => !before || i.published_at < before)
        .sort((a, b) => b.published_at.localeCompare(a.published_at))
      return route.fulfill({
        json: {
          items: matching.slice(0, limit),
          sources: SOURCES.map((s) => ({
            ...s,
            count: all.filter((i) => i.source === s.id).length,
            last_ok: true,
            last_error: null,
            last_fetched_at: at(0, 0),
          })),
          last_refresh_at: visible && all.length > 0 ? new Date(Date.now() - 12 * 60_000).toISOString() : null,
          stale: state.stale || all.length === 0,
        },
      })
    },
  )
  return state
}

async function makeAssistant(request: APIRequestContext) {
  const res = await request.post(`${API}/api/ai-providers`, {
    headers: H,
    data: {
      name: `News helper ${Date.now().toString(36)}`,
      provider_type: 'local',
      model_name: 'fake-ok',
      base_url: FAKE,
      config: {},
    },
  })
  expect(res.status(), await res.text()).toBe(201)
  const body = await res.json()
  created.push(body.id)
  const assigned = await request.put(`${API}/api/agents/assistant/provider`, {
    headers: H,
    data: { primary_provider_id: body.id, fallback_provider_id: null },
  })
  expect(assigned.ok()).toBeTruthy()
}

test.afterEach(async ({ request }) => {
  await request.put(`${API}/api/agents/assistant/provider`, {
    headers: H,
    data: { primary_provider_id: null, fallback_provider_id: null },
  })
  while (created.length > 0) {
    await request.delete(`${API}/api/ai-providers/${created.pop()}`, { headers: H })
  }
})

// ---- Real backend, no network -------------------------------------------------------------

test.describe('Refresh the news (e2e backend, sources refused before connecting)', () => {
  test('Refresh needs the app header; the list names the configured sources', async ({ request }) => {
    const bare = await request.post(`${API}/api/news/refresh`)
    expect(bare.status()).toBe(403)
    const list = await (await request.get(`${API}/api/news`)).json()
    expect(list.items).toEqual([])
    expect(list.sources.map((s: { id: string; name: string; count: number }) => [s.id, s.name, s.count])).toEqual([
      ['qc-lab', 'QC Lab News', 0],
      ['qc-research', 'QC Research Blog', 0],
    ])
    expect(list.stale).toBe(true)
    const bad = await request.get(`${API}/api/news?limit=0`)
    expect(bad.status()).toBe(422)
  })

  test('First visit from the top bar refreshes once by itself and names the sources that failed', async ({
    page,
    request,
  }) => {
    const errors = watchErrors(page)
    const posts: Request[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/news/refresh') posts.push(r)
    })
    await page.goto('/')
    await page.getByRole('link', { name: 'News' }).click()
    await expect(page).toHaveURL(/#\/news$/)
    const news = page.getByRole('region', { name: 'AI news' })
    await expect(news.getByRole('heading', { level: 1, name: 'AI news' })).toBeVisible()

    await expect(news.getByText('The refresh failed: every source failed')).toBeVisible({ timeout: 20_000 })
    const failed = news.getByRole('list', { name: 'Failed sources' })
    await expect(failed.getByRole('listitem')).toHaveText([
      "QC Lab News: '127.0.0.1' points to a private or reserved address",
      "QC Research Blog: '127.0.0.1' points to a private or reserved address",
    ])
    await expect(news.getByText('No news yet.')).toBeVisible()
    await expect(news.getByText('Refresh to read the sources.')).toBeVisible()
    expect(posts).toHaveLength(1)
    expect(await posts[0].headerValue('x-learninghub')).toBe('1')

    const done = await (await request.get(`${API}/api/news/refresh`)).json()
    expect(done.state).toBe('failed')
    expect(done.sources.map((s: { ok: boolean }) => s.ok)).toEqual([false, false])
    // Once per visit: no second refresh starts by itself.
    await page.waitForTimeout(2_000)
    expect(posts).toHaveLength(1)
    expect(errors).toEqual([])
  })
})

// ---- News page with synthetic items ---------------------------------------------------------

test.describe('News page', () => {
  test('Read and open: newest first under day headings, source chips, links in a new tab', async ({ page }) => {
    const errors = watchErrors(page)
    const fake = await fakeNews(page)
    await page.goto('/#/news')
    const news = page.getByRole('region', { name: 'AI news' })
    await expect(news.getByRole('heading', { level: 2 })).toHaveText([
      'Today',
      'Yesterday',
      new Date(ITEMS[3].published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    ])
    const today = news.getByRole('region', { name: 'Today' })
    await expect(today.getByRole('link')).toHaveText([ITEMS[0].title, ITEMS[1].title])
    await expect(news.getByRole('region', { name: 'Yesterday' }).getByRole('link')).toHaveText([ITEMS[2].title])
    await expect(today.getByRole('listitem').first()).toContainText('QC Lab News')
    await expect(today.getByRole('listitem').first()).toContainText(ITEMS[0].summary)
    await expect(news.getByText('Last refreshed 12 min ago')).toBeVisible()

    // Feed text is shown as text, never as HTML.
    await expect(news.locator('.news-list img')).toHaveCount(0)
    const links = news.locator('.news-list a')
    await expect(links).toHaveCount(ITEMS.length)
    for (let i = 0; i < ITEMS.length; i++) {
      await expect(links.nth(i)).toHaveAttribute('target', '_blank')
      await expect(links.nth(i)).toHaveAttribute('rel', 'noopener noreferrer')
    }
    await expect(links.first()).toHaveAttribute('href', ITEMS[0].url)

    const chips = news.getByRole('group', { name: 'Sources' })
    await expect(chips.getByRole('button')).toHaveText(['All 4', 'QC Lab News 2', 'QC Research Blog 2'])
    await expect(chips.getByRole('button', { name: 'All 4' })).toHaveAttribute('aria-pressed', 'true')
    // Not stale and not empty: no refresh starts by itself.
    expect(fake.posts).toHaveLength(0)
    await shot(page, 'news-light')

    await page.getByRole('radio', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await shot(page, 'news-dark')
    await page.getByRole('radio', { name: 'System' }).click()
    expect(errors).toEqual([])
  })

  test('Filter by source and text, newest first; no match says so', async ({ page }) => {
    const fake = await fakeNews(page)
    await page.goto('/#/news')
    const news = page.getByRole('region', { name: 'AI news' })
    const links = news.locator('.news-list a')
    await expect(links).toHaveCount(4)

    await news.getByRole('group', { name: 'Sources' }).getByRole('button', { name: /QC Lab News/ }).click()
    await expect(links).toHaveText([ITEMS[0].title, ITEMS[3].title])
    await expect(
      news.getByRole('group', { name: 'Sources' }).getByRole('button', { name: /QC Lab News/ }),
    ).toHaveAttribute('aria-pressed', 'true')

    await news.getByRole('searchbox', { name: 'Filter news' }).fill('hands')
    await expect(links).toHaveText([ITEMS[3].title])
    const last = fake.listQueries[fake.listQueries.length - 1]
    expect(last.get('source')).toBe('qc-lab')
    expect(last.get('q')).toBe('hands')

    await news.getByRole('searchbox', { name: 'Filter news' }).fill('quantum')
    await expect(news.getByText('No news matches these filters.')).toBeVisible()
    await expect(links).toHaveCount(0)

    await news.getByRole('searchbox', { name: 'Filter news' }).fill('')
    await news.getByRole('group', { name: 'Sources' }).getByRole('button', { name: /^All/ }).click()
    await expect(links).toHaveCount(4)
  })

  test('Ask the agent puts the title and URL in the chat input without sending', async ({ page, request }) => {
    await makeAssistant(request)
    await fakeNews(page)
    const chats: Request[] = []
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/agent/chat') chats.push(r)
    })
    await page.goto('/#/news')
    const news = page.getByRole('region', { name: 'AI news' })
    const first = news.getByRole('region', { name: 'Today' }).getByRole('listitem').first()
    await first.getByRole('button', { name: 'Ask the agent' }).click()
    const agent = page.getByRole('complementary', { name: 'Agent' })
    const box = agent.getByRole('textbox', { name: 'Message the agent' })
    await expect(box).toHaveValue(`Explain this news for me: ${ITEMS[0].title} (${ITEMS[0].url})`)
    await expect(box).toBeFocused()
    await page.waitForTimeout(1_000)
    expect(chats).toHaveLength(0)
    await shot(page, 'news-ask-agent')
  })

  test('First visit: the refresh starts by itself, shows progress and the failed source, and items appear', async ({
    page,
  }) => {
    const fake = await fakeNews(page, {
      stale: true,
      // Items are stored once the refresh has run (after a few status reads).
      itemsAfterStatusReads: 3,
      statuses: [
        IDLE,
        status('running', [[0, true, null], [1, null, null]]),
        status('done', [[0, true, null], [1, false, 'the page answered with status 500']]),
      ],
      started: status('running', [[0, null, null], [1, null, null]]),
    })
    await page.goto('/#/news')
    const news = page.getByRole('region', { name: 'AI news' })
    await expect(news.getByRole('status')).toHaveText(/Refreshing news… \((0|1) of 2 sources\)/)
    await expect(news.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    await expect(news.getByRole('status')).toHaveText('Refreshing news… (1 of 2 sources)', { timeout: 10_000 })

    await expect(news.getByText('Some sources could not be read:')).toBeVisible({ timeout: 10_000 })
    await expect(news.getByRole('list', { name: 'Failed sources' }).getByRole('listitem')).toHaveText([
      'QC Research Blog: the page answered with status 500',
    ])
    // The items appear without a reload.
    await expect(news.locator('.news-list a')).toHaveCount(4)
    await expect(news.getByRole('button', { name: 'Refresh' })).toBeEnabled()
    expect(fake.posts).toHaveLength(1)
    expect(await fake.posts[0].headerValue('x-learninghub')).toBe('1')
    await shot(page, 'news-refreshed-failed-source')
  })

  test('Refresh on request; the empty page offers Refresh', async ({ page }) => {
    const fake = await fakeNews(page, {
      items: [],
      // Already refreshed recently with nothing found: the empty state, with the refresh done.
      statuses: [status('done', [[0, true, null], [1, true, null]])],
      started: status('running', [[0, null, null], [1, null, null]]),
    })
    await page.goto('/#/news')
    const news = page.getByRole('region', { name: 'AI news' })
    await expect(news.getByText('No news yet.')).toBeVisible()
    // With nothing stored, opening the page starts one refresh by itself.
    await expect.poll(() => fake.posts.length).toBe(1)
    fake.statuses = [status('done', [[0, true, null], [1, true, null]])]
    fake.statusReads = 0
    await expect(news.getByRole('button', { name: 'Refresh' })).toBeEnabled({ timeout: 10_000 })
    await news.getByRole('button', { name: 'Refresh' }).click()
    await expect.poll(() => fake.posts.length).toBe(2)
  })

  test('Load more pages through older items', async ({ page }) => {
    const many: Item[] = []
    for (let n = 0; n < 55; n++) many.push(item(100 + n, (n % 2) as 0 | 1, `Paged item ${n + 1}`, at(Math.floor(n / 10), 23 - (n % 10))))
    const fake = await fakeNews(page, { items: many })
    await page.goto('/#/news')
    const news = page.getByRole('region', { name: 'AI news' })
    const links = news.locator('.news-list a')
    await expect(links).toHaveCount(50)
    await expect(links.first()).toHaveText('Paged item 1')
    await news.getByRole('button', { name: 'Load more' }).click()
    await expect(links).toHaveCount(55)
    await expect(links.last()).toHaveText('Paged item 55')
    await expect(news.getByRole('button', { name: 'Load more' })).toHaveCount(0)
    const paged = fake.listQueries.find((q) => q.get('before'))
    expect(paged?.get('before')).toBe(many[49].published_at)
  })
})
