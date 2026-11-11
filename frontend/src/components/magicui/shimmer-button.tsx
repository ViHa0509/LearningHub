/*
 * Source: https://magicui.design/docs/components/shimmer-button (registry: https://magicui.design/r/shimmer-button.json)
 * MIT License, Magic UI.
 * Adapted: theme tokens for colors, the app's radius, custom properties renamed so they cannot clash with the
 * app's own --bg and --radius, decorative layers are aria-hidden, no spark under reduced motion.
 */
import { forwardRef, type ComponentPropsWithoutRef, type CSSProperties } from 'react'
import { useReducedMotion } from '../../lib/useReducedMotion'
import { cn } from '../../lib/cn'

export interface ShimmerButtonProps extends ComponentPropsWithoutRef<'button'> {
  shimmerColor?: string
  shimmerSize?: string
  borderRadius?: string
  shimmerDuration?: string
  background?: string
}

export const ShimmerButton = forwardRef<HTMLButtonElement, ShimmerButtonProps>(function ShimmerButton(
  {
    shimmerColor = 'var(--on-accent)',
    shimmerSize = '0.05em',
    shimmerDuration = '3s',
    borderRadius = '8px',
    background = 'var(--accent)',
    className,
    children,
    ...props
  },
  ref,
) {
  const reduced = useReducedMotion()
  return (
    <button
      ref={ref}
      style={
        {
          '--spread': '90deg',
          '--shimmer-color': shimmerColor,
          '--sb-radius': borderRadius,
          '--speed': shimmerDuration,
          '--cut': shimmerSize,
          '--sb-bg': background,
        } as CSSProperties
      }
      className={cn(
        'group relative z-0 inline-flex cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap text-on-accent [background:var(--sb-bg)] [border-radius:var(--sb-radius)]',
        'transform-gpu transition-transform duration-300 ease-in-out active:translate-y-px',
        className,
      )}
      {...props}
    >
      {!reduced && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-30 block overflow-visible blur-[2px]"
          style={{ containerType: 'size' }}
        >
          <span className="mu-shimmer animate-shimmer-slide absolute inset-0 block aspect-[1] h-[100cqh]">
            <span className="mu-shimmer-spin animate-spin-around absolute -inset-full block w-auto [background:conic-gradient(from_calc(270deg-(var(--spread)*0.5)),transparent_0,var(--shimmer-color)_var(--spread),transparent_var(--spread))]" />
          </span>
        </span>
      )}
      {children}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 block transform-gpu shadow-[inset_0_-8px_10px_#ffffff1f] transition-all duration-300 ease-in-out [border-radius:var(--sb-radius)] group-hover:shadow-[inset_0_-6px_10px_#ffffff3f] group-active:shadow-[inset_0_-10px_10px_#ffffff3f]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-(--cut) -z-20 block [background:var(--sb-bg)] [border-radius:var(--sb-radius)]"
      />
    </button>
  )
})
