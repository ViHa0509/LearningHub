/** The home tab chosen in this browser, kept in localStorage (guarded: storage may be blocked). */
const KEY = 'learninghub.homeTab'

export function readHomeTab(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function saveHomeTab(id: string) {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}

/** A kebab-case area or topic slug made from a title. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}
