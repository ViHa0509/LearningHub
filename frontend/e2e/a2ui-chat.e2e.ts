/// <reference lib="dom" />
/**
 * Spec checks for the change a2ui-chat-agent (openspec/changes/a2ui-chat-agent/specs/a2ui-chat,
 * agent-chat, agent-providers): "quiz me", "practice" and "interactive lesson" in the chat panel
 * answer with an interactive surface; grading happens on the server; stored chats keep progress.
 *
 * The model is the fake OpenAI-compatible server (e2e/fake_llm.py, `_a2ui`): the assistant calls
 * show_interactive for "quiz me" / "practice" / "interactive lesson"; the Interactive tutor gets
 * fixed content (quiz "Docker networking quiz": 3 questions of 3 options, the right option is 2,
 * explanations "Explanation N."; question 3 holds an <img onerror> and an outside Markdown image;
 * lesson "Docker volumes" with a check question, answer 2).
 *
 * Every chat made here starts with PREFIX and is removed afterwards, as are the providers and the
 * areas. Scenarios that no browser can see (the backend's 404 for another user's surface, the
 * shared-mode daily count, the claude-code refusal, the backup leaving surfaces out) are covered in
 * backend/tests (test_a2ui_actions, test_isolation_a2ui, test_a2ui_chat, test_a2ui_runner).
 */
import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test.describe.configure({ timeout: 60_000 })

const API = 'http://127.0.0.1:8001'
const FAKE = 'http://127.0.0.1:8002/v1'
const H = { 'X-LearningHub': '1' }
const ANSWER_TIMEOUT = 25_000
const PREFIX = 'QC-a2ui'
const STAMP = Date.now().toString(36)

let counter = 0
const unique = (label: string) => `${PREFIX} ${label} ${STAMP}${counter++}`
const createdProviders: string[] = []
const createdFields: string[] = []

const isChat = (r: Request) => r.url().endsWith('/api/agent/chat') && r.method() === 'POST'
const isAction = (r: Request) => /\/api\/a2ui\/surfaces\/[^/]+\/actions$/.test(r.url()) && r.method() === 'POST'

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

async function assign(request: APIRequestContext, agent: string, primary: string | null) {
  const res = await request.put(`${API}/api/agents/${agent}/provider`, {
    headers: H,
    data: { primary_provider_id: primary, fallback_provider_id: null },
  })
  expect(res.status(), await res.text()).toBe(200)
}

async function makeProvider(request: APIRequestContext) {
  const res = await request.post(`${API}/api/ai-providers`, {
    headers: H,
    data: { name: unique('provider'), provider_type: 'local', model_name: 'fake-ok', base_url: FAKE, config: {} },
  })
  expect(res.status(), await res.text()).toBe(201)
  const body = (await res.json()) as { id: string }
  createdProviders.push(body.id)
  return body.id
}

test.afterEach(async ({ request }) => {
  const sessions = (await (await request.get(`${API}/api/agent/sessions?limit=200`)).json()) as { sessions: { id: string; title: string }[] }
  for (const s of sessions.sessions.filter((x) => x.title.startsWith(PREFIX))) {
    await request.delete(`${API}/api/agent/sessions/${s.id}`, { headers: H })
  }
  for (const agent of ['assistant', 'a2ui']) await assign(request, agent, null)
  while (createdProviders.length > 0) await request.delete(`${API}/api/ai-providers/${createdProviders.pop()}`, { headers: H })
  while (createdFields.length > 0) await request.delete(`${API}/api/fields/${createdFields.pop()}`, { headers: H })
})

/** Providers for the assistant and the Interactive tutor, then the app opened at `hash`. */
async function openChat(page: Page, request: APIRequestContext, hash = '#/') {
  const id = await makeProvider(request)
  await assign(request, 'assistant', id)
  await assign(request, 'a2ui', id)
  await page.goto(`/${hash}`)
  const agent = page.getByRole('complementary', { name: 'Agent' })
  const box = agent.getByRole('textbox', { name: 'Message the agent' })
  await expect(box).toBeVisible()
  return { agent, box, log: agent.getByRole('log', { name: 'Conversation' }) }
}

async function send(box: ReturnType<Page['getByRole']>, text: string) {
  await box.fill(text)
  await box.press('Enter')
}

type Log = ReturnType<Page['getByRole']>
const checks = (log: Log) => log.getByRole('button', { name: 'Check', exact: true })
const option = (log: Log, text: string, n = 0) => log.getByText(text, { exact: true }).nth(n)

/** "quiz me": the answer text and the quiz with its three questions are on screen. */
async function askQuiz(box: Log, log: Log, label: string) {
  const message = unique(`${label} quiz me`)
  await send(box, message)
  await expect(log.getByText('Here is your quiz.')).toBeVisible({ timeout: ANSWER_TIMEOUT })
  await expect(log.getByRole('heading', { name: 'Docker networking quiz' })).toBeVisible()
  await expect(checks(log)).toHaveCount(3)
  return message
}

// ---- the quiz ----------------------------------------------------------------------------

test('Quiz me: the answer text, then the quiz with its questions, options and a Check button per question', async ({ page, request }) => {
  const { box, log } = await openChat(page, request)
  await askQuiz(box, log, 'shows')
  await expect(log.getByText('Which network mode is the default?')).toBeVisible()
  await expect(log.getByText('How do containers find each other?')).toBeVisible()
  await expect(log.getByText(/^Which driver\?/)).toBeVisible()
  await expect(log.getByText('Option one', { exact: true })).toHaveCount(3)
  await expect(log.getByText('Option two', { exact: true })).toHaveCount(3)
  await expect(log.getByText('Option three', { exact: true })).toHaveCount(3)
  await expect(log.getByText('0 / 3 answered, 0 correct')).toBeVisible()
  // The answer text comes before the quiz.
  const text = await log.getByText('Here is your quiz.').boundingBox()
  const title = await log.getByRole('heading', { name: 'Docker networking quiz' }).boundingBox()
  expect(text!.y).toBeLessThan(title!.y)
  await shotBoth(page, 'a2ui-chat-quiz')
})

test('Grade an answer: right shows Correct with the explanation and the score; wrong shows Not quite; a second answer keeps the first result', async ({
  page,
  request,
}) => {
  const { box, log } = await openChat(page, request)
  await askQuiz(box, log, 'grade')

  // Right answer (option 2) on question 1.
  await option(log, 'Option two', 0).click()
  await checks(log).nth(0).click()
  await expect(log.getByText('Correct. Explanation 1.')).toBeVisible()
  await expect(log.getByText('✓ Correct', { exact: true })).toHaveCount(1)
  await expect(log.getByText('1 / 3 answered, 1 correct')).toBeVisible()

  // Wrong answer (option 1) on question 2: the right option's text is named.
  await option(log, 'Option one', 1).click()
  await checks(log).nth(1).click()
  await expect(log.getByText('Not quite. The answer is "Option two". Explanation 2.')).toBeVisible()
  await expect(log.getByText('✗ Not quite', { exact: true })).toHaveCount(1)
  // The correct option is marked after grading (questions 1 and 2).
  await expect(log.getByText('Option two ✓', { exact: true })).toHaveCount(2)
  await expect(log.getByText('Option one ✓')).toHaveCount(0)
  await expect(log.getByText('2 / 3 answered, 1 correct')).toBeVisible()
  await shotBoth(page, 'a2ui-chat-quiz-partial')

  // Answering question 1 again with another option: the first result stays, the score does not move.
  await option(log, 'Option one', 0).click()
  const action = page.waitForRequest(isAction)
  await checks(log).nth(0).click()
  const captured = await action
  await expect(log.getByText('Correct. Explanation 1.')).toBeVisible()
  await expect(log.getByText('2 / 3 answered, 1 correct')).toBeVisible()
  await expect(log.getByText(/Not quite\. The answer is "Option two"\. Explanation 1\./)).toHaveCount(0)

  // The same, straight at the API: another option for a graded question returns the first result.
  const body = captured.postData() ?? ''
  const replay = await page.request.post(captured.url(), {
    headers: { ...H, 'Content-Type': 'application/json' },
    data: body.replace(/"1"/g, '"3"'),
  })
  expect(replay.status(), await replay.text()).toBe(200)
  const replyText = await replay.text()
  expect(replyText).toContain('Correct. Explanation 1.')
  expect(replyText).not.toContain('Not quite')
  expect(replyText).toContain('2 / 3 answered, 1 correct')
})

test('Grade an answer: the action route needs the app header and refuses an unknown action or question', async ({ page, request }) => {
  const { box, log } = await openChat(page, request)
  const capturedAction = page.waitForRequest(isAction)
  await askQuiz(box, log, 'refuse')
  await option(log, 'Option two', 0).click()
  await checks(log).nth(0).click()
  const captured = await capturedAction
  await expect(log.getByText('Correct. Explanation 1.')).toBeVisible()
  const json = JSON.parse(captured.postData() ?? '{}') as { action: { name: string; context: { question: string } } }

  const noHeader = await page.request.post(captured.url(), { data: json })
  expect(noHeader.status()).toBe(403)

  const other = structuredClone(json)
  other.action.name = 'something_else'
  const unknownAction = await page.request.post(captured.url(), { headers: H, data: other })
  expect(unknownAction.status()).toBe(400)

  const noQuestion = structuredClone(json)
  noQuestion.action.context.question = 'q99'
  const unknownQuestion = await page.request.post(captured.url(), { headers: H, data: noQuestion })
  expect(unknownQuestion.status()).toBe(400)
  // Nothing was recorded by the refused calls.
  await expect(log.getByText('1 / 3 answered, 1 correct')).toBeVisible()
})

test('Inspect the chat answer: the surface messages hold the questions and no correct option or explanation', async ({ page, request }) => {
  const { box, log } = await openChat(page, request)
  const response = page.waitForResponse((r) => isChat(r.request()))
  await askQuiz(box, log, 'inspect')
  const chat = (await (await response).json()) as { reply: string; surfaces: { kind: string; messages: unknown[] }[] }
  expect(chat.reply).toContain('Here is your quiz.')
  expect(chat.surfaces).toHaveLength(1)
  expect(chat.surfaces[0].kind).toBe('quiz')
  const raw = JSON.stringify(chat.surfaces[0].messages)
  expect(raw).toContain('Which network mode is the default?')
  expect(raw).toContain('Option two')
  expect(raw).not.toMatch(/explanation/i)
  expect(raw).not.toMatch(/"answer"\s*:/)
  expect(raw).not.toMatch(/correct_option|"correct"\s*:/)
  // The surface tool result given to the model names no answers either (the fake echoes nothing),
  // and the stored chat shows the same: no key before an answer.
  const sessionId = (await (await request.get(`${API}/api/agent/sessions?limit=50`)).json()).sessions.find(
    (s: { title: string }) => s.title.startsWith(PREFIX),
  ).id as string
  const stored = JSON.stringify(await (await request.get(`${API}/api/agent/sessions/${sessionId}`)).json())
  expect(stored).not.toMatch(/Explanation \d/)
})

// ---- practice ----------------------------------------------------------------------------

const BANK = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'practice-bank.json'), 'utf8')) as {
  questions: { number: number; topic: string; text: string; options: string[]; answer: number; explanation: string; image?: string }[]
}
const TOPICS = [
  { slug: 't1', title: 'Topic one', description: null, parent: null },
  { slug: 't2', title: 'Topic two', description: null, parent: null },
  { slug: 't3', title: 'Topic three', description: null, parent: null },
]

async function makeArea(request: APIRequestContext, withBank: boolean) {
  const field = await request.post(`${API}/api/fields`, { headers: H, data: { title: unique('field') } })
  expect(field.status(), await field.text()).toBe(201)
  const fieldId = ((await field.json()) as { id: string }).id
  createdFields.push(fieldId)
  const slug = `qa-${STAMP}-${counter++}`
  const area = await request.post(`${API}/api/fields/${fieldId}/areas`, { headers: H, data: { slug, title: `A2UI area ${counter}` } })
  expect(area.status(), await area.text()).toBe(201)
  const topics = await request.put(`${API}/api/areas/${slug}/topics`, { headers: H, data: { topics: TOPICS } })
  expect(topics.status(), await topics.text()).toBe(200)
  let bankId = ''
  if (withBank) {
    const bank = { ...JSON.parse(JSON.stringify({ title: 'A2UI QC bank', rules: { questions: 10, minutes: 2, pass_mark: 8, critical_fails: false, min_critical: 0, per_topic: {} } })), questions: BANK.questions.map(({ image: _image, ...q }) => ({ ...q, critical: false })) }
    const res = await request.post(`${API}/api/areas/${slug}/banks`, {
      headers: H,
      multipart: { file: { name: 'bank.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bank)) } },
    })
    expect(res.status(), await res.text()).toBe(201)
    bankId = ((await res.json()) as { id: string }).id
  }
  return { slug, bankId }
}

test('Practice from the question bank: the questions come from the imported bank, and a wrong chat answer lands in the wrong-questions list', async ({
  page,
  request,
}) => {
  const { slug, bankId } = await makeArea(request, true)
  const { box, log } = await openChat(page, request, `#/roadmap/${slug}`)
  await send(box, unique('bank practice'))
  await expect(log.getByText('Here is your practice.')).toBeVisible({ timeout: ANSWER_TIMEOUT })
  // Bank questions, not the generated quiz.
  await expect(log.getByRole('heading', { name: 'Docker networking quiz' })).toHaveCount(0)
  await expect(log.getByText(/Fixture question \d+:/)).toHaveCount(3)
  await expect(checks(log)).toHaveCount(3)
  await shotBoth(page, 'a2ui-chat-practice-bank')

  // Answer the first question wrong.
  const first = await log.getByText(/Fixture question \d+:/).first().innerText()
  const n = Number(/Fixture question (\d+):/.exec(first)![1])
  const q = BANK.questions.find((x) => x.number === n)!
  const right = q.options[q.answer - 1]
  const wrong = q.options.find((_, i) => i + 1 !== q.answer)!
  await log.getByText(wrong, { exact: true }).first().click()
  await checks(log).first().click()
  await expect(log.getByText(`Not quite. The answer is "${right}". ${q.explanation}`)).toBeVisible()

  const list = await request.get(`${API}/api/banks/${bankId}/questions?wrong=true`)
  expect(list.status()).toBe(200)
  const wrongTexts = ((await list.json()) as { text: string }[]).map((x) => x.text)
  expect(wrongTexts).toContain(q.text)
})

test('Practice without a bank: the questions are generated as for a quiz', async ({ page, request }) => {
  const { slug } = await makeArea(request, false)
  const { box, log } = await openChat(page, request, `#/roadmap/${slug}`)
  await send(box, unique('nobank practice'))
  await expect(log.getByText('Here is your practice.')).toBeVisible({ timeout: ANSWER_TIMEOUT })
  await expect(log.getByRole('heading', { name: 'Docker networking quiz' })).toBeVisible()
  await expect(checks(log)).toHaveCount(3)
  await shot(page, 'a2ui-chat-practice-generated')
})

// ---- lesson ------------------------------------------------------------------------------

test('Creative lesson: the sections show in order and the check-yourself question can be answered', async ({ page, request }) => {
  const { box, log } = await openChat(page, request)
  await send(box, unique('interactive lesson'))
  await expect(log.getByText('Here is your lesson.')).toBeVisible({ timeout: ANSWER_TIMEOUT })
  await expect(log.getByRole('heading', { name: 'Docker volumes' })).toBeVisible()
  const heads = ['What is a volume', 'Why', 'Try it', 'Where do volumes live?']
  const ys: number[] = []
  for (const h of heads) {
    const target = log.getByText(h, { exact: true })
    await expect(target).toBeVisible()
    ys.push((await target.boundingBox())!.y)
  }
  expect(ys).toEqual([...ys].sort((a, b) => a - b))
  await expect(log.getByText('A volume keeps data after a container ends.')).toBeVisible()
  await expect(checks(log)).toHaveCount(1)
  await option(log, 'Outside the container').click()
  await checks(log).click()
  await expect(log.getByText('Correct. Volumes live outside the container.')).toBeVisible()
  await expect(log.getByText('1 / 1 answered, 1 correct')).toBeVisible()
  await log.getByRole('heading', { name: 'Docker volumes' }).evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await shotBoth(page, 'a2ui-chat-lesson')
})

// ---- stored chats ------------------------------------------------------------------------

test('Reopen a chat: the results and the score are kept and the unanswered question can still be answered', async ({ page, request }) => {
  const { agent, box, log } = await openChat(page, request)
  const message = await askQuiz(box, log, 'reopen')
  await option(log, 'Option two', 0).click()
  await checks(log).nth(0).click()
  await expect(log.getByText('Correct. Explanation 1.')).toBeVisible()
  await option(log, 'Option one', 1).click()
  await checks(log).nth(1).click()
  await expect(log.getByText('Not quite. The answer is "Option two". Explanation 2.')).toBeVisible()
  await expect(log.getByText('2 / 3 answered, 1 correct')).toBeVisible()

  // Another chat, then back to the quiz from History.
  await agent.getByRole('button', { name: 'New chat' }).click()
  await expect(log).not.toContainText('Docker networking quiz')
  await agent.getByRole('button', { name: 'History' }).click()
  const history = agent.getByRole('region', { name: 'Chat history' })
  await history.locator('.history-row').filter({ hasText: message.slice(0, 60) }).click()

  await expect(log.getByRole('heading', { name: 'Docker networking quiz' })).toBeVisible({ timeout: ANSWER_TIMEOUT })
  await expect(log.getByText('Correct. Explanation 1.')).toBeVisible()
  await expect(log.getByText('Not quite. The answer is "Option two". Explanation 2.')).toBeVisible()
  await expect(log.getByText('2 / 3 answered, 1 correct')).toBeVisible()
  await shotBoth(page, 'a2ui-chat-quiz-reopened')

  // Question 3 is still open.
  await option(log, 'Option two', 0).click() // the right options of questions 1 and 2 now end in a check mark
  await checks(log).nth(2).click()
  await expect(log.getByText('Correct. Explanation 3.')).toBeVisible()
  await expect(log.getByText('3 / 3 answered, 2 correct')).toBeVisible()
})

// ---- untrusted text ----------------------------------------------------------------------

test('Injected markup in a question: no element is made, no request goes to tracker.example, and the text shows as text', async ({
  page,
  request,
}) => {
  const outside: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('tracker.example')) outside.push(r.url())
  })
  const { box, log } = await openChat(page, request)
  await askQuiz(box, log, 'markup')
  const third = log.getByText(/^Which driver\?/)
  await expect(third).toBeVisible()
  // The HTML is shown as text, not made into an element.
  await expect(third).toContainText('<img src=x onerror=')
  await expect(log.locator('img')).toHaveCount(0)
  // The outside image shows as its alt text and address.
  await expect(third).toContainText('https://tracker.example/p.png')
  await expect(log.locator('img[src*="tracker.example"]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
  // Give a late image request time to appear, by waiting on a settled network.
  await page.waitForLoadState('networkidle')
  expect(outside).toEqual([])
  await third.scrollIntoViewIfNeeded()
  await third.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await shot(page, 'a2ui-chat-quiz-markup')
})

test('Injected markup in an answer: a Markdown image from outside the app makes no request and shows as a placeholder', async ({ page, request }) => {
  const outside: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('tracker.example')) outside.push(r.url())
  })
  // The fake model has no Markdown-image trigger: the chat answer is rewritten in the browser.
  await page.route('**/api/agent/chat', async (route) => {
    const response = await route.fetch()
    const text = await response.text()
    await route.fulfill({
      response,
      body: text.replace('Here is your quiz.', 'Here is your quiz. ![x](https://tracker.example/p.png)'),
    })
  })
  const { box, log } = await openChat(page, request)
  await askQuiz(box, log, 'answerimg')
  await expect(log.getByText(/Here is your quiz\./)).toContainText('https://tracker.example/p.png')
  await expect(log.locator('img[src*="tracker.example"]')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
  expect(outside).toEqual([])
})

// ---- theme -------------------------------------------------------------------------------

/** WCAG contrast between the text colour of `loc` and the first opaque background above it. */
async function contrast(loc: ReturnType<Page['locator']>): Promise<number> {
  const [fg, bg] = await loc.evaluate((el) => {
    const toRgba = (css: string) => {
      const c = document.createElement('canvas')
      c.width = c.height = 1
      const ctx = c.getContext('2d')!
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = css
      ctx.fillRect(0, 0, 1, 1)
      return Array.from(ctx.getImageData(0, 0, 1, 1).data)
    }
    const fgc = toRgba(getComputedStyle(el).color)
    let node: Element | null = el
    let back = [255, 255, 255, 255]
    while (node) {
      const c = toRgba(getComputedStyle(node).backgroundColor)
      if (c[3] === 255) {
        back = c
        break
      }
      node = node.parentElement
    }
    return [fgc, back]
  })
  const lum = ([r, g, b]: number[]) => {
    const f = (v: number) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const [a, b] = [lum(fg), lum(bg)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

test('Dark theme: the quiz uses the dark colors and its text is readable', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  const { box, log } = await openChat(page, request)
  await askQuiz(box, log, 'dark')
  await option(log, 'Option two', 0).click()
  await checks(log).nth(0).click()
  await expect(log.getByText('Correct. Explanation 1.')).toBeVisible()
  for (const target of [
    log.getByRole('heading', { name: 'Docker networking quiz' }),
    log.getByText('Which network mode is the default?'),
    log.getByText('Option one', { exact: true }).first(),
    log.getByText('Correct. Explanation 1.'),
    log.getByText('1 / 3 answered, 1 correct'),
  ]) {
    expect(await contrast(target), 'text contrast in the dark theme').toBeGreaterThanOrEqual(4.5)
  }
  // The page really is dark: its body background is darker than its text.
  const page2 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(page2).toMatch(/rgb/)
  await shot(page, 'a2ui-chat-quiz-dark-theme')
})

// ---- settings ----------------------------------------------------------------------------

test('The Interactive tutor agent: listed in Settings > Agents and by the API with its provider choice', async ({ page, request }) => {
  const list = await request.get(`${API}/api/agents`)
  expect(list.status()).toBe(200)
  const agents = (await list.json()) as { id: string; name: string }[]
  expect(agents.find((a) => a.id === 'a2ui')?.name).toBe('Interactive tutor')

  await page.goto('/#/settings/agents')
  const cards = page.getByRole('region', { name: 'Agent providers' })
  await expect(cards.getByRole('article', { name: 'Interactive tutor' })).toBeVisible()
  for (const name of ['Learning assistant', 'Lesson writer', 'Topic outline']) {
    await expect(cards.getByRole('article', { name })).toBeVisible()
  }
  await shotBoth(page, 'a2ui-chat-agents-settings')
})
