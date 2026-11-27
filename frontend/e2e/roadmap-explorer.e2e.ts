/**
 * Spec checks for the change roadmap-explorer (specs/roadmap-explorer): the GitHub token card on
 * Settings -> Agents -> Connections (save, refused, remove after a confirm, status without the
 * token) and the assistant reading a synthetic roadmap.sh roadmap through roadmapsh_list,
 * roadmapsh_outline and roadmapsh_topic (the fake model answers "[[roadmap:<slug>]]" with the three
 * calls, e2e/fake_llm.py). roadmap.sh, GitHub's tree and raw files and GitHub's rate_limit are
 * fakes on the fake server; nothing real is called.
 *
 * Not e2e-testable (the backend caches the repository listing for an hour and the fakes do not see
 * the user): "Tools send the token", "GitHub limit reached without a token" (tests/test_github_token.py,
 * tests/test_roadmapsh_tools.py); "Closing tag in the source" and "Prompt" / "Only the assistant"
 * (tests/test_roadmapsh_tools.py); "Another user", "App header" and "Not in the backup"
 * (tests/test_github_token.py).
 */
import { expect as baseExpect, test, type APIRequestContext, type Page } from '@playwright/test'
import { OWNER_STATE } from '../playwright.config.ts'

test.describe.configure({ mode: 'serial', timeout: 120_000 })
const expect = baseExpect.configure({ timeout: 20_000 })

const API = 'http://127.0.0.1:8001'
const FAKE = 'http://127.0.0.1:8002'
const H = { 'X-LearningHub': '1' }
const STAMP = Date.now().toString(36)
// Made-up values: the fake rate_limit accepts the first one and answers 401 to anything else.
const ACCEPTED = 'e2eSyntheticRoadmapTokenWXYZ'
const REFUSED = 'e2eRefusedSyntheticTokenQQQQ'

let provider: string | null = null

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

async function status(request: APIRequestContext) {
  const res = await request.get(`${API}/api/github`)
  expect(res.status()).toBe(200)
  const raw = await res.text()
  return { raw, body: JSON.parse(raw) as { saved: boolean; hint: string | null } }
}

const card = (page: Page) => page.getByRole('article', { name: 'GitHub' })

test.beforeAll(async ({ playwright }) => {
  const admin = await playwright.request.newContext({ storageState: OWNER_STATE })
  await admin.delete(`${API}/api/github`, { headers: H })
  const res = await admin.post(`${API}/api/ai-providers`, {
    headers: H,
    data: { name: `Roadmap explorer ${STAMP}`, provider_type: 'local', model_name: 'fake-ok', base_url: `${FAKE}/v1`, config: {} },
  })
  expect(res.status(), await res.text()).toBe(201)
  provider = (await res.json()).id as string
  const put = await admin.put(`${API}/api/agents/assistant/provider`, {
    headers: H,
    data: { primary_provider_id: provider, fallback_provider_id: null },
  })
  expect(put.status(), await put.text()).toBe(200)
  await admin.dispose()
})

test.afterAll(async ({ playwright }) => {
  const admin = await playwright.request.newContext({ storageState: OWNER_STATE })
  await admin.delete(`${API}/api/github`, { headers: H })
  await admin.put(`${API}/api/agents/assistant/provider`, { headers: H, data: { primary_provider_id: null, fallback_provider_id: null } })
  if (provider) await admin.delete(`${API}/api/ai-providers/${provider}`, { headers: H })
  await admin.dispose()
})

test('An optional GitHub token per user > Token refused: the card shows the error, keeps the text and saves nothing', async ({ page, request }) => {
  await page.goto('/#/settings/agents/connections')
  const github = card(page)
  await expect(github.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  const field = github.getByLabel('GitHub token')
  await field.fill(REFUSED)
  await github.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(github.getByRole('alert')).toContainText('GitHub refused this token')
  await expect(field).toHaveValue(REFUSED)
  await expect(github.getByText(/Token saved/)).toHaveCount(0)
  expect((await status(request)).body).toEqual({ saved: false, hint: null })
  await shot(page, 'roadmap-explorer-refused')
})

test('An optional GitHub token per user > Save a token: the card shows Token saved with the last 4 characters and the status holds no token', async ({ page, request }) => {
  await page.goto('/#/settings/agents/connections')
  const github = card(page)
  await github.getByLabel('GitHub token').fill(ACCEPTED)
  await github.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(github.getByText('Token saved (…WXYZ)')).toBeVisible()
  await expect(github.getByLabel('GitHub token')).toHaveCount(0)
  const { raw, body } = await status(request)
  expect(body).toEqual({ saved: true, hint: '…WXYZ' })
  expect(raw).not.toContain(ACCEPTED)
  await page.reload()
  await expect(card(page).getByText('Token saved (…WXYZ)')).toBeVisible()
  await shot(page, 'roadmap-explorer-saved')
})

test('An optional GitHub token per user > Remove is confirmed first: dismissing keeps the token, accepting deletes it and shows the field again', async ({ page, request }) => {
  await page.goto('/#/settings/agents/connections')
  const github = card(page)
  await expect(github.getByText('Token saved (…WXYZ)')).toBeVisible()

  page.once('dialog', (d) => void d.dismiss())
  await github.getByRole('button', { name: 'Remove' }).click()
  await expect(github.getByText('Token saved (…WXYZ)')).toBeVisible()
  expect((await status(request)).body.saved).toBe(true)

  page.once('dialog', (d) => void d.accept())
  await github.getByRole('button', { name: 'Remove' }).click()
  await expect(github.getByLabel('GitHub token')).toBeVisible()
  await expect(github.getByText(/Token saved/)).toHaveCount(0)
  expect((await status(request)).body).toEqual({ saved: false, hint: null })
})

test('The assistant reads roadmap.sh roadmaps > List, Outline and Topic: the fake model calls the three tools and the answer reaches the chat', async ({ page }) => {
  await page.goto('/#/')
  const agent = page.getByRole('complementary', { name: 'Agent' })
  const box = agent.getByRole('textbox', { name: 'Message the agent' })
  await expect(box).toBeVisible()
  await box.fill('What does roadmap.sh teach for a synthetic role? [[roadmap:e2e-roadmap]]')
  await box.press('Enter')
  const answer = agent.getByText(/^ROADMAP ok /)
  await expect(answer).toBeVisible({ timeout: 60_000 })
  await expect(answer).toContainText('e2e-roadmap')
  // Only topics and subtopics, top to bottom (the label node is left out), inside the untrusted wrapper.
  await expect(answer).toContainText('- topic: Synthetic Topic (id e2eTopic1) / - subtopic: Synthetic Subtopic (id e2eSub1)')
  await expect(answer).not.toContainText('Layout only label')
  await expect(answer).toContainText('[untrusted_roadmapsh_content slug="e2e-roadmap"]')
  // The topic file text of the first node.
  await expect(answer).toContainText('Synthetic description of the topic.')
  await expect(answer).toContainText('@article@Synthetic reading')
  await shot(page, 'roadmap-explorer-chat')
})

test('The assistant reads roadmap.sh roadmaps > No such roadmap and Invalid slug: the tool answers an error', async ({ request }) => {
  const ask = async (slug: string) => {
    const res = await request.post(`${API}/api/agent/chat`, {
      headers: H,
      data: { agent_id: 'assistant', messages: [{ role: 'user', content: `[[roadmap:${slug}]]` }], page: { kind: 'home' } },
      timeout: 60_000,
    })
    expect(res.status(), await res.text()).toBe(200)
    return ((await res.json()) as { reply: string }).reply
  }
  expect(await ask('ai-researcher')).toBe("ROADMAP error roadmap.sh has no roadmap 'ai-researcher'")
  expect(await ask('../etc')).toMatch(/^ROADMAP error /)
})

test('roadmap-explorer screenshots: the GitHub card on Connections in light and dark', async ({ page }) => {
  await page.goto('/#/settings/agents/connections')
  await expect(card(page)).toBeVisible()
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await shot(page, `roadmap-explorer-${scheme}`)
  }
  await page.emulateMedia({ colorScheme: 'light' })
})
