/*
 * Source: https://magicui.design/docs/components/dot-pattern (registry: https://magicui.design/r/dot-pattern.json)
 * MIT License, Magic UI.
 * Adapted: the dots are one SVG <pattern> (a full-page background would otherwise need thousands of animated
 * circles); the glow is a CSS pulse on the layer; colors come from the app's theme tokens; static under
 * reduced motion.
 */
import { useId, type SVGProps } from 'react'
import { useReducedMotion } from '../../lib/useReducedMotion'
import { cn } from '../../lib/cn'

interface DotPatternProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height' | 'x' | 'y'> {
  width?: number
  height?: number
  cx?: number
  cy?: number
  cr?: number
  /** Pulse the dots softly (they stay still under reduced motion). */
  glow?: boolean
}

export function DotPattern({
  width = 20,
  height = 20,
  cx = 1,
  cy = 1,
  cr = 1,
  glow = false,
  className,
  ...props
}: DotPatternProps) {
  const id = useId()
  const reduced = useReducedMotion()
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={cn(
        'pointer-events-none absolute inset-0 h-full w-full text-accent/35',
        glow && !reduced && 'mu-glow animate-mu-glow',
        className,
      )}
      {...props}
    >
      <defs>
        <pattern id={`${id}-dots`} width={width} height={height} patternUnits="userSpaceOnUse">
          <circle cx={cx} cy={cy} r={cr} fill="currentColor" />
        </pattern>
        <radialGradient id={`${id}-fade`}>
          <stop offset="0%" stopColor="white" stopOpacity="1" />
          <stop offset="100%" stopColor="white" stopOpacity="0.15" />
        </radialGradient>
        <mask id={`${id}-mask`}>
          <rect width="100%" height="100%" fill={`url(#${id}-fade)`} />
        </mask>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id}-dots)`} mask={`url(#${id}-mask)`} />
    </svg>
  )
}
