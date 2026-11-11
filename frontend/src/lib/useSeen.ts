import { useEffect, useState, type RefObject } from 'react'

/** True once the element has scrolled into view; true at once where IntersectionObserver is missing. */
export function useSeen(ref: RefObject<Element | null>, margin = '0px'): boolean {
  const observable = typeof IntersectionObserver !== 'undefined'
  const [seen, setSeen] = useState(!observable)
  useEffect(() => {
    const element = ref.current
    if (!observable || !element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true)
          observer.disconnect()
        }
      },
      { rootMargin: margin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, observable, margin])
  return seen
}
