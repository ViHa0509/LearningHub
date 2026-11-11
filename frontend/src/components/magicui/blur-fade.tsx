/*
 * Source: https://magicui.design/docs/components/blur-fade (registry: https://magicui.design/r/blur-fade.json)
 * MIT License, Magic UI.
 * Adapted: no AnimatePresence; renders plainly (visible, no animation) under reduced motion.
 */
import { useRef, type ReactNode } from 'react'
import { motion, type MotionProps, type Variants } from 'motion/react'
import { useReducedMotion } from '../../lib/useReducedMotion'
import { useSeen } from '../../lib/useSeen'

interface BlurFadeProps extends Omit<MotionProps, 'children'> {
  children: ReactNode
  className?: string
  duration?: number
  /** Seconds before the fade starts. */
  delay?: number
  offset?: number
  direction?: 'up' | 'down' | 'left' | 'right'
  /** The element to render (a list item keeps a list valid). */
  as?: 'div' | 'li'
  /** Wait until the element scrolls into view. */
  inView?: boolean
  blur?: string
}

export function BlurFade({
  children,
  className,
  duration = 0.4,
  delay = 0,
  offset = 6,
  direction = 'down',
  inView = false,
  as = 'div',
  blur = '6px',
  ...props
}: BlurFadeProps) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const seen = useSeen(ref)
  if (reduced) {
    const Plain = as
    return <Plain className={className}>{children}</Plain>
  }
  const MotionTag = as === 'li' ? motion.li : motion.div
  const shown = !inView || seen
  const axis = direction === 'left' || direction === 'right' ? 'x' : 'y'
  const variants: Variants = {
    hidden: {
      [axis]: direction === 'right' || direction === 'down' ? -offset : offset,
      opacity: 0,
      filter: `blur(${blur})`,
    },
    visible: { [axis]: 0, opacity: 1, filter: 'blur(0px)' },
  }
  return (
    <MotionTag
      ref={ref as never}
      initial="hidden"
      animate={shown ? 'visible' : 'hidden'}
      variants={variants}
      transition={{ delay: 0.04 + delay, duration, ease: 'easeOut' }}
      className={className}
      {...props}
    >
      {children}
    </MotionTag>
  )
}
