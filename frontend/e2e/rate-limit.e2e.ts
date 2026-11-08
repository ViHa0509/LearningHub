/**
 * The login rate limit (spec: owner-auth, "Too many attempts"). In a file of its own, which runs
 * minutes after auth.e2e.ts, so the per-address window holds only these attempts.
 */
import { expect, test } from '@playwright/test'
import { OWNER_STATE } from '../playwright.config.ts'

const APP = 'http://127.0.0.1:5174'
const H = { 'X-LearningHub': '1' }

test('11 failed logins within a minute: the 11th is refused with 429 and Retry-After', async ({ playwright }) => {
  // Not the Owner's email, so the Owner's own email key is not used up.
  const ctx = await playwright.request.newContext({ baseURL: APP, storageState: { cookies: [], origins: [] } })
  try {
    const email = 'rate-limit-probe@example.test'
    const answers = []
    for (let i = 0; i < 11; i++) {
      answers.push(await ctx.post('/api/auth/login', { headers: H, data: { email, password: `wrong-password-${i}` } }))
    }
    const statuses = answers.map((a) => a.status())
    expect(statuses, statuses.join(',')).toEqual([...Array(10).fill(401), 429])
    expect((await answers[0].json()).detail).toBe('Wrong email or password')

    const refused = answers[10]
    const wait = Number(refused.headers()['retry-after'])
    expect(wait).toBeGreaterThanOrEqual(1)
    expect(wait).toBeLessThanOrEqual(60)
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
})
