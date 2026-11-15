/**
 * Spec checks for the change practice-exams (openspec/changes/practice-exams/specs/practice-exams):
 * import (zip, JSON then pictures, invalid file), practice, the mock exam (draw, pass, fail on a
 * critical question, time out), history, and access (another user's test, a member in a
 * published area).
 *
 * The bank is synthetic: e2e/fixtures/practice-bank.json (12 made-up questions over t1..t3,
 * critical: 8 and 12, pictures on 2 and 9; rules 10 questions, 2 minutes, pass mark 8, critical
 * fails, 1 critical, 3 from t1). The two pictures and the zip are built here at run time.
 * Questions 1-3 are t1 and none of them is critical, so a test holds exactly 3 t1 questions.
 *
 * Runs signed in as the admin owner; the member is invited through the API. Everything made
 * here (fields with their areas and banks, the member) carries the STAMP / PREFIX and is
 * removed in afterEach/afterAll. The phone test sets its own viewport so it runs in the
 * `app` project (the phone project only matches two other files).
 */
import { expect as baseExpect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { OWNER_STATE } from '../playwright.config.ts'
import { latestOutboxToken, nextOutboxToken } from './outbox.ts'

test.describe.configure({ mode: 'serial', timeout: 120_000 })
const expect = baseExpect.configure({ timeout: 15_000 })

const API = 'http://127.0.0.1:8001'
const APP = 'http://127.0.0.1:5174'
const H = { 'X-LearningHub': '1' }
const SIGNED_OUT = { cookies: [], origins: [] }
const STAMP = Date.now().toString(36)
const PREFIX = 'QC-exams'
const MEMBER = { email: `exams-member-${STAMP}@example.test`, password: 'e2e-member-password-1', name: 'Exams Member' }

interface FixtureQuestion {
  number: number
  topic: string
  text: string
  options: string[]
  answer: number
  critical: boolean
  image?: string
  explanation: string
}
interface FixtureBank {
  title: string
  rules: { questions: number; minutes: number; pass_mark: number; critical_fails: boolean; min_critical: number; per_topic: Record<string, number> }
  questions: FixtureQuestion[]
}
interface ApiQuestion {
  id: string
  number: number
  topic: string
  text: string
  options: string[]
  critical: boolean
  has_image: boolean
  last_correct: boolean | null
}
interface ApiExam {
  id: string
  bank_id: string
  started_at: string
  deadline: string
  submitted_at: string | null
  questions: ApiQuestion[]
  answers: Record<string, number>
  result: null | { score: number; total: number; passed: boolean; failed_on_critical: number[] }
}
interface ApiBank {
  id: string
  title: string
  question_count: number
  critical_count: number
  images_missing: number
}

const BANK: FixtureBank = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'practice-bank.json'), 'utf8'))
const BY_NUMBER = new Map(BANK.questions.map((q) => [q.number, q]))
/** The made-up question number a question text carries ("Fixture question 7: ..."). */
const numberOf = (text: string) => Number(/Fixture question (\d+):/.exec(text)![1])
const rightOption = (n: number) => BY_NUMBER.get(n)!.answer
const wrongOption = (n: number) => (rightOption(n) === 1 ? 2 : 1)

const TOPICS = [
  { slug: 't1', title: 'Topic one', description: null, parent: null },
  { slug: 't2', title: 'Topic two', description: null, parent: null },
  { slug: 't3', title: 'Topic three', description: null, parent: null },
]

// ---- synthetic files ---------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A small valid RGB PNG with a coloured gradient (`seed` picks the colours). */
function makePng(seed: number): Buffer {
  const w = 160
  const h = 100
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1)
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = (x * 255) / w
      raw[row + 2 + x * 3] = (y * 255) / h
      raw[row + 3 + x * 3] = seed
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A zip with stored (uncompressed) entries. */
function makeZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(33, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(33, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuf, end])
}

const PNG_A = makePng(40)
const PNG_B = makePng(200)
const jsonFile = (bank: unknown = BANK) => ({
  name: 'bank.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(bank)),
})
const zipFile = () => ({
  name: 'bank.zip',
  mimeType: 'application/zip',
  buffer: makeZip([
    { name: 'bank.json', data: Buffer.from(JSON.stringify(BANK)) },
    { name: 'images/sign-a.png', data: PNG_A },
    { name: 'images/sign-b.png', data: PNG_B },
  ]),
})

// ---- helpers -----------------------------------------------------------------------------

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

interface Area {
  fieldId: string
  slug: string
}
let counter = 0

/** A field with one area holding the topics t1..t3. */
async function makeArea(request: APIRequestContext): Promise<Area> {
  counter += 1
  const field = await request.post(`${API}/api/fields`, { headers: H, data: { title: `${PREFIX} field ${counter} ${STAMP}` } })
  expect(field.status(), await field.text()).toBe(201)
  const fieldId = ((await field.json()) as { id: string }).id
  const slug = `pe-${counter}-${STAMP}`
  const area = await request.post(`${API}/api/fields/${fieldId}/areas`, { headers: H, data: { slug, title: `Practice area ${counter}` } })
  expect(area.status(), await area.text()).toBe(201)
  const topics = await request.put(`${API}/api/areas/${slug}/topics`, { headers: H, data: { topics: TOPICS } })
  expect(topics.status(), await topics.text()).toBe(200)
  return { fieldId, slug }
}

async function importApi(request: APIRequestContext, slug: string, file = zipFile()): Promise<ApiBank> {
  const res = await request.post(`${API}/api/areas/${slug}/banks`, { headers: H, multipart: { file } })
  expect(res.status(), await res.text()).toBe(201)
  return res.json()
}

async function banksOf(request: APIRequestContext, slug: string): Promise<ApiBank[]> {
  const res = await request.get(`${API}/api/areas/${slug}/banks`)
  expect(res.status()).toBe(200)
  return res.json()
}

async function startExamApi(request: APIRequestContext, bankId: string): Promise<ApiExam> {
  const res = await request.post(`${API}/api/banks/${bankId}/exams`, { headers: H })
  expect(res.status(), await res.text()).toBe(201)
  return res.json()
}

async function deleteMyFields(request: APIRequestContext) {
  const res = await request.get(`${API}/api/fields`)
  if (res.status() !== 200) return
  const fields = (await res.json()) as Array<{ id: string; title: string; editable: boolean }>
  for (const f of fields.filter((x) => x.title.startsWith(PREFIX) && x.editable)) {
    await request.delete(`${API}/api/fields/${f.id}`, { headers: H })
  }
}

const member: { context: BrowserContext | null } = { context: null }

function newMemberContext(browser: Browser) {
  return browser.newContext({ baseURL: APP, storageState: SIGNED_OUT })
}

async function ensureMember(browser: Browser, request: APIRequestContext): Promise<BrowserContext> {
  if (member.context) return member.context
  const previous = latestOutboxToken('invite')
  const invited = await request.post(`${API}/api/admin/invitations`, { headers: H, data: { email: MEMBER.email } })
  expect(invited.status(), await invited.text()).toBe(201)
  const token = await nextOutboxToken('invite', previous)
  const context = await newMemberContext(browser)
  const accepted = await context.request.post(`${API}/api/auth/invitation/accept`, {
    headers: H,
    data: { token, password: MEMBER.password, display_name: MEMBER.name },
  })
  expect(accepted.status(), await accepted.text()).toBe(201)
  member.context = context
  return context
}

test.beforeAll(async ({ playwright }) => {
  const admin = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    await deleteMyFields(admin)
  } finally {
    await admin.dispose()
  }
})

test.afterEach(async ({ request }) => {
  await deleteMyFields(request)
})

test.afterAll(async ({ playwright }) => {
  test.setTimeout(120_000)
  const admin = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    await deleteMyFields(admin)
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

const card = (page: Page) => page.locator('.question-card')
const cardText = async (page: Page) => (await card(page).locator('.question-text').innerText()).trim()

/** Picks option `n` (1-based) of the question on screen. */
async function pick(page: Page, n: number) {
  await card(page).locator('.options label').nth(n - 1).click()
}

/**
 * Walks a test from its first question to the last, choosing `choose(number, critical)`
 * (1-based option, or null to leave it unanswered). Returns the made-up numbers in drawn order.
 */
async function walkExam(page: Page, choose: (n: number, critical: boolean) => number | null, onQuestion?: (i: number) => Promise<void>) {
  const numbers: number[] = []
  const total = await page.locator('nav.palette button').count()
  for (let i = 0; i < total; i++) {
    await expect(card(page).locator('h2')).toContainText(`Question ${i + 1} of ${total}`)
    const n = numberOf(await cardText(page))
    numbers.push(n)
    const c = choose(n, BY_NUMBER.get(n)!.critical)
    if (c !== null) await pick(page, c)
    if (onQuestion) await onQuestion(i)
    if (i < total - 1) await page.getByRole('button', { name: 'Next', exact: true }).click()
  }
  return numbers
}

async function startExamUi(page: Page, slug: string) {
  await page.goto(`/#/practice/${slug}`)
  await page.getByRole('button', { name: 'Start a test' }).click()
  await expect(page).toHaveURL(/#\/exam\/[0-9a-f-]+$/)
  await expect(page.getByRole('timer', { name: 'Time left' })).toBeVisible()
  await expect(page.locator('nav.palette button')).toHaveCount(10)
}

async function submitUi(page: Page) {
  await page.getByRole('button', { name: 'Submit test' }).click()
  await page.getByRole('button', { name: 'Yes, submit' }).click()
}

function answerKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => answerKeys(v, found))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'answer' || k === 'correct_option') found.push(k)
      answerKeys(v, found)
    }
  }
  return found
}

// ---- import ------------------------------------------------------------------------------

test('Import a zip: 12 questions with two pictures that show in practice', async ({ page, request }) => {
  const { slug } = await makeArea(request)
  await page.goto(`/#/roadmap/${slug}`)
  await expect(page.getByRole('button', { name: 'Import questions' })).toBeVisible()
  // Practice always shows for a field area, even without a bank.
  await expect(page.getByRole('link', { name: 'Practice' })).toHaveAttribute('href', `#/practice/${slug}`)
  await page.getByLabel('Question bank file').setInputFiles(zipFile())
  await expect(page.getByRole('status').filter({ hasText: 'Imported Synthetic QC bank: 12 questions.' })).toBeVisible()
  await expect(page.getByText(/pictures are missing/)).toHaveCount(0)

  const [bank] = await banksOf(request, slug)
  expect(bank.question_count).toBe(12)
  expect(bank.critical_count).toBe(2)
  expect(bank.images_missing).toBe(0)

  await page.getByRole('link', { name: 'Practice' }).click()
  await expect(page).toHaveURL(new RegExp(`#/practice/${slug}$`))
  await expect(page.getByRole('heading', { name: 'Synthetic QC bank' })).toBeVisible()
  const sets = page.getByRole('tablist', { name: 'Sets' })
  await expect(sets.getByRole('tab')).toHaveCount(7)
  await expect(sets.getByRole('tab', { name: /^All/ })).toContainText('12')
  await expect(sets.getByRole('tab', { name: /^Topic one/ })).toContainText('3')
  await expect(sets.getByRole('tab', { name: /^Topic two/ })).toContainText('5')
  await expect(sets.getByRole('tab', { name: /^Topic three/ })).toContainText('4')
  await expect(sets.getByRole('tab', { name: /^Critical/ })).toContainText('2')

  // Question 2 (topic one) has a picture.
  await sets.getByRole('tab', { name: /^Topic one/ }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(card(page).locator('h2')).toContainText('Question 2')
  const img = card(page).locator('img.question-image')
  await expect(img).toBeVisible()
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(160)
  await shotBoth(page, 'practice-exams-question-picture')
})

test('Questions first, pictures after: JSON import names 2 missing pictures, Add pictures attaches them', async ({ page, request }) => {
  const { slug } = await makeArea(request)
  await page.goto(`/#/roadmap/${slug}`)
  await page.getByLabel('Question bank file').setInputFiles(jsonFile())
  await expect(page.getByRole('status').filter({ hasText: 'Imported Synthetic QC bank: 12 questions.' })).toContainText('2 pictures are missing')
  const group = page.getByRole('group', { name: 'Pictures of Synthetic QC bank' })
  await expect(group).toContainText('2 pictures missing')

  const [bank] = await banksOf(request, slug)
  expect(bank.images_missing).toBe(2)
  const before = (await (await request.get(`${API}/api/banks/${bank.id}/questions`)).json()) as ApiQuestion[]
  expect(before.filter((q) => q.has_image)).toHaveLength(0)
  expect((await request.get(`${API}/api/questions/${before[1].id}/image`)).status()).toBe(404)

  // First batch: one matching picture, one that matches nothing.
  await group.getByLabel('Picture files').setInputFiles([
    { name: 'sign-a.png', mimeType: 'image/png', buffer: PNG_A },
    { name: 'stranger.png', mimeType: 'image/png', buffer: PNG_B },
  ])
  await expect(group).toContainText('Added 1 picture.')
  await expect(group).toContainText('1 did not match a question: stranger.png')
  await expect(group).toContainText('1 still missing')
  // Second batch: the last picture.
  await group.getByLabel('Picture files').setInputFiles([{ name: 'sign-b.png', mimeType: 'image/png', buffer: PNG_B }])
  await expect(group).toContainText('Added 1 picture.')
  await expect(group).toContainText('0 still missing')
  expect((await banksOf(request, slug))[0].images_missing).toBe(0)

  const after = (await (await request.get(`${API}/api/banks/${bank.id}/questions`)).json()) as ApiQuestion[]
  expect(after.filter((q) => q.has_image).map((q) => q.number)).toEqual([2, 9])
  const bytes = await request.get(`${API}/api/questions/${after[1].id}/image`)
  expect(bytes.status()).toBe(200)
  expect(bytes.headers()['content-type']).toContain('image/png')

  // The picture of question 9 shows in practice.
  await page.goto(`/#/practice/${slug}`)
  await page.getByRole('tab', { name: /^Topic three/ }).click()
  await expect(card(page).locator('h2')).toContainText('Question 9')
  const img = card(page).locator('img.question-image')
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(160)
})

test('Invalid bank: refused naming the questions, nothing stored', async ({ page, request }) => {
  const { slug } = await makeArea(request)
  const bad = JSON.parse(JSON.stringify(BANK)) as FixtureBank
  bad.questions[2].answer = 5 // question 3 has 3 options
  bad.questions[4].topic = 'no-such-topic' // question 5
  await page.goto(`/#/roadmap/${slug}`)
  await page.getByLabel('Question bank file').setInputFiles(jsonFile(bad))
  const alert = page.getByRole('alert').filter({ hasText: 'was not imported' })
  await expect(alert).toBeVisible()
  await expect(alert.locator('li', { hasText: /^Question 3:/ })).toBeVisible()
  await expect(alert.locator('li', { hasText: /^Question 5:/ })).toBeVisible()
  expect(await banksOf(request, slug)).toEqual([])
  // Nothing was stored: Practice still shows and leads to the no-banks message.
  await page.getByRole('link', { name: 'Practice' }).click()
  await expect(page.getByText('This area has no question banks yet.')).toBeVisible()

  const res = await request.post(`${API}/api/areas/${slug}/banks`, { headers: H, multipart: { file: jsonFile(bad) } })
  expect(res.status()).toBe(422)
  const detail = ((await res.json()) as { detail: Array<{ question: number | null; msg: string }> }).detail
  expect(detail.map((d) => d.question).sort()).toEqual([3, 5])
  expect(await banksOf(request, slug)).toEqual([])
})

// ---- practice ----------------------------------------------------------------------------

test('Practice a wrong answer: marked wrong, right option and explanation shown, grid turns wrong, then in Got wrong', async ({ page, request }) => {
  const { slug } = await makeArea(request)
  await importApi(request, slug)
  await page.goto(`/#/practice/${slug}`)
  const tab = (name: RegExp) => page.getByRole('tablist', { name: 'Sets' }).getByRole('tab', { name })
  const grid = page.getByRole('navigation', { name: 'Questions' })
  await expect(tab(/^Got wrong/)).toBeDisabled()

  await tab(/^Topic one/).click()
  await expect(grid.getByRole('button')).toHaveText(['1', '2', '3'])
  await expect(card(page).locator('h2')).toContainText('Question 1')
  await pick(page, wrongOption(1))
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Wrong' })).toBeVisible()
  const right = card(page).locator('.option.right')
  await expect(right).toContainText(`Alpha for item 1`)
  await expect(right).toContainText('Correct answer')
  await expect(card(page).locator('.option.wrong')).toContainText('Your answer')
  await expect(card(page).locator('.explanation')).toContainText('Made-up explanation 1.')
  // The grid shows it at once.
  await expect(grid.getByRole('button', { name: 'Question 1, wrong' })).toHaveClass(/wrong/)

  // A right answer on question 2 is not listed as wrong.
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await pick(page, rightOption(2))
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Right' })).toBeVisible()
  await expect(grid.getByRole('button', { name: 'Question 2, right' })).toHaveClass(/right/)

  await expect(tab(/^Got wrong/)).toBeEnabled()
  await expect(tab(/^Got wrong/)).toContainText('1')
  await tab(/^Got wrong/).click()
  await expect(grid.getByRole('button')).toHaveText(['1'])
  await expect(card(page).locator('h2')).toContainText('Question 1')
  await shotBoth(page, 'practice-browser-got-wrong')
})

// ---- practice question browser (change practice-question-browser) -------------------------

const sets = (page: Page) => page.getByRole('tablist', { name: 'Sets' })
const setTab = (page: Page, name: RegExp) => sets(page).getByRole('tab', { name })
const gridOf = (page: Page) => page.getByRole('navigation', { name: 'Questions' })
const gridButton = (page: Page, n: number) => gridOf(page).getByRole('button', { name: new RegExp(`^Question ${n}(,|$)`) })

async function questionsOf(request: APIRequestContext, bankId: string): Promise<ApiQuestion[]> {
  const res = await request.get(`${API}/api/banks/${bankId}/questions`)
  expect(res.status()).toBe(200)
  return res.json()
}

async function answerApi(request: APIRequestContext, bankId: string, n: number, choice: number) {
  const q = (await questionsOf(request, bankId)).find((x) => x.number === n)!
  const res = await request.post(`${API}/api/questions/${q.id}/answer`, { headers: H, data: { choice } })
  expect(res.status(), await res.text()).toBe(200)
}

test('Colours of the grid: right, wrong and the critical mark in every state', async ({ page, request }) => {
  const { slug } = await makeArea(request)
  const bank = await importApi(request, slug)
  await answerApi(request, bank.id, 3, rightOption(3))
  await answerApi(request, bank.id, 5, wrongOption(5))
  await page.goto(`/#/practice/${slug}`)
  await expect(setTab(page, /^All/)).toHaveAttribute('aria-selected', 'true')
  await expect(gridOf(page).getByRole('button')).toHaveCount(12)
  await expect(gridButton(page, 3)).toHaveAttribute('aria-label', 'Question 3, right')
  await expect(gridButton(page, 3)).toHaveClass(/right/)
  await expect(gridButton(page, 3)).not.toHaveClass(/critical/)
  await expect(gridButton(page, 5)).toHaveAttribute('aria-label', 'Question 5, wrong')
  await expect(gridButton(page, 5)).toHaveClass(/wrong/)
  // Critical and not answered: plain with the critical mark.
  await expect(gridButton(page, 8)).toHaveAttribute('aria-label', 'Question 8, critical')
  await expect(gridButton(page, 8)).toHaveClass(/critical/)
  await expect(gridButton(page, 8)).not.toHaveClass(/right|wrong/)
  await expect(gridButton(page, 12)).toHaveClass(/critical/)
  // Everything else is plain; the first question is the current one.
  for (const n of [2, 4, 6, 7, 9, 10, 11]) {
    await expect(gridButton(page, n)).toHaveAttribute('aria-label', `Question ${n}`)
    await expect(gridButton(page, n)).not.toHaveClass(/right|wrong|critical/)
  }
  await expect(gridButton(page, 1)).toHaveClass(/current/)
  // A critical question that is also answered keeps both.
  await answerApi(request, bank.id, 8, wrongOption(8))
  await page.reload()
  await expect(gridButton(page, 8)).toHaveAttribute('aria-label', 'Question 8, wrong, critical')
  await expect(gridButton(page, 8)).toHaveClass(/wrong/)
  await expect(gridButton(page, 8)).toHaveClass(/critical/)
  // Choosing a number opens that question.
  await gridButton(page, 7).click()
  await expect(card(page).locator('h2')).toContainText('Question 7')
  await expect(gridButton(page, 7)).toHaveClass(/current/)
  await shotBoth(page, 'practice-browser-grid')
})

test('Shuffle: every question once in a new order from its first question, grid keeps bank numbers', async ({ page, request }) => {
  const { slug } = await makeArea(request)
  await importApi(request, slug)
  await page.goto(`/#/practice/${slug}`)
  await setTab(page, /^Topic two/).click()
  await expect(gridOf(page).getByRole('button')).toHaveText(['4', '5', '6', '7', '8'])
  const seen = new Set<string>()
  let changed = false
  // A random order of 5 equals the original 1 time in 120; try a few times.
  for (let attempt = 0; attempt < 5 && !changed; attempt++) {
    await page.getByRole('button', { name: 'Shuffle' }).click()
    const order = (await gridOf(page).getByRole('button').allInnerTexts()).map((t) => t.trim())
    expect([...order].sort()).toEqual(['4', '5', '6', '7', '8'])
    // It starts at its first question.
    await expect(card(page).locator('h2')).toContainText(`Question ${order[0]}`)
    await expect(gridOf(page).getByRole('button').first()).toHaveClass(/current/)
    // Walking Next shows every question exactly once.
    seen.clear()
    for (let i = 0; i < order.length; i++) {
      await expect(card(page).locator('h2')).toContainText(`Question ${order[i]}`)
      seen.add(numberOf(await cardText(page)).toString())
      if (i < order.length - 1) await page.getByRole('button', { name: 'Next', exact: true }).click()
    }
    expect([...seen].sort()).toEqual(['4', '5', '6', '7', '8'])
    changed = order.join(',') !== '4,5,6,7,8'
  }
  expect(changed).toBe(true)
})

test('Saved answers: a wrong answer is kept, opens selected and marked after a reload, and a new right answer replaces it', async ({ page, request }) => {
  const { slug } = await makeArea(request)
  const bank = await importApi(request, slug)
  await page.goto(`/#/practice/${slug}`)
  await gridButton(page, 4).click()
  await expect(card(page).locator('h2')).toContainText('Question 4')
  const wrong = wrongOption(4)
  await pick(page, wrong)
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Wrong' })).toBeVisible()
  await expect(gridButton(page, 4)).toHaveClass(/wrong/)
  expect((await questionsOf(request, bank.id)).find((q) => q.number === 4)).toMatchObject({ last_correct: false })

  // Come back later (a new load of the page): the chosen option is selected and marked wrong.
  await page.reload()
  await gridButton(page, 4).click()
  await expect(card(page).locator('h2')).toContainText('Question 4')
  const chosen = card(page).locator('.options label').nth(wrong - 1)
  await expect(chosen.locator('input')).toBeChecked()
  await expect(chosen).toHaveClass(/wrong/)
  await expect(chosen).toContainText('Your answer')
  await expect(page.getByRole('button', { name: 'Check', exact: true })).toBeEnabled()
  await shotBoth(page, 'practice-browser-saved-answer')

  // Also from another browser (a fresh context of the same user).
  const other = await page.context().browser()!.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    const op = await other.newPage()
    await op.goto(`/#/practice/${slug}`)
    await gridButton(op, 4).click()
    await expect(op.locator('.question-card .options label').nth(wrong - 1)).toHaveClass(/wrong/)
    await expect(op.locator('.question-card .options label').nth(wrong - 1).locator('input')).toBeChecked()
  } finally {
    await other.close()
  }

  // Answer again with the right option: green, and gone from Got wrong.
  await setTab(page, /^Got wrong/).click()
  await expect(gridOf(page).getByRole('button')).toHaveText(['4'])
  await pick(page, rightOption(4))
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Right' })).toBeVisible()
  await expect(gridButton(page, 4)).toHaveClass(/right/)
  await expect(gridButton(page, 4)).not.toHaveClass(/wrong/)
  // The open set stays as it was (the list does not shift), but its count drops to 0 and it cannot be opened again.
  await expect(setTab(page, /^Got wrong/)).toContainText('0')
  await setTab(page, /^All/).click()
  await expect(setTab(page, /^Got wrong/)).toBeDisabled()
  expect((await questionsOf(request, bank.id)).find((q) => q.number === 4)).toMatchObject({ last_correct: true })
  await page.reload()
  await expect(setTab(page, /^Got wrong/)).toBeDisabled()
  await expect(gridButton(page, 4)).toHaveClass(/right/)
})

test('Bookmark and unbookmark: the Bookmarked set holds question 9 and is empty again after removing it', async ({ page, request }) => {
  const { slug } = await makeArea(request)
  await importApi(request, slug)
  await page.goto(`/#/practice/${slug}`)
  await expect(setTab(page, /^Bookmarked/)).toBeDisabled()
  await gridButton(page, 9).click()
  await expect(card(page).locator('h2')).toContainText('Question 9')
  const toggle = card(page).getByRole('button', { name: 'Bookmark' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(setTab(page, /^Bookmarked/)).toContainText('1')
  await setTab(page, /^Bookmarked/).click()
  await expect(gridOf(page).getByRole('button')).toHaveText(['9'])
  await expect(card(page).locator('h2')).toContainText('Question 9')
  await expect(card(page).getByRole('button', { name: 'Bookmark' })).toHaveAttribute('aria-pressed', 'true')
  await shotBoth(page, 'practice-browser-bookmarked')
  // It survives a reload.
  await page.reload()
  await expect(setTab(page, /^Bookmarked/)).toContainText('1')
  await setTab(page, /^Bookmarked/).click()
  await expect(gridOf(page).getByRole('button')).toHaveText(['9'])
  // Removing the bookmark empties the set.
  await card(page).getByRole('button', { name: 'Bookmark' }).click()
  await expect(card(page).getByRole('button', { name: 'Bookmark' })).toHaveAttribute('aria-pressed', 'false')
  await expect(setTab(page, /^Bookmarked/)).toContainText('0')
  await page.reload()
  await expect(setTab(page, /^Bookmarked/)).toBeDisabled()
})

test("Another user's bookmark: B's Bookmarked set is empty and B's bookmark leaves A's list alone", async ({ request, browser }) => {
  const { fieldId, slug } = await makeArea(request)
  const bank = await importApi(request, slug)
  const context = await ensureMember(browser, request)
  const m = context.request
  const published = await request.patch(`${API}/api/fields/${fieldId}`, { headers: H, data: { published: true } })
  expect(published.status(), await published.text()).toBe(200)
  const bookmarked = async (r: APIRequestContext) =>
    ((await (await r.get(`${API}/api/banks/${bank.id}/questions?bookmarked=true`)).json()) as ApiQuestion[]).map((q) => q.number)
  const q9 = (await questionsOf(request, bank.id)).find((q) => q.number === 9)!
  const q2 = (await questionsOf(request, bank.id)).find((q) => q.number === 2)!
  expect((await request.put(`${API}/api/questions/${q9.id}/bookmark`, { headers: H, data: { bookmarked: true } })).status()).toBe(200)
  expect(await bookmarked(request)).toEqual([9])
  expect(await bookmarked(m)).toEqual([])
  expect((await m.put(`${API}/api/questions/${q2.id}/bookmark`, { headers: H, data: { bookmarked: true } })).status()).toBe(200)
  expect(await bookmarked(m)).toEqual([2])
  expect(await bookmarked(request)).toEqual([9])
})

test('Area without a bank: the owner sees the message and Import questions, a member only the message', async ({ page, request, browser }) => {
  const { fieldId, slug } = await makeArea(request)
  await page.goto(`/#/roadmap/${slug}`)
  await expect(page.getByRole('link', { name: 'Practice' })).toBeVisible()
  await page.getByRole('link', { name: 'Practice' }).click()
  await expect(page).toHaveURL(new RegExp(`#/practice/${slug}$`))
  await expect(page.getByText('This area has no question banks yet.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Import questions' })).toBeVisible()
  await shotBoth(page, 'practice-browser-no-bank')

  // The member sees the message of a published area without the import.
  const context = await ensureMember(browser, request)
  const published = await request.patch(`${API}/api/fields/${fieldId}`, { headers: H, data: { published: true } })
  expect(published.status(), await published.text()).toBe(200)
  const mp = await context.newPage()
  try {
    await mp.goto(`/#/roadmap/${slug}`)
    await expect(mp.getByRole('link', { name: 'Practice' })).toBeVisible()
    await mp.getByRole('link', { name: 'Practice' }).click()
    await expect(mp.getByText('This area has no question banks yet.')).toBeVisible()
    await expect(mp.getByRole('button', { name: 'Import questions' })).toHaveCount(0)
    await expect(mp.getByLabel('Question bank file')).toHaveCount(0)
  } finally {
    await mp.close()
  }

  // The owner imports from the practice page: the bank shows up there.
  await page.getByLabel('Question bank file').setInputFiles(zipFile())
  await expect(page.getByRole('heading', { name: 'Synthetic QC bank' })).toBeVisible()
  expect((await banksOf(request, slug))[0].question_count).toBe(12)
})

// ---- exam --------------------------------------------------------------------------------

test('Draw follows the rules and no answer reaches the browser before submit', async ({ request }) => {
  const { slug } = await makeArea(request)
  const bank = await importApi(request, slug)
  for (let run = 0; run < 3; run++) {
    const exam = await startExamApi(request, bank.id)
    expect(exam.questions).toHaveLength(10)
    expect(new Set(exam.questions.map((q) => q.id)).size).toBe(10)
    expect(exam.questions.filter((q) => q.topic === 't1')).toHaveLength(3)
    expect(exam.questions.filter((q) => q.critical).length).toBeGreaterThanOrEqual(1)
    expect(exam.submitted_at).toBeNull()
    expect(exam.result).toBeNull()
    expect(answerKeys(exam)).toEqual([])
    const raw = await (await request.get(`${API}/api/exams/${exam.id}`)).text()
    expect(raw).not.toMatch(/"answer"\s*:/)
    expect(raw).not.toContain('Made-up explanation')
    const minutes = (new Date(exam.deadline).getTime() - new Date(exam.started_at).getTime()) / 60_000
    expect(minutes).toBeCloseTo(2, 1)
  }
  const list = await request.get(`${API}/api/banks/${bank.id}/questions`)
  expect(answerKeys(await list.json())).toEqual([])
  expect(await list.text()).not.toContain('Made-up explanation')
})

test('Pass: 9 right with every critical question right is passed 9/10', async ({ page, request }) => {
  const { slug } = await makeArea(request)
  await importApi(request, slug)
  await startExamUi(page, slug)
  let skipped = false
  await walkExam(
    page,
    (n, critical) => {
      if (!critical && !skipped) {
        skipped = true
        return wrongOption(n)
      }
      return rightOption(n)
    },
    async (i) => {
      if (i === 3) {
        // Mid-test: palette with answered numbers, timer, a question on screen.
        await expect(page.locator('nav.palette button.answered')).toHaveCount(4)
        await shotBoth(page, 'practice-exams-exam')
      }
    },
  )
  await page.getByRole('button', { name: 'Submit test' }).click()
  await expect(page.getByRole('alertdialog', { name: 'Confirm submit' })).toContainText('Submit your test now?')
  await page.getByRole('button', { name: 'Yes, submit' }).click()
  await expect(page.getByRole('heading', { name: 'Passed', level: 1 })).toBeVisible()
  await expect(page.getByText('Score: 9/10')).toBeVisible()
  await expect(page.getByRole('note')).toHaveCount(0)
  await expect(page.locator('.review-item')).toHaveCount(10)
  await expect(page.locator('.review-item.bad')).toHaveCount(1)
  await expect(page.locator('.review-item .option.right').first()).toContainText('Correct answer')
  await shotBoth(page, 'practice-exams-result')
})

test('Fail on a critical question: 9/10 reaches the pass mark but the result is failed and names it', async ({ page, request }) => {
  const { slug } = await makeArea(request)
  await importApi(request, slug)
  await startExamUi(page, slug)
  const criticalWrong: number[] = []
  await walkExam(page, (n, critical) => {
    if (critical && criticalWrong.length === 0) {
      criticalWrong.push(n)
      return wrongOption(n)
    }
    return rightOption(n)
  })
  expect(criticalWrong).toHaveLength(1)
  await submitUi(page)
  await expect(page.getByRole('heading', { name: 'Failed', level: 1 })).toBeVisible()
  await expect(page.getByText('Score: 9/10')).toBeVisible()
  await expect(page.getByRole('note')).toContainText(`critical question ${criticalWrong[0]} was answered wrong`)
  await expect(page.locator('.review-item.bad')).toContainText(`Question ${criticalWrong[0]}`)
  await expect(page.locator('.review-item.bad .crit-badge')).toBeVisible()
})

test('Time out: the countdown ends, the test is submitted and unanswered questions count as wrong', async ({ page, request }) => {
  const { slug } = await makeArea(request)
  await importApi(request, slug)
  await page.clock.install()
  await startExamUi(page, slug)
  await expect(page.getByRole('timer', { name: 'Time left' })).toHaveText(/0[12]:\d\d/)
  // Answer the first two questions right, leave eight unanswered.
  for (let i = 0; i < 2; i++) {
    await pick(page, rightOption(numberOf(await cardText(page))))
    await page.getByRole('button', { name: 'Next', exact: true }).click()
  }
  await expect(page.locator('nav.palette button.answered')).toHaveCount(2)
  await expect(page.getByRole('heading', { name: 'Test', level: 1 })).toBeVisible()
  await page.clock.fastForward('02:05')
  await expect(page.getByRole('heading', { name: 'Failed', level: 1 })).toBeVisible()
  await expect(page.getByText('Score: 2/10')).toBeVisible()
  await expect(page.locator('.review-item', { hasText: 'Not answered' })).toHaveCount(8)
  await expect(page.locator('.review-item.ok')).toHaveCount(2)
})

// ---- history and access ------------------------------------------------------------------

test('History lists the tests with score and result, and a test opens with its review', async ({ page, request }) => {
  const { slug } = await makeArea(request)
  const bank = await importApi(request, slug)
  await page.goto(`/#/practice/${slug}`)
  await expect(page.getByText('No tests yet.')).toBeVisible()

  // One test with every answer right (passed), one with every answer wrong (failed), through the API.
  const answersFor = (exam: ApiExam, right: boolean) =>
    Object.fromEntries(exam.questions.map((q) => [q.id, right ? rightOption(numberOf(q.text)) : wrongOption(numberOf(q.text))]))
  const passedExam = await startExamApi(request, bank.id)
  const passedRes = await request.post(`${API}/api/exams/${passedExam.id}/submit`, { headers: H, data: { answers: answersFor(passedExam, true) } })
  expect(passedRes.status(), await passedRes.text()).toBe(200)
  expect(((await passedRes.json()) as ApiExam).result).toMatchObject({ score: 10, total: 10, passed: true })
  const failedExam = await startExamApi(request, bank.id)
  const failedRes = await request.post(`${API}/api/exams/${failedExam.id}/submit`, { headers: H, data: { answers: answersFor(failedExam, false) } })
  expect(((await failedRes.json()) as ApiExam).result).toMatchObject({ score: 0, total: 10, passed: false })

  const summaries = (await (await request.get(`${API}/api/banks/${bank.id}/exams`)).json()) as Array<{ id: string; score: number | null; passed: boolean | null }>
  expect(summaries.map((s) => s.id)).toEqual([failedExam.id, passedExam.id]) // newest first

  // Same hash, so the page is not reloaded by goto: reload to see tests made behind its back.
  await page.reload()
  const rows = page.getByRole('list', { name: 'Past tests' }).getByRole('listitem')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('0/10')
  await expect(rows.nth(0)).toContainText('Failed')
  await expect(rows.nth(1)).toContainText('10/10')
  await expect(rows.nth(1)).toContainText('Passed')

  await rows.nth(1).getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`#/exam/${passedExam.id}$`))
  await expect(page.getByRole('heading', { name: 'Passed', level: 1 })).toBeVisible()
  await expect(page.getByText('Score: 10/10')).toBeVisible()
  await expect(page.locator('.review-item')).toHaveCount(10)
})

test('Member: practises a bank of the admin\'s published area, cannot import or delete; admin tests are not found for them', async ({
  page,
  request,
  browser,
}) => {
  const { fieldId, slug } = await makeArea(request)
  const bank = await importApi(request, slug)
  const context = await ensureMember(browser, request)
  const m = context.request
  // The admin got question 1 wrong and has a test of their own.
  const adminQuestions = (await (await request.get(`${API}/api/banks/${bank.id}/questions`)).json()) as ApiQuestion[]
  const q1 = adminQuestions.find((q) => q.number === 1)!
  const wrongRes = await request.post(`${API}/api/questions/${q1.id}/answer`, { headers: H, data: { choice: wrongOption(1) } })
  expect(wrongRes.status()).toBe(200)
  expect(await wrongRes.json()).toMatchObject({ correct: false, answer: 1 })
  const adminExam = await startExamApi(request, bank.id)

  // Private area: unknown to the member.
  expect((await m.get(`${API}/api/areas/${slug}/banks`)).status()).toBe(404)

  const published = await request.patch(`${API}/api/fields/${fieldId}`, { headers: H, data: { published: true } })
  expect(published.status(), await published.text()).toBe(200)

  const banks = (await (await m.get(`${API}/api/areas/${slug}/banks`)).json()) as ApiBank[]
  expect(banks.map((b) => b.id)).toEqual([bank.id])
  // Cannot import or delete.
  const imp = await m.post(`${API}/api/areas/${slug}/banks`, { headers: H, multipart: { file: jsonFile() } })
  expect(imp.status()).toBe(403)
  expect((await m.delete(`${API}/api/banks/${bank.id}`, { headers: H })).status()).toBe(403)
  expect((await m.post(`${API}/api/banks/${bank.id}/images`, { headers: H, multipart: { files: { name: 'sign-a.png', mimeType: 'image/png', buffer: PNG_A } } })).status()).toBe(403)
  expect(await banksOf(request, slug)).toHaveLength(1)

  // The admin's answers are not the member's.
  const memberQuestions = (await (await m.get(`${API}/api/banks/${bank.id}/questions`)).json()) as ApiQuestion[]
  expect(memberQuestions.every((q) => q.last_correct === null)).toBe(true)
  const wrongList = (await (await m.get(`${API}/api/banks/${bank.id}/questions?wrong=true`)).json()) as ApiQuestion[]
  expect(wrongList).toEqual([])

  // Another user's test is not found, for reading, saving and submitting.
  expect((await m.get(`${API}/api/exams/${adminExam.id}`)).status()).toBe(404)
  expect((await m.put(`${API}/api/exams/${adminExam.id}/answers`, { headers: H, data: { answers: {} } })).status()).toBe(404)
  expect((await m.post(`${API}/api/exams/${adminExam.id}/submit`, { headers: H, data: { answers: {} } })).status()).toBe(404)
  expect((await (await m.get(`${API}/api/banks/${bank.id}/exams`)).json()) as unknown[]).toEqual([])

  // In the browser: no import control, practice works, the admin's test id shows "Test not found".
  const mp = await context.newPage()
  try {
    await mp.goto(`/#/roadmap/${slug}`)
    await expect(mp.getByRole('link', { name: 'Practice' })).toBeVisible()
    await expect(mp.getByRole('button', { name: 'Import questions' })).toHaveCount(0)
    await mp.getByRole('link', { name: 'Practice' }).click()
    await expect(mp.getByRole('heading', { name: 'Synthetic QC bank' })).toBeVisible()
    await expect(mp.getByRole('tab', { name: /^Got wrong/ })).toBeDisabled()
    await mp.getByRole('tab', { name: /^Topic one/ }).click()
    await mp.locator('.question-card .options label').nth(rightOption(1) - 1).click()
    await mp.getByRole('button', { name: 'Check' }).click()
    await expect(mp.getByRole('status').filter({ hasText: 'Right' })).toBeVisible()
    await mp.goto(`/#/exam/${adminExam.id}`)
    await expect(mp.getByRole('heading', { name: 'Test not found' })).toBeVisible()
  } finally {
    await mp.close()
  }

  // The member can start a test of their own on the published bank; the admin does not see it.
  const own = await m.post(`${API}/api/banks/${bank.id}/exams`, { headers: H })
  expect(own.status()).toBe(201)
  const ownId = ((await own.json()) as ApiExam).id
  expect((await request.get(`${API}/api/exams/${ownId}`)).status()).toBe(404)
  await page.goto(`/#/exam/${ownId}`)
  await expect(page.getByRole('heading', { name: 'Test not found' })).toBeVisible()
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('phone: the practice browser fits a phone with no sideways scroll', async ({ page, request }) => {
    const { slug } = await makeArea(request)
    await importApi(request, slug)
    await page.goto(`/#/practice/${slug}`)
    await expect(gridOf(page).getByRole('button')).toHaveCount(12)
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(await overflow()).toBeLessThanOrEqual(1)
    await gridButton(page, 2).click()
    await expect(card(page).locator('img.question-image')).toBeVisible()
    expect(await overflow()).toBeLessThanOrEqual(1)
    // Grid above the card, at most about 40 % of the viewport high.
    const grid = (await gridOf(page).boundingBox())!
    const cardBox = (await card(page).boundingBox())!
    expect(grid.y + grid.height).toBeLessThanOrEqual(cardBox.y + 1)
    expect(grid.height).toBeLessThanOrEqual(844 * 0.42)
    await shotBoth(page, 'practice-browser-phone')
  })

  test('phone: the exam page fits a phone with no sideways scroll', async ({ page, request }) => {
    const { slug } = await makeArea(request)
    const bank = await importApi(request, slug)
    const exam = await startExamApi(request, bank.id)
    await page.goto(`/#/exam/${exam.id}`)
    await expect(page.getByRole('timer', { name: 'Time left' })).toBeVisible()
    await expect(page.locator('nav.palette button')).toHaveCount(10)
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(await overflow()).toBeLessThanOrEqual(1)
    // A question with a picture and four options, the widest content.
    const withPicture = exam.questions.findIndex((q) => q.has_image)
    if (withPicture >= 0) await page.getByRole('button', { name: `Question ${withPicture + 1}`, exact: true }).click()
    await expect(card(page).locator('h2')).toBeVisible()
    expect(await overflow()).toBeLessThanOrEqual(1)
    await shotBoth(page, 'practice-exams-exam-phone')
  })
})
