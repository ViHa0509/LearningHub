import type { Effort } from '../api'

/** Per-browser choices of the agent panel, kept in localStorage (guarded: storage may be blocked). */
const EFFORT_KEY = 'learninghub.effort'

export const EFFORTS: { id: Effort; label: string; tip: string }[] = [
  { id: 'low', label: 'Low', tip: 'Fast, saves tokens' },
  { id: 'medium', label: 'Medium', tip: 'Balanced' },
  { id: 'high', label: 'High', tip: 'Deep reasoning, slower' },
]

export function effortLabel(effort: Effort): string {
  return EFFORTS.find((e) => e.id === effort)?.label ?? effort
}

export function readEffort(): Effort {
  try {
    const value = localStorage.getItem(EFFORT_KEY)
    return value === 'low' || value === 'medium' || value === 'high' ? value : 'medium'
  } catch {
    return 'medium'
  }
}

export function saveEffort(effort: Effort) {
  try {
    localStorage.setItem(EFFORT_KEY, effort)
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}

/** Copies text to the clipboard; false when the clipboard is not available or refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
