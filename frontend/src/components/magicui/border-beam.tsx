/*
 * Source: https://magicui.design/docs/components/border-beam (registry: https://magicui.design/r/border-beam.json)
 * MIT License, Magic UI.
 * Adapted: default colors are the accent and secondary tokens; renders nothing under reduced motion.
 */
import type { CSSProperties } from 'react'
import { motion, type MotionStyle, type Transition } from 'motion/react'
import { useReducedMotion } from '../../lib/useReducedMotion'
import { cn } from '../../lib/cn'

interface BorderBeamProps {
  size?: number
  duration?: number
  delay?: number
  colorFrom?: string
  colorTo?: string
  transition?: Transition
  className?: string
  style?: CSSProperties
  reverse?: boolean
  initialOffset?: number
  borderWidth?: number
}

export function BorderBeam({
  className,
  size = 60,
  delay = 0,
  duration = 6,
  colorFrom = 'var(--accent)',
  colorTo = 'var(--secondary)',
  transition,
  style,
  reverse = false,
  initialOffset = 0,
  borderWidth = 2,
}: BorderBeamProps) {
  const reduced = useReducedMotion()
  if (reduced) return null
  return (
    <div
      aria-hidden="true"
      className="mu-beam pointer-events-none absolute inset-0 rounded-[inherit] border-(length:--border-beam-width) border-transparent mask-[linear-gradient(transparent,transparent),linear-gradient(#000,#000)] mask-intersect [mask-clip:padding-box,border-box]"
      style={{ '--border-beam-width': `${borderWidth}px` } as CSSProperties}
    >
      <motion.div
        className={cn(
          'mu-beam-dot absolute aspect-square bg-linear-to-l from-(--color-from) via-(--color-to) to-transparent',
          className,
        )}
        style={
          {
            width: size,
            offsetPath: `rect(0 auto auto 0 round ${size}px)`,
            '--color-from': colorFrom,
            '--color-to': colorTo,
            ...style,
          } as MotionStyle
        }
        initial={{ offsetDistance: `${initialOffset}%` }}
        animate={{
          offsetDistance: reverse
            ? [`${100 - initialOffset}%`, `${-initialOffset}%`]
            : [`${initialOffset}%`, `${100 + initialOffset}%`],
        }}
        transition={{ repeat: Infinity, ease: 'linear', duration, delay: -delay, ...transition }}
      />
    </div>
  )
}
