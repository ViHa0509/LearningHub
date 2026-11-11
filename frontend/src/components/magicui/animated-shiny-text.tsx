/*
 * Source: https://magicui.design/docs/components/animated-shiny-text (registry: https://magicui.design/r/animated-shiny-text.json)
 * MIT License, Magic UI.
 * Adapted: colors come from the theme tokens (light and dark); plain muted text under reduced motion.
 */
import type { ComponentPropsWithoutRef, CSSProperties } from 'react'
import { useReducedMotion } from '../../lib/useReducedMotion'
import { cn } from '../../lib/cn'

export interface AnimatedShinyTextProps extends ComponentPropsWithoutRef<'span'> {
  shimmerWidth?: number
}

export function AnimatedShinyText({ children, className, shimmerWidth = 100, ...props }: AnimatedShinyTextProps) {
  const reduced = useReducedMotion()
  return (
    <span
      style={{ '--shiny-width': `${shimmerWidth}px` } as CSSProperties}
      className={cn(
        reduced
          ? 'text-muted'
          : 'mu-shiny animate-shiny-text bg-linear-to-r from-transparent via-fg/90 via-50% to-transparent bg-size-[var(--shiny-width)_100%] bg-position-[0_0] bg-no-repeat bg-clip-text text-fg/55',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}
