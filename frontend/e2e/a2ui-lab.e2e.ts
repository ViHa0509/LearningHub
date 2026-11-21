/**
 * Spec checks for the change a2ui-lab-playground (openspec/changes/a2ui-lab-playground/specs/a2ui-lab):
 * open from the top bar, send / update / delete a surface, invalid input, the size limit, reset,
 * samples step by step, the data model, actions in the log, scripted replies, guarded media,
 * Markdown without HTML and the draft kept in the browser. Runs signed in as the Owner.
 * The phone scenario lives in responsive.e2e.ts. Screenshots: e2e-results/screens/a2ui-lab-*.png.
 */
import { expect, test, type Page } from '@playwright/test'
import { OWNER } from '../playwright.config.ts'

const CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'
const V = 'v0.9'

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

const createSurface = (surfaceId: string) => ({ version: V, createSurface: { surfaceId, catalogId: CATALOG } })
const updateComponents = (surfaceId: string, components: unknown[]) => ({
  version: V,
  updateComponents: { surfaceId, components },
})
const updateDataModel = (surfaceId: string, path: string, value: unknown) => ({
  version: V,
  updateDataModel: { surfaceId, path, value },
})
const helloMessages = (id: string, title = 'Hello') => [
  createSurface(id),
  updateComponents(id, [{ id: 'root', component: 'Text', text: { path: '/title' } }]),
  updateDataModel(id, '/title', title),
]

async function openLab(page: Page) {
  await page.goto('/#/a2ui-lab')
  await expect(page.getByRole('heading', { name: 'A2UI Lab' })).toBeVisible({ timeout: 15_000 })
}

const editor = (page: Page) => page.getByRole('textbox', { name: 'A2UI messages' })
const preview = (page: Page) => page.getByRole('region', { name: 'Preview' })
const inspector = (page: Page) => page.getByRole('region', { name: 'Inspector' })

async function typeAndSend(page: Page, payload: unknown) {
  await editor(page).fill(typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2))
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}

async function loadSample(page: Page, title: string) {
  await page.getByLabel('Sample').selectOption({ label: title })
}

const flat = async (loc: ReturnType<Page['locator']>) => ((await loc.innerText()) ?? '').replace(/\s+/g, ' ')

test('Open the A2UI Lab: the top bar link opens #/a2ui-lab with editor, preview and inspector', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'What do you want to learn?' })).toBeVisible()
  await page.getByRole('banner').getByRole('link', { name: 'A2UI Lab' }).click()
  await expect(page).toHaveURL(/#\/a2ui-lab$/)
  await expect(editor(page)).toBeVisible()
  await expect(preview(page)).toBeVisible()
  await expect(inspector(page)).toBeVisible()
  await shot(page, 'a2ui-lab-open')
})

test('Send messages from the editor: send a surface, update it, then delete it', async ({ page }) => {
  await openLab(page)
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await editor(page).fill(JSON.stringify(helloMessages('hello'), null, 2))
  // Nothing is processed while typing.
  await expect(preview(page).getByRole('heading', { name: 'hello' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(preview(page).getByRole('heading', { name: 'hello' })).toBeVisible()
  await expect(preview(page).getByText('Hello', { exact: true })).toBeVisible()
  const entries = inspector(page).getByRole('listitem')
  await expect(entries).toHaveCount(3)
  await expect(entries.nth(0)).toContainText('createSurface')
  await expect(entries.nth(1)).toContainText('updateComponents')
  await expect(entries.nth(2)).toContainText('updateDataModel')
  await shot(page, 'a2ui-lab-hello')

  // Update: same surface, the text changes.
  await typeAndSend(page, updateDataModel('hello', '/title', 'Hi'))
  await expect(preview(page).getByText('Hi', { exact: true })).toBeVisible()
  await expect(preview(page).getByText('Hello', { exact: true })).toHaveCount(0)
  await expect(preview(page).getByRole('heading', { name: 'hello' })).toHaveCount(1)

  // Delete.
  await typeAndSend(page, { version: V, deleteSurface: { surfaceId: 'hello' } })
  await expect(preview(page).getByRole('heading', { name: 'hello' })).toHaveCount(0)
  await expect(preview(page).getByText(/No surface yet/)).toBeVisible()
})

test('Invalid input is reported, not rendered: not JSON gives the position and leaves the preview unchanged', async ({ page }) => {
  await openLab(page)
  await typeAndSend(page, helloMessages('keep'))
  await expect(preview(page).getByText('Hello', { exact: true })).toBeVisible()
  await typeAndSend(page, '{"version": "v0.9",')
  const alert = page.getByRole('alert').filter({ hasText: /json/i })
  await expect(alert).toBeVisible()
  await expect(alert).toContainText(/invalid json/i)
  await expect(alert).toContainText(/line \d+/i)
  await expect(alert).toContainText(/column \d+/i)
  await expect(preview(page).getByRole('heading', { name: 'keep' })).toBeVisible()
  await expect(preview(page).getByText('Hello', { exact: true })).toBeVisible()
  await shot(page, 'a2ui-lab-not-json')
})

test('Invalid input is reported, not rendered: unknown component names the message and keeps the surface', async ({ page }) => {
  await openLab(page)
  await loadSample(page, 'Form with two-way binding')
  await page.getByRole('button', { name: 'Next step' }).click()
  await expect(preview(page).getByRole('heading', { name: 'form' })).toBeVisible()
  await expect(preview(page).getByRole('textbox')).toBeVisible()

  await typeAndSend(
    page,
    updateComponents('form', [{ id: 'extra', component: 'Carousel', children: [] }]),
  )
  await inspector(page).getByRole('tab', { name: /^Errors/ }).click()
  const errors = inspector(page).getByRole('alert')
  await expect(errors).toContainText('Message 1')
  await expect(errors).toContainText('Carousel')
  await expect(preview(page).getByRole('heading', { name: 'form' })).toBeVisible()
  await expect(preview(page).getByRole('textbox')).toBeVisible()
  await expect(preview(page).getByRole('button', { name: 'Submit' })).toBeVisible()
  await shot(page, 'a2ui-lab-unknown-component')
})

test('Input size limit: 300 KB of text is refused with an error naming 256 KB and nothing is processed', async ({ page }) => {
  await openLab(page)
  const big = JSON.stringify([...helloMessages('big'), { version: V, pad: 'x'.repeat(300 * 1024) }])
  await editor(page).fill(big)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: /256 KB/ })).toBeVisible()
  await expect(preview(page).getByRole('heading', { name: 'big' })).toHaveCount(0)
  await inspector(page).getByRole('tab', { name: 'Log' }).click()
  await expect(inspector(page).getByRole('listitem')).toHaveCount(0)
})

test('Input size limit: more than 200 messages in one Send is refused', async ({ page }) => {
  await openLab(page)
  const many = Array.from({ length: 201 }, (_, i) => updateDataModel('nope', '/n', i))
  await typeAndSend(page, many)
  await expect(page.getByRole('alert').filter({ hasText: /200/ })).toBeVisible()
  await expect(inspector(page).getByRole('listitem')).toHaveCount(0)
})

test('Reset the lab: surfaces, log and errors are cleared and the editor text is kept', async ({ page }) => {
  await openLab(page)
  await typeAndSend(page, [...helloMessages('one', 'First'), ...helloMessages('two', 'Second')])
  await expect(preview(page).getByRole('heading', { name: 'one' })).toBeVisible()
  await expect(preview(page).getByRole('heading', { name: 'two' })).toBeVisible()
  await expect(inspector(page).getByRole('listitem')).not.toHaveCount(0)
  const text = await editor(page).inputValue()
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(preview(page).getByRole('heading', { name: 'one' })).toHaveCount(0)
  await expect(preview(page).getByRole('heading', { name: 'two' })).toHaveCount(0)
  await expect(preview(page).getByText(/No surface yet/)).toBeVisible()
  await expect(inspector(page).getByRole('listitem')).toHaveCount(0)
  await expect(inspector(page).getByText('The log is empty.')).toBeVisible()
  await expect(editor(page)).toHaveValue(text)
})

test('Step through samples: Next step sends one step, the counter and editor advance, the last step finishes the sample', async ({ page }) => {
  await openLab(page)
  await loadSample(page, 'Hello surface')
  await expect(page.getByText('Step 1 of 3')).toBeVisible()
  await expect(editor(page)).toHaveValue(/createSurface/)
  await page.getByRole('button', { name: 'Next step' }).click()
  await expect(page.getByText('Step 2 of 3')).toBeVisible()
  await expect(editor(page)).toHaveValue(/updateComponents/)
  const entries = inspector(page).getByRole('listitem')
  await expect(entries).toHaveCount(1)
  await expect(entries.first()).toContainText('createSurface')

  await page.getByRole('button', { name: 'Next step' }).click()
  await expect(page.getByText('Step 3 of 3')).toBeVisible()
  await expect(editor(page)).toHaveValue(/updateDataModel/)
  await page.getByRole('button', { name: 'Next step' }).click()
  await expect(page.getByText(/Sample done/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next step' })).toBeDisabled()
  await expect(preview(page).getByText('Hello', { exact: true })).toBeVisible()
  await expect(entries).toHaveCount(3)
})

test('Load a sample over a changed draft: the lab asks first and Cancel keeps the text', async ({ page }) => {
  await openLab(page)
  const draft = `{"version": "v0.9", "note": "my draft ${Date.now()}"}`
  await editor(page).fill(draft)
  const messages: string[] = []
  page.once('dialog', (d) => {
    messages.push(d.message())
    void d.dismiss()
  })
  await loadSample(page, 'Hello surface')
  await expect.poll(() => messages.length).toBe(1)
  await expect(editor(page)).toHaveValue(draft)
  await expect(page.getByText('No sample loaded')).toBeVisible()

  page.once('dialog', (d) => void d.accept())
  await loadSample(page, 'Hello surface')
  await expect(editor(page)).toHaveValue(/createSurface/)
  await expect(page.getByText('Step 1 of 3')).toBeVisible()
})

test('Inspect the data model and Render surfaces with the app theme: typing in the form field shows the name, light and dark screenshots', async ({ page }) => {
  await openLab(page)
  await loadSample(page, 'Form with two-way binding')
  await page.getByRole('button', { name: 'Next step' }).click()
  const field = preview(page).getByRole('textbox')
  await expect(field).toBeVisible()
  await field.fill('Ana')
  await inspector(page).getByRole('tab', { name: 'Data model' }).click()
  const data = inspector(page).getByRole('tabpanel')
  await expect.poll(() => flat(data)).toMatch(/"user": \{ "name": "Ana" \}/)
  await inspector(page).getByRole('tab', { name: 'Log' }).click()
  await shotBoth(page, 'a2ui-lab-form')

  // Dark: the surface text is readable against its background.
  await page.emulateMedia({ colorScheme: 'dark' })
  const heading = preview(page).getByText('Say hello', { exact: true })
  await expect(heading).toBeVisible()
  const colors = await heading.evaluate((el) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    let bgEl: Element | null = el
    let bg = 'rgba(0, 0, 0, 0)'
    while (bgEl) {
      bg = getComputedStyle(bgEl).backgroundColor
      if (!/rgba\(.*, 0\)|transparent/.test(bg)) break
      bgEl = bgEl.parentElement
    }
    return { fg: parse(getComputedStyle(el).color), bg: parse(bg) }
  })
  const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
  expect(Math.abs(lum(colors.fg) - lum(colors.bg)), JSON.stringify(colors)).toBeGreaterThan(100)
  await page.emulateMedia({ colorScheme: 'light' })
})

test('Show actions as renderer messages: the Submit button logs a renderer-to-agent action with the resolved context', async ({ page }) => {
  await openLab(page)
  await loadSample(page, 'Form with two-way binding')
  await page.getByRole('button', { name: 'Next step' }).click()
  await preview(page).getByRole('textbox').fill('Ana')
  await preview(page).getByRole('button', { name: 'Submit' }).click()
  const entry = inspector(page).getByRole('listitem').filter({ hasText: 'renderer→agent' })
  await expect(entry).toHaveCount(1)
  await expect(entry).toContainText('renderer→agent')
  const text = await flat(entry)
  expect(text).toContain('"name": "submit"')
  expect(text).toContain('"surfaceId": "form"')
  expect(text).toContain('"sourceComponentId": "submit"')
  expect(text).toContain('"timestamp"')
  expect(text).toMatch(/"context": \{ "name": "Ana" \}/)
  // The other entries go from the agent (sample) to the renderer.
  await expect(inspector(page).getByRole('listitem').first()).toContainText('agent→renderer')
  await shot(page, 'a2ui-lab-action')
})

test('Scripted agent replies: the quiz answer logs the action, then the scripted updateDataModel, and the card shows the result', async ({ page }) => {
  await openLab(page)
  await loadSample(page, 'Quiz card')
  await page.getByRole('button', { name: 'Next step' }).click()
  await expect(preview(page).getByText('Which message creates a surface?')).toBeVisible()
  await preview(page).getByText('createSurface', { exact: true }).click()
  await preview(page).getByRole('button', { name: 'Check' }).click()
  await expect(preview(page).getByText('Thanks. The scripted agent received your answer.')).toBeVisible()
  const entries = inspector(page).getByRole('listitem')
  const last = await entries.allInnerTexts()
  const actionAt = last.findIndex((t) => t.includes('"action"'))
  const replyAt = last.findIndex((t, i) => i > actionAt && t.includes('updateDataModel') && t.includes('Thanks.'))
  expect(actionAt, 'action entry in the log').toBeGreaterThanOrEqual(0)
  expect(replyAt, 'scripted reply after the action').toBeGreaterThan(actionAt)
  expect(last[actionAt]).toContain('"answer"')
  expect(last[replyAt]).toContain('scripted agent')
  await shot(page, 'a2ui-lab-quiz')
})

test('Scripted agent replies: an action without a script is only logged', async ({ page }) => {
  await openLab(page)
  await loadSample(page, 'Form with two-way binding')
  await page.getByRole('button', { name: 'Next step' }).click()
  const entries = inspector(page).getByRole('listitem')
  const before = await entries.count()
  await preview(page).getByRole('button', { name: 'Submit' }).click()
  await expect(entries).toHaveCount(before + 1)
  await expect(entries.last()).toContainText('"action"')
  await expect(preview(page).getByRole('textbox')).toBeVisible()
})

test('Media only from the app or data URLs: an external Image makes no request and shows the blocked placeholder', async ({ page }) => {
  const external: string[] = []
  page.on('request', (r) => {
    if (new URL(r.url()).hostname === 'tracker.example') external.push(r.url())
  })
  await openLab(page)
  const url = 'https://tracker.example/p.png?d=secret'
  await typeAndSend(page, [
    createSurface('media'),
    updateComponents('media', [{ id: 'root', component: 'Image', url }]),
  ])
  await expect(preview(page).getByRole('heading', { name: 'media' })).toBeVisible()
  await expect(preview(page).getByText(/blocked/i).first()).toBeVisible()
  await expect(preview(page).getByText(url)).toBeVisible()
  await expect(preview(page).locator('img')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
  expect(external).toEqual([])
  await shot(page, 'a2ui-lab-blocked-image')
})

test('Media only from the app or data URLs: an image on the app address is shown', async ({ page }) => {
  await openLab(page)
  await typeAndSend(page, [
    createSurface('own'),
    updateComponents('own', [{ id: 'root', component: 'Image', url: '/brand/logo-mark.svg' }]),
  ])
  const img = preview(page).locator('img')
  await expect(img).toHaveCount(1)
  await expect(img).toBeVisible()
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0))
    .toBe(true)
  await expect(preview(page).getByText(/blocked/i)).toHaveCount(0)
})

test('Markdown without HTML: HTML and a javascript: link in a Text create no element and no clickable link', async ({ page }) => {
  let dialogs = 0
  page.on('dialog', (d) => {
    dialogs++
    void d.dismiss()
  })
  await openLab(page)
  await typeAndSend(page, [
    createSurface('md'),
    updateComponents('md', [
      { id: 'root', component: 'Text', text: '<img src=x onerror=alert(1)> and [x](javascript:alert(1)) and [ok](https://example.test/)' },
    ]),
  ])
  await expect(preview(page).getByRole('heading', { name: 'md' })).toBeVisible()
  await expect(preview(page).getByText(/and/).first()).toBeVisible()
  await expect(preview(page).locator('img')).toHaveCount(0)
  await expect(preview(page).locator('[href^="javascript:" i]')).toHaveCount(0)
  // No anchor may carry a script URL (an empty href is checked in the next test).
  for (const a of await preview(page).getByRole('link').all()) {
    expect(((await a.getAttribute('href')) ?? '').toLowerCase()).not.toContain('javascript:')
  }
  // A normal link opens in a new tab without access to the app.
  const ok = preview(page).getByRole('link', { name: 'ok' })
  await expect(ok).toHaveAttribute('target', '_blank')
  await expect(ok).toHaveAttribute('rel', /noopener/)
  // A would-be onerror would have fired once the broken image failed to load.
  await page.waitForLoadState('networkidle')
  expect(dialogs).toBe(0)
  await shot(page, 'a2ui-lab-markdown')
})

test('Keep the draft in the browser: the editor text survives a reload and the preview is empty', async ({ page }) => {
  await openLab(page)
  const text = JSON.stringify(helloMessages('kept', 'Draft'), null, 2)
  await editor(page).fill(text)
  // The draft is saved shortly after typing.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const k = Object.keys(localStorage).find((x) => x.startsWith('lh.a2uiLab.draft.'))
        return k ? localStorage.getItem(k) : null
      }),
    )
    .toBe(text)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'A2UI Lab' })).toBeVisible({ timeout: 15_000 })
  await expect(editor(page)).toHaveValue(text)
  await expect(preview(page).getByRole('heading', { name: 'kept' })).toHaveCount(0)
  await expect(preview(page).getByText(/No surface yet/)).toBeVisible()
})

test('Markdown without HTML: the javascript: link is not clickable (no anchor with a usable href is left)', async ({ page, context }) => {
  await openLab(page)
  await typeAndSend(page, [
    createSurface('md2'),
    updateComponents('md2', [{ id: 'root', component: 'Text', text: 'before [x](javascript:alert(1)) after' }]),
  ])
  await expect(preview(page).getByText(/before/)).toBeVisible()
  const anchors = preview(page).locator('a')
  // Not clickable: no anchor at all, or one without an href (an empty href still navigates to the app).
  for (const a of await anchors.all()) {
    expect(await a.getAttribute('href'), 'href of the link made from the javascript: URL').toBeNull()
  }
  expect(context.pages().length).toBe(1)
})

test.describe('Not signed in', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('Open the A2UI Lab: not signed in shows the sign-in page, and after signing in the lab opens', async ({ page }) => {
    await page.goto('/#/a2ui-lab')
    const form = page.getByRole('main', { name: 'Log in' })
    await expect(form.getByRole('heading', { name: 'Log in' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'A2UI Lab' })).toHaveCount(0)
    await shot(page, 'a2ui-lab-signed-out')
    await form.getByLabel('Email', { exact: true }).fill(OWNER.email)
    await form.getByLabel('Password', { exact: true }).fill(OWNER.password)
    await form.getByRole('button', { name: 'Log in' }).click()
    await expect(page.getByRole('heading', { name: 'A2UI Lab' })).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/#\/a2ui-lab$/)
    await expect(editor(page)).toBeVisible()
    await expect(form).toHaveCount(0)
  })
})
