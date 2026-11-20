/** Spec: accounts - Times are shown in the user's time zone (Chosen zone, No zone yet). */
import { describe, expect, it } from 'vitest'
import { browserZone, dayKey, formatClock, formatDate, formatDateTimeShort, formatTime, relativeDay, resolveZone } from './time'

const HCM = 'Asia/Ho_Chi_Minh'
const AT = '2026-11-12T23:30:00Z'

describe('formatters in a chosen zone', () => {
  it('shows 23:30 UTC as 06:30 on the next day in Asia/Ho_Chi_Minh', () => {
    expect(formatTime(AT, HCM)).toBe('6:30 AM')
    expect(formatDate(AT, HCM)).toBe('Nov 13, 2026')
    expect(formatClock(AT, HCM)).toBe('06:30:00')
    expect(formatDateTimeShort(AT, HCM)).toMatch(/Nov 13, 2026.*6:30\s?AM/)
    expect(dayKey(AT, HCM)).toBe('2026-11-13')
  })

  it('shows the same instant on the earlier day in UTC', () => {
    expect(formatDate(AT, 'UTC')).toBe('Nov 12, 2026')
    expect(formatTime(AT, 'UTC')).toBe('11:30 PM')
  })

  it('counts Today and Yesterday by the zone', () => {
    const now = new Date('2026-11-13T00:10:00Z') // 07:10 on Nov 13 in Ho Chi Minh, 00:10 in UTC
    expect(relativeDay(AT, now, HCM)).toBe('Today')
    expect(relativeDay(AT, now, 'UTC')).toBe('Yesterday')
    expect(relativeDay('2026-11-10T12:00:00Z', now, 'UTC')).toBe('Nov 10, 2026')
  })

  it('returns the text of an invalid time instead of throwing', () => {
    expect(formatDate('not a date', HCM)).toBe('not a date')
  })
})

describe('no zone, or one the browser does not know', () => {
  it('uses the browser zone without a chosen zone', () => {
    expect(resolveZone(null)).toBe(browserZone())
    expect(resolveZone(undefined)).toBe(browserZone())
    const browser = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(AT))
    expect(formatDate(AT, resolveZone(null))).toBe(browser)
  })

  it('falls back to the browser zone for an unknown name', () => {
    expect(resolveZone('Mars/Olympus_Mons')).toBe(browserZone())
    expect(() => formatTime(AT, 'Mars/Olympus_Mons')).not.toThrow()
    expect(formatTime(AT, 'Mars/Olympus_Mons')).toBe(formatTime(AT, browserZone()))
  })
})
