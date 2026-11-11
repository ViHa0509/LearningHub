/*
 * Source: https://magicui.design/docs/components/marquee (registry: https://magicui.design/r/marquee.json)
 * MIT License, Magic UI.
 * Adapted: the repeated copies are aria-hidden (only the first is read); static, a single copy, under reduced motion.
 */
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { useReducedMotion } from '../../lib/useReducedMotion'
import { cn } from '../../lib/cn'

interface MarqueeProps extends ComponentPropsWithoutRef<'div'> {
  reverse?: boolean
  pauseOnHover?: boolean
  children: ReactNode
  /** How many copies of the content run side by side. */
  repeat?: number
}

export function Marquee({
  className,
  reverse = false,
  pauseOnHover = false,
  children,
  repeat = 4,
  ...props
}: MarqueeProps) {
  const reduced = useReducedMotion()
  const copies = reduced ? 1 : repeat
  return (
    <div {...props} className={cn('group flex gap-(--gap) overflow-hidden [--duration:40s] [--gap:1rem]', className)}>
      {Array.from({ length: copies }, (_, i) => (
        <div
          key={i}
          aria-hidden={i > 0 ? true : undefined}
          className={cn(
            'flex shrink-0 flex-row justify-around gap-(--gap)',
            !reduced && 'mu-marquee animate-marquee',
            pauseOnHover && 'group-hover:[animation-play-state:paused]',
            reverse && '[animation-direction:reverse]',
          )}
        >
          {children}
        </div>
      ))}
    </div>
  )
}
