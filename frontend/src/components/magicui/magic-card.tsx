/*
 * Source: https://magicui.design/docs/components/magic-card (registry: https://magicui.design/r/magic-card.json)
 * MIT License, Magic UI.
 * Adapted: wraps an existing card (it keeps its own surface and border) and lays a pointer-following spotlight
 * over it; no next-themes (the spotlight color is the accent token, so light and dark follow the app); no
 * spotlight under reduced motion.
 */
import { useCallback, type PointerEvent, type ReactNode } from 'react'
import { motion, useMotionTemplate, useMotionValue } from 'motion/react'
import { useReducedMotion } from '../../lib/useReducedMotion'
import { cn } from '../../lib/cn'

interface MagicCardProps {
  children?: ReactNode
  className?: string
  gradientSize?: number
  /** Any CSS color; defaults to the accent token at low strength. */
  gradientColor?: string
}

export function MagicCard({
  children,
  className,
  gradientSize = 220,
  gradientColor = 'color-mix(in srgb, var(--accent) 16%, transparent)',
}: MagicCardProps) {
  const reduced = useReducedMotion()
  const mouseX = useMotionValue(-gradientSize)
  const mouseY = useMotionValue(-gradientSize)
  const background = useMotionTemplate`radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px, ${gradientColor}, transparent 100%)`

  const move = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      mouseX.set(e.clientX - rect.left)
      mouseY.set(e.clientY - rect.top)
    },
    [mouseX, mouseY],
  )
  const leave = useCallback(() => {
    mouseX.set(-gradientSize)
    mouseY.set(-gradientSize)
  }, [mouseX, mouseY, gradientSize])

  return (
    <div
      className={cn('group relative isolate rounded-xl', className)}
      onPointerMove={reduced ? undefined : move}
      onPointerLeave={reduced ? undefined : leave}
    >
      {children}
      {!reduced && (
        <motion.div
          aria-hidden="true"
          className="mu-spotlight pointer-events-none absolute inset-0 z-10 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background }}
        />
      )}
    </div>
  )
}
