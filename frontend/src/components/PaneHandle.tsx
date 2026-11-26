import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { keyWidth, LIMITS, type Side } from '../lib/paneWidths'

interface Props {
  side: Side
  /** The panel's current width in px. */
  value: number
  /** The largest width now (the center keeps its minimum). */
  max: number
  onChange: (width: number) => void
  onReset: () => void
  onDragging: (dragging: boolean) => void
}

/** The draggable edge between a side panel and the center. */
export function PaneHandle({ side, value, max, onChange, onReset, onDragging }: Props) {
  const start = useRef<{ x: number; width: number } | null>(null)
  const label = side === 'left' ? 'Resize Learned list' : 'Resize Agent panel'
  // The left panel grows when the pointer moves right; the right one when it moves left.
  const sign = side === 'left' ? 1 : -1

  const onKeyDown = (event: KeyboardEvent) => {
    const next = keyWidth(event.key, side, value, max)
    if (next === null) return
    event.preventDefault()
    onChange(next)
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    start.current = { x: event.clientX, width: value }
    onDragging(true)
  }
  const onPointerMove = (event: PointerEvent) => {
    if (start.current) onChange(start.current.width + sign * (event.clientX - start.current.x))
  }
  const endDrag = () => {
    if (!start.current) return
    start.current = null
    onDragging(false)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={LIMITS[side].min}
      aria-valuemax={Math.round(max)}
      tabIndex={0}
      className={`pane-handle ${side}`}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={onReset}
    />
  )
}
