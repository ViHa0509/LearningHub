/**
 * Spec checks for the change lesson-writer-long-output (agent-chat): an answer cut by the output
 * limit. The provider is the fake OpenAI-compatible server (e2e/fake_llm.py): "[[cut]]" makes
 * the first model turn call write_lesson with empty input and finish_reason "length"; after the
 * tool result the model answers "CUT recovered". "[[cut-text]]" answers a text cut by the limit.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const API = 'http://127.0.0.1:8001/api'
const H = { 'X-LearningHub': '1' }
const FAKE = 'http://127.0.0.1:8002/v1'
const ANSWER_TIMEOUT = 20_000
const NODE = 'devops/docker'
const CUT = 'The answer was cut off by the output limit'

let counter = 0
const created: string[] = []

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

test.afterEach(async ({ request }) => {
  for (const agent of ['assistant', 'lesson-writer']) {
    await request.put(`${API}/agents/${agent}/provider`, {
      headers: H,
      data: { primary_provider_id: null, fallback_provider_id: null },
    })
  }
  while (created.length > 0) await request.delete(`${API}/ai-providers/${created.pop()}`, { headers: H })
})

async function openLessonWriter(page: Page, request: APIRequestContext) {
  const res = await request.post(`${API}/ai-providers`, {
    headers: H,
    data: {
      name: `QC-cut ${Date.now().toString(36)}${counter++}`,
      provider_type: 'local',
      model_name: 'fake-ok',
      base_url: FAKE,
      config: {},
    },
  })
  expect(res.status(), await res.text()).toBe(201)
  const provider = (await res.json()) as { id: string }
  created.push(provider.id)
  for (const agent of ['assistant', 'lesson-writer']) {
    const set = await request.put(`${API}/agents/${agent}/provider`, {
      headers: H,
      data: { primary_provider_id: provider.id, fallback_provider_id: null },
    })
    expect(set.status(), await set.text()).toBe(200)
  }
  await page.goto(`/#/lesson/${NODE}`)
  const agent = page.getByRole('complementary', { name: 'Agent' })
  await agent.getByRole('button', { name: /^Agent:/ }).click()
  await agent.getByRole('listbox', { name: 'Choose agent' }).getByRole('option', { name: /Lesson writer/ }).click()
  const box = agent.getByRole('textbox', { name: 'Message the agent' })
  await expect(box).toBeVisible()
  return { agent, box, log: agent.getByRole('log', { name: 'Conversation' }) }
}

async function lessonBody(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/lessons/${NODE}`)
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { body: string }).body
}

test('Cut tool call: the step says the answer was cut off, no lesson is written, the model recovers', async ({
  page,
  request,
}) => {
  const { agent, box, log } = await openLessonWriter(page, request)
  const before = await lessonBody(request)
  await box.fill('Draft this lesson [[cut]]')
  await box.press('Enter')
  await expect(log.getByText('CUT recovered')).toBeVisible({ timeout: ANSWER_TIMEOUT })
  await log.getByText('Used 1 tool').click()
  await expect(log.locator('.agent-steps li')).toHaveText([CUT])
  expect(await lessonBody(request)).toBe(before)
  await expect(page.getByRole('article', { name: /^Lesson:/ }).getByText(/No lesson yet/)).toBeVisible()
  await expect(agent.getByRole('status')).toHaveCount(0)
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await shot(page, `lesson-writer-cut-${scheme}`)
  }
  await page.emulateMedia({ colorScheme: 'light' })
})

test('Cut text answer: the reply ends with the cut-off line', async ({ page, request }) => {
  const { box, log } = await openLessonWriter(page, request)
  await box.fill('Draft this lesson [[cut-text]]')
  await box.press('Enter')
  await expect(log.getByText('CUT text answer that was stopped')).toBeVisible({ timeout: ANSWER_TIMEOUT })
  await expect(log).toContainText('(The answer was cut off by the output limit.)')
  expect(await lessonBody(request)).toBe('')
})
