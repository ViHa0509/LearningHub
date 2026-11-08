/** A tiny notifier: API requests report network errors and 5xx answers; the health check listens. */
type Listener = () => void

const listeners = new Set<Listener>()

export function reportFailure() {
  for (const listener of [...listeners]) listener()
}

/** Calls `listener` on every reported failure; returns the unsubscribe function. */
export function onFailure(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
