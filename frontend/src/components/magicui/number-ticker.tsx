/*
 * Source: https://magicui.design/docs/components/number-ticker (registry: https://magicui.design/r/number-ticker.json)
 * MIT License, Magic UI.
 * Adapted: the number is React state (not written to the DOM by hand); the final value is exposed through
 * aria-label; with reduced motion, or where IntersectionObserver is missing, the final value shows at once.
 */
import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { useMotionValue, useSpring } from 'motion/react'
import { cn } from '../../lib/cn'
import { useReducedMotion } from '../../lib/useReducedMotion'
import { useSeen } from '../../lib/useSeen'

interface NumberTickerProps extends ComponentPropsWithoutRef<'span'> {
  value: number
  startValue?: number
  /** Seconds to wait once the number is in view. */
  delay?: number
  decimalPlaces?: number
}

const format = (n: number, decimalPlaces: number) =>
  Intl.NumberFormat('en-US', { minimumFractionDigits: decimalPlaces, maximumFractionDigits: decimalPlaces }).format(
    Number(n.toFixed(decimalPlaces)),
  )

export function NumberTicker({
  value,
  startValue = 0,
  delay = 0,
  decimalPlaces = 0,
  className,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduced = useReducedMotion()
  const still = reduced || typeof IntersectionObserver === 'undefined'
  const motionValue = useMotionValue(startValue)
  const spring = useSpring(motionValue, { damping: 60, stiffness: 100 })
  const inView = useSeen(ref)
  const [shown, setShown] = useState<number>(startValue)

  useEffect(() => {
    if (still || !inView) return
    const timer = setTimeout(() => motionValue.set(value), delay * 1000)
    return () => clearTimeout(timer)
  }, [still, inView, motionValue, value, delay])

  useEffect(() => {
    if (still) return
    return spring.on('change', (latest) => setShown(latest))
  }, [spring, still])

  return (
    <span
      ref={ref}
      aria-label={format(value, decimalPlaces)}
      className={cn('mu-ticker inline-block tabular-nums', className)}
      {...props}
    >
      {format(still ? value : shown, decimalPlaces)}
    </span>
  )
}
