/**
 * The login rate limit (spec: owner-auth, "Too many attempts"), at the limit the e2e backend is
 * configured with (AUTH_RATE_PER_MINUTE; the default of 10 is covered by the backend tests).
 * Every test logs in from the same address, so this test first waits for that address's window
 * to empty, and waits it out again before it ends, so the files after it can log in.
 */
import { expect, test } from '@playwright/test'
import { AUTH_RATE_PER_MINUTE, OWNER_STATE } from '../playwright.config.ts'

const APP = 'http://127.0.0.1:5174'
const H = { 'X-LearningHub': '1' }
const LIMIT = AUTH_RATE_PER_MINUTE
const WINDOW_MS = 61_000

test('one failed login more than the limit within a minute is refused with 429 and Retry-After', async ({ playwright }) => {
  test.setTimeout(200_000)
  // Earlier files logged in from this address within the last minute.
  await new Promise((resolve) => setTimeout(resolve, WINDOW_MS))
  // Not the Owner's email, so the Owner's own email key is not used up.
  const ctx = await playwright.request.newContext({ baseURL: APP, storageState: { cookies: [], origins: [] } })
  let windowEnds = Date.now() + WINDOW_MS
  try {
    const email = 'rate-limit-probe@example.test'
    const answers = []
    for (let i = 0; i <= LIMIT; i++) {
      answers.push(await ctx.post('/api/auth/login', { headers: H, data: { email, password: `wrong-password-${i}` } }))
    }
    const statuses = answers.map((a) => a.status())
    expect(statuses, statuses.join(',')).toEqual([...Array(LIMIT).fill(401), 429])
    expect((await answers[0].json()).detail).toBe('Wrong email or password')

    const refused = answers[LIMIT]
    const wait = Number(refused.headers()['retry-after'])
    expect(wait).toBeGreaterThanOrEqual(1)
    expect(wait).toBeLessThanOrEqual(60)
    windowEnds = Date.now() + (wait + 1) * 1000
    expect((await refused.json()).detail).toBe(`Too many attempts. Try again in ${wait} seconds.`)
    expect((await ctx.get('/api/auth/me')).status()).toBe(401)
  } finally {
    await ctx.dispose()
  }
  // The Owner's signed-in session is untouched by the refused logins.
  const owner = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    expect((await owner.get('/api/notes')).status()).toBe(200)
  } finally {
    await owner.dispose()
  }
  // Leave the per-address window empty for the files that run next.
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, windowEnds - Date.now())))
})
