/**
 * End-to-end checks for the chat-pet change (specs/agent-chat): the small pet on the composer that
 * shows the agent's state (greeting, thinking, done, error) with fixed bubble lines, can be switched
 * off in the options menu, and never gets in the way (clicks pass through, last message readable,
 * no motion under reduced motion, none at phone size, theme colors).
 * Every provider points at the fake OpenAI-compatible server on port 8002 (e2e/fake_llm.py):
 * model fake-ok answers "OK from fake", fake-slow answers after 5 s, fake-401 fails.
 * The pet is aria-hidden, so it is found by its CSS class (the only way to reach it).
 */
import { expect, test, type APIRequestContext, type Locator, type Page, type Request } from '@playwright/test'

const API = 'http://127.0.0.1:8001'
const FAKE = 'http://127.0.0.1:8002/v1'
const H = { 'X-LearningHub': '1' }
const ANSWER_TIMEOUT = 20_000

const GREETING = 'Hi! What are we learning today?'
const THINKING = 'Thinking…'
const DONE = 'Done!'
const ERROR_LINE = "That didn't work. Try again?"

let counter = 0
const unique = (label: string) => `${label} ${Date.now().toString(36)}${counter++}`
const created: string[] = []

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

async function makeProvider(request: APIRequestContext, label: string, model: string) {
  const name = unique(label)
  const res = await request.post(`${API}/api/ai-providers`, {
    headers: H,
    data: { name, provider_type: 'local', model_name: model, base_url: FAKE, config: {} },
  })
  expect(res.status(), await res.text()).toBe(201)
  const body = await res.json()
  created.push(body.id)
  return { id: body.id as string, name }
}

async function assign(request: APIRequestContext, agent: string, primary: string | null) {
  const res = await request.put(`${API}/api/agents/${agent}/provider`, {
    headers: H,
    data: { primary_provider_id: primary, fallback_provider_id: null },
  })
  expect(res.status(), await res.text()).toBe(200)
}

test.afterEach(async ({ request }) => {
  for (const agent of ['assistant', 'lesson-writer']) await assign(request, agent, null)
  while (created.length > 0) {
    await request.delete(`${API}/api/ai-providers/${created.pop()}`, { headers: H })
  }
})

const isChat = (r: Request) => r.url().endsWith('/api/agent/chat') && r.method() === 'POST'

/** A provider on the given fake model assigned to the assistant, then the app opened on the home page. */
async function openChat(page: Page, request: APIRequestContext, model: string) {
  const p = await makeProvider(request, 'Pet chat', model)
  await assign(request, 'assistant', p.id)
  await page.goto('/')
  const agent = page.getByRole('complementary', { name: 'Agent' })
  const box = agent.getByRole('textbox', { name: 'Message the agent' })
  await expect(box).toBeVisible()
  const pet = agent.locator('.composer .chat-pet')
  return { agent, box, pet, bubble: pet.locator('.chat-pet-bubble'), log: agent.getByRole('log', { name: 'Conversation' }) }
}

/** Computed style values of an element, read in the page. */
async function style(loc: Locator, prop: string): Promise<string> {
  return loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop)
}

function luminance(rgb: string): number {
  const m = rgb.match(/[\d.]+/g)!.map(Number)
  return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255
}

test.describe('Chat pet shows the agent state', () => {
  test('Greeting: idle pet with the greeting on the composer, which goes away by itself', async ({ page, request }) => {
    const { agent, pet, bubble } = await openChat(page, request, 'fake-ok')
    await expect(pet).toBeVisible()
    await expect(pet).toHaveAttribute('data-pose', 'idle')
    await expect(pet.locator('svg.chat-pet-art')).toBeVisible()
    await expect(bubble).toHaveText(GREETING)
    // Pet is inside the composer, under the conversation.
    await expect(agent.locator('.composer .chat-pet')).toHaveCount(1)
    await shot(page, 'chat-pet-greeting')
    // "A few seconds" (6 s): the bubble goes, the pet stays idle.
    await expect(bubble).toHaveCount(0, { timeout: 12_000 })
    await expect(pet).toHaveAttribute('data-pose', 'idle')
  })

  test('Thinking and Done: thinking line while the request runs, then done line, then idle without bubble', async ({
    page,
    request,
  }) => {
    const { box, pet, bubble, log } = await openChat(page, request, 'fake-slow')
    await box.fill('Explain caching please')
    const req = page.waitForRequest(isChat)
    await box.press('Enter')
    await req
    await expect(pet).toHaveAttribute('data-pose', 'thinking')
    await expect(bubble).toHaveText(THINKING)
    await expect(log.locator('.agent-bubble.user')).toHaveText('Explain caching please')
    await shot(page, 'chat-pet-thinking')
    // It stays thinking until the answer (fake-slow answers after 5 s).
    await expect(log.getByText('OK from fake')).toBeVisible({ timeout: ANSWER_TIMEOUT })
    await expect(pet).toHaveAttribute('data-pose', 'done')
    await expect(bubble).toHaveText(DONE)
    await shot(page, 'chat-pet-done')
    // Spec: "Done and error return to idle after a few seconds", no bubble.
    await expect(pet).toHaveAttribute('data-pose', 'idle', { timeout: 10_000 })
    await expect(bubble).toHaveCount(0)
  })

  test('Error: error state and line, then idle; the panel error row with Retry is unchanged', async ({
    page,
    request,
  }) => {
    const { box, pet, bubble, log } = await openChat(page, request, 'fake-401')
    await box.fill('first try with secret words')
    await box.press('Enter')
    const alert = log.getByRole('alert')
    await expect(alert).toBeVisible({ timeout: ANSWER_TIMEOUT })
    await expect(pet).toHaveAttribute('data-pose', 'error')
    await expect(bubble).toHaveText(ERROR_LINE)
    await expect(log.locator('.agent-error-row').getByRole('button', { name: 'Retry' })).toBeVisible()
    await shot(page, 'chat-pet-error')
    await expect(pet).toHaveAttribute('data-pose', 'idle', { timeout: 12_000 })
    await expect(bubble).toHaveCount(0)
    // The error row is still there with Retry.
    await expect(alert).toBeVisible()
    await expect(log.locator('.agent-error-row').getByRole('button', { name: 'Retry' })).toBeVisible()
  })
})

test.describe('Pet text is fixed', () => {
  test('Answer text stays out of the bubble: done and error show only the fixed lines', async ({ page, request }) => {
    const ok = await openChat(page, request, 'fake-ok')
    const typed = 'zebra-typed-words'
    await ok.box.fill(typed)
    await ok.box.press('Enter')
    // Whatever pose it is in, the bubble never holds the typed text or the answer text.
    await expect(ok.log.getByText('OK from fake')).toBeVisible({ timeout: ANSWER_TIMEOUT })
    await expect(ok.bubble).toHaveText(DONE)
    const doneText = (await ok.bubble.textContent()) ?? ''
    expect(doneText).not.toContain('OK from fake')
    expect(doneText).not.toContain(typed)

    // An error message from the server (401 "Incorrect API key provided") stays out as well.
    const bad = await makeProvider(request, 'Pet rejecting', 'fake-401')
    await assign(request, 'assistant', bad.id)
    await ok.box.fill('another question')
    await ok.box.press('Enter')
    const alert = ok.log.getByRole('alert')
    await expect(alert).toBeVisible({ timeout: ANSWER_TIMEOUT })
    const errorText = ((await alert.textContent()) ?? '').trim()
    expect(errorText.length).toBeGreaterThan(0)
    await expect(ok.bubble).toHaveText(ERROR_LINE)
    const bubbleText = (await ok.bubble.textContent()) ?? ''
    expect(bubbleText).not.toContain('Incorrect')
    expect(bubbleText).not.toContain('API key')
    expect(bubbleText).not.toContain('another question')
  })
})

test.describe('Pet can be switched off', () => {
  test('Switch off: pet and bubble gone at once and after a reload; Switch on again brings it back', async ({
    page,
    request,
  }) => {
    const { agent, pet, bubble, log } = await openChat(page, request, 'fake-ok')
    await expect(pet).toBeVisible()
    await expect(bubble).toBeVisible()
    await expect(log).toHaveClass(/pet-room/)

    const options = agent.getByRole('button', { name: 'Message options' })
    await options.click()
    const menu = agent.getByRole('menu', { name: 'Message options' })
    const item = menu.getByRole('menuitemcheckbox', { name: 'Pet' })
    await expect(item).toHaveAttribute('aria-checked', 'true')
    await item.click()
    // At once, and the menu closes.
    await expect(menu).toHaveCount(0)
    await expect(pet).toHaveCount(0)
    await expect(bubble).toHaveCount(0)
    await expect(log).not.toHaveClass(/pet-room/)
    expect(await page.evaluate("localStorage.getItem('learninghub.pet')")).toBe('off')

    await page.reload()
    const after = page.getByRole('complementary', { name: 'Agent' })
    await expect(after.getByRole('textbox', { name: 'Message the agent' })).toBeVisible()
    await expect(after.locator('.chat-pet')).toHaveCount(0)
    // The message options button is still usable and shows Pet unchecked.
    await after.getByRole('button', { name: 'Message options' }).click()
    const item2 = after.getByRole('menuitemcheckbox', { name: 'Pet' })
    await expect(item2).toHaveAttribute('aria-checked', 'false')
    await shot(page, 'chat-pet-off')

    // Switch on again.
    await item2.click()
    await expect(after.getByRole('menu', { name: 'Message options' })).toHaveCount(0)
    await expect(after.locator('.composer .chat-pet')).toBeVisible()
    await expect(after.locator('.composer .chat-pet')).toHaveAttribute('data-pose', 'idle')
    await after.getByRole('button', { name: 'Message options' }).click()
    await expect(after.getByRole('menuitemcheckbox', { name: 'Pet' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
  })
})

test.describe('Pet never gets in the way', () => {
  test('Controls stay usable: Send and the options button are clicked with the pet and bubble shown; the pet is aria-hidden and takes no focus', async ({
    page,
    request,
  }) => {
    const { agent, box, pet, bubble } = await openChat(page, request, 'fake-ok')
    await expect(bubble).toBeVisible()
    await expect(pet).toHaveAttribute('aria-hidden', 'true')
    expect(await style(pet, 'pointer-events')).toBe('none')
    expect(await style(bubble, 'pointer-events')).toBe('none')
    // Decoration only: nothing inside takes focus, and assistive technology does not see it.
    expect(await pet.locator('a, button, input, [tabindex]').count()).toBe(0)
    await expect(agent.getByRole('img')).toHaveCount(0)

    // The pet's area belongs to whatever is under it, never to the pet.
    for (const target of [pet.locator('svg.chat-pet-art'), bubble]) {
      const hit = await target.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return !!top && !top.closest('.chat-pet')
      })
      expect(hit).toBe(true)
    }

    // The options button opens its menu (a real click, no force).
    await agent.getByRole('button', { name: 'Message options' }).click()
    await expect(agent.getByRole('menu', { name: 'Message options' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(agent.getByRole('menu', { name: 'Message options' })).toHaveCount(0)

    // Send with a click while the pet still shows.
    await box.fill('click send please')
    const req = page.waitForRequest(isChat)
    await agent.getByRole('button', { name: 'Send' }).click()
    await req
    await expect(agent.getByText('OK from fake')).toBeVisible({ timeout: ANSWER_TIMEOUT })

    // A click on a message in the list reaches it (a click on the user bubble selects nothing wrong,
    // and the pet does not intercept it): the click is not blocked by the pet.
    await agent.locator('.agent-bubble.user').click()
  })

  test('Last message stays readable: the pet and its bubble do not cover the end of the conversation', async ({
    page,
    request,
  }) => {
    const { box, pet, log } = await openChat(page, request, 'fake-ok')
    await box.fill('[[markdown]] compare tokens')
    await box.press('Enter')
    await expect(log.getByRole('table')).toBeVisible({ timeout: ANSWER_TIMEOUT })
    await expect(pet).toBeVisible()
    await expect(log).toHaveClass(/pet-room/)
    await log.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    const overlap = await log.evaluate((el) => {
      const last = el.lastElementChild as HTMLElement
      const lastRect = last.getBoundingClientRect()
      const pet = document.querySelector('.composer .chat-pet-art')!.getBoundingClientRect()
      const bubble = document.querySelector('.composer .chat-pet-bubble')?.getBoundingClientRect()
      const hits = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      return { pet: hits(lastRect, pet), bubble: bubble ? hits(lastRect, bubble) : false, lastBottom: lastRect.bottom, petTop: pet.top }
    })
    expect(overlap.pet, JSON.stringify(overlap)).toBe(false)
    expect(overlap.bubble, JSON.stringify(overlap)).toBe(false)
    expect(overlap.lastBottom).toBeLessThanOrEqual(overlap.petTop)
  })

  test('Reduced motion: states change but nothing moves, and the bubble appears without animation', async ({
    page,
    request,
  }) => {
    // With motion allowed the pet animates (so the test below proves something).
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const motion = await openChat(page, request, 'fake-ok')
    await expect(motion.pet).toHaveAttribute('data-pose', 'idle')
    expect(await style(motion.pet.locator('.pet-figure'), 'animation-name')).not.toBe('none')
    expect(await style(motion.bubble, 'animation-name')).not.toBe('none')

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.reload()
    const { box, pet, bubble, log } = {
      box: page.getByRole('textbox', { name: 'Message the agent' }),
      pet: page.locator('.composer .chat-pet'),
      bubble: page.locator('.composer .chat-pet-bubble'),
      log: page.getByRole('log', { name: 'Conversation' }),
    }
    await expect(pet).toHaveAttribute('data-pose', 'idle')
    await expect(bubble).toHaveText(GREETING)
    expect(await style(pet.locator('.pet-figure'), 'animation-name')).toBe('none')
    expect(await style(pet.locator('.pet-face'), 'animation-name')).toBe('none')
    expect(await style(bubble, 'animation-name')).toBe('none')

    // A state change still shows, as a still picture.
    await box.fill('quick one')
    await box.press('Enter')
    await expect(log.getByText('OK from fake')).toBeVisible({ timeout: ANSWER_TIMEOUT })
    await expect(pet).toHaveAttribute('data-pose', 'done')
    await expect(bubble).toHaveText(DONE)
    expect(await style(pet.locator('.pet-figure'), 'animation-name')).toBe('none')
    expect(await style(bubble, 'animation-name')).toBe('none')
    await shot(page, 'chat-pet-reduced-motion')
  })

  test('Phone: no pet is shown and the composer is as before', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const p = await makeProvider(request, 'Pet phone', 'fake-ok')
    await assign(request, 'assistant', p.id)
    await page.goto('/')
    await page.getByRole('button', { name: 'Agent', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: 'Agent' })
    const box = drawer.getByRole('textbox', { name: 'Message the agent' })
    await expect(box).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Send' })).toBeVisible()
    await expect(page.locator('.chat-pet')).toHaveCount(0)
    await expect(drawer.getByRole('log', { name: 'Conversation' })).not.toHaveClass(/pet-room/)
    // Still none after a send.
    await box.fill('phone question')
    await box.press('Enter')
    await expect(drawer.getByText('OK from fake')).toBeVisible({ timeout: ANSWER_TIMEOUT })
    await expect(page.locator('.chat-pet')).toHaveCount(0)
    await shot(page, 'chat-pet-phone')
  })

  test('Dark theme: the pet and its bubble use the theme colors (light and dark screenshots)', async ({
    page,
    request,
  }) => {
    const { pet, bubble, box, log } = await openChat(page, request, 'fake-slow')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(bubble).toHaveText(GREETING)
    const light = {
      bubbleBg: await style(bubble, 'background-color'),
      bubbleText: await style(bubble, 'color'),
      body: await style(pet.locator('.pet-b').first(), 'fill'),
      leaf: await style(pet.locator('.pet-l').first(), 'fill'),
      outline: await style(pet.locator('.pet-o').first(), 'fill'),
    }
    await shot(page, 'chat-pet-light')

    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(bubble).toHaveText(GREETING)
    const dark = {
      bubbleBg: await style(bubble, 'background-color'),
      bubbleText: await style(bubble, 'color'),
      body: await style(pet.locator('.pet-b').first(), 'fill'),
      outline: await style(pet.locator('.pet-o').first(), 'fill'),
    }
    await shot(page, 'chat-pet-dark')
    expect(dark.bubbleBg).not.toBe(light.bubbleBg)
    expect(luminance(dark.bubbleBg)).toBeLessThan(0.5)
    expect(luminance(light.bubbleBg)).toBeGreaterThan(0.5)
    expect(luminance(dark.bubbleText)).toBeGreaterThan(0.5)
    expect(luminance(dark.body)).toBeLessThan(0.5)
    expect(luminance(dark.outline)).toBeGreaterThan(0.5)
    expect(luminance(light.outline)).toBeLessThan(0.5)
    expect(light.leaf).not.toBe('')

    // The explicit Theme switch in the top bar drives the same colors.
    await page.emulateMedia({ colorScheme: 'light' })
    await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' }).check({ force: true })
    await box.fill('dark thinking shot')
    await box.press('Enter')
    await expect(pet).toHaveAttribute('data-pose', 'thinking')
    await expect(bubble).toHaveText(THINKING)
    expect(luminance(await style(bubble, 'background-color'))).toBeLessThan(0.5)
    await shot(page, 'chat-pet-dark-thinking')
    await expect(log.getByText('OK from fake')).toBeVisible({ timeout: ANSWER_TIMEOUT })
  })
})
