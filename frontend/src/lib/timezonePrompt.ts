const KEY = 'lh-timezone-dismissed'

/** True once the user chose "Not now" in this browser session. */
export function timeZoneDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function dismissTimeZone(): void {
  try {
    window.sessionStorage.setItem(KEY, '1')
  } catch {
    /* storage blocked: the dialog then only stays closed until the page reloads */
  }
}

/** At sign-out: the next sign-in asks again. */
export function forgetTimeZoneDismissal(): void {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* nothing stored */
  }
}

/** The zone names to offer: the browser's list, with the browser's own zone and the chosen one always present. */
export function zoneChoices(current?: string | null): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  const names = new Set(supported)
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (own) names.add(own)
  if (current) names.add(current)
  return [...names].sort()
}
