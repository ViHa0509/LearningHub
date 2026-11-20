import { useMemo } from 'react'
import { useMe } from './auth'

/** A time as the server sends it (ISO string) or as a Date. */
export type TimeValue = string | Date

/** The browser's own time zone (an IANA name). */
export function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** The zone to format in: the given one when the browser knows it, else the browser's zone. */
export function resolveZone(zone: string | null | undefined): string {
  if (!zone) return browserZone()
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return browserZone()
  }
}

function toDate(value: TimeValue): Date | null {
  const date = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(date.getTime()) ? null : date
}

function format(value: TimeValue, locale: string | undefined, options: Intl.DateTimeFormatOptions, zone: string): string {
  const date = toDate(value)
  if (!date) return typeof value === 'string' ? value : ''
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: resolveZone(zone) }).format(date)
}

/** "Nov 8, 2026". */
export const formatDate = (value: TimeValue, zone: string) =>
  format(value, 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }, zone)

/** Date and time in the browser's locale, seconds included (like `toLocaleString()`). */
export const formatDateTime = (value: TimeValue, zone: string) =>
  format(value, undefined, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }, zone)

/** A shorter date and time: "Nov 8, 2026, 6:30 AM". */
export const formatDateTimeShort = (value: TimeValue, zone: string) =>
  format(value, undefined, { dateStyle: 'medium', timeStyle: 'short' }, zone)

/** "9:30 AM". */
export const formatTime = (value: TimeValue, zone: string) =>
  format(value, 'en-US', { hour: 'numeric', minute: '2-digit' }, zone)

/** 24-hour clock with seconds: "06:30:05". */
export const formatClock = (value: TimeValue, zone: string) =>
  format(value, 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }, zone)

/** The calendar day of an instant in the zone, as a sortable "2026-11-08" key. */
export function dayKey(value: TimeValue, zone: string): string {
  const date = toDate(value)
  if (!date) return String(value)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveZone(zone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function previousDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

/** "Today", "Yesterday", or the date ("Nov 5, 2026"), counting days in the zone. */
export function relativeDay(value: TimeValue, now: Date, zone: string): string {
  const key = dayKey(value, zone)
  const today = dayKey(now, zone)
  if (key === today) return 'Today'
  if (key === previousDayKey(today)) return 'Yesterday'
  return formatDate(value, zone)
}

/** The formatters bound to one zone. */
export interface Time {
  zone: string
  date: (value: TimeValue) => string
  dateTime: (value: TimeValue) => string
  dateTimeShort: (value: TimeValue) => string
  time: (value: TimeValue) => string
  clock: (value: TimeValue) => string
  dayKey: (value: TimeValue) => string
  relativeDay: (value: TimeValue, now: Date) => string
}

export function timeIn(zone: string): Time {
  return {
    zone,
    date: (value) => formatDate(value, zone),
    dateTime: (value) => formatDateTime(value, zone),
    dateTimeShort: (value) => formatDateTimeShort(value, zone),
    time: (value) => formatTime(value, zone),
    clock: (value) => formatClock(value, zone),
    dayKey: (value) => dayKey(value, zone),
    relativeDay: (value, now) => relativeDay(value, now, zone),
  }
}

/** The zone times show in: the signed-in user's, else the browser's. */
export function useTimeZone(): string {
  const chosen = useMe()?.timezone
  return resolveZone(chosen)
}

/** Formatters in the signed-in user's time zone (the browser's while none is chosen). */
export function useTime(): Time {
  const zone = useTimeZone()
  return useMemo(() => timeIn(zone), [zone])
}
