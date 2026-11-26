import { useCallback, useLayoutEffect, useState, type RefObject } from 'react'

export type Side = 'left' | 'right'
export type Widths = Record<Side, number | null>

export const STORAGE_KEY = 'lh.paneWidths'
export const LIMITS: Record<Side, { min: number; max: number }> = {
  left: { min: 200, max: 480 },
  right: { min: 280, max: 640 },
}
export const MIN_CENTER = 360
export const COLLAPSED = 44
export const STEP = 16

/** Today's `minmax(240px, 22%)` and `minmax(300px, 30%)`, in px for a shell of this width. */
export function defaultWidth(side: Side, shell: number): number {
  return side === 'left' ? Math.max(240, shell * 0.22) : Math.max(300, shell * 0.3)
}

/** The largest width of a panel: its limit, and the center keeps MIN_CENTER (shell 0 = unknown). */
export function maxWidth(side: Side, shell: number, otherColumn: number): number {
  const { min, max } = LIMITS[side]
  return shell > 0 ? Math.max(min, Math.min(max, shell - MIN_CENTER - otherColumn)) : max
}

export function clampWidth(side: Side, width: number, shell: number, otherColumn: number): number {
  return Math.round(Math.min(maxWidth(side, shell, otherColumn), Math.max(LIMITS[side].min, width)))
}

/** The width after a key, or null when the key is not a resize key. */
export function keyWidth(key: string, side: Side, current: number, max: number): number | null {
  // The left panel's handle is on its right edge, the right panel's on its left edge.
  const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft'
  const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight'
  if (key === grow) return Math.min(max, current + STEP)
  if (key === shrink) return Math.max(LIMITS[side].min, current - STEP)
  if (key === 'Home') return LIMITS[side].min
  if (key === 'End') return max
  return null
}

function valid(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Saved widths; anything missing, broken or out of its limits is ignored (the default). */
export function loadWidths(): Widths {
  const none: Widths = { left: null, right: null }
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return none
    const { left, right } = raw as Record<string, unknown>
    return {
      left: valid(left) && left >= LIMITS.left.min && left <= LIMITS.left.max ? left : null,
      right: valid(right) && right >= LIMITS.right.min && right <= LIMITS.right.max ? right : null,
    }
  } catch {
    return none
  }
}

function saveWidths(widths: Widths) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
  } catch {
    // Private mode or a full store: the widths last for this visit only.
  }
}

/** The side panels' widths: the saved ones, clamped against the shell's width. */
export function usePaneWidths(shellRef: RefObject<HTMLElement | null>, leftOpen: boolean, rightOpen: boolean) {
  const [widths, setWidths] = useState<Widths>(loadWidths)
  const [shell, setShell] = useState(0)
  useLayoutEffect(() => {
    const measure = () => setShell(shellRef.current?.clientWidth ?? 0)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [shellRef])

  const raw = useCallback((side: Side) => widths[side] ?? defaultWidth(side, shell), [widths, shell])
  const column = (side: Side) => ((side === 'left' ? leftOpen : rightOpen) ? raw(side) : COLLAPSED)
  const other = (side: Side) => column(side === 'left' ? 'right' : 'left')

  const value = (side: Side) => clampWidth(side, raw(side), shell, other(side))
  const max = (side: Side) => maxWidth(side, shell, other(side))
  const set = (side: Side, width: number | null) => {
    const next = { ...widths, [side]: width === null ? null : clampWidth(side, width, shell, other(side)) }
    setWidths(next)
    saveWidths(next)
  }

  // Until the user resizes, a column keeps today's minmax(); then it is a px width.
  const track = (side: Side, open: boolean) => {
    if (!open) return `${COLLAPSED}px`
    if (widths[side] === null) return side === 'left' ? 'minmax(240px, 22%)' : 'minmax(300px, 30%)'
    return `${value(side)}px`
  }
  const columns = [track('left', leftOpen), '1fr', track('right', rightOpen)]
  return { columns, value, max, set }
}
