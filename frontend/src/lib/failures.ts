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

/** A 401 from an app route: the session ended. The session gate listens and shows the login page. */
const unauthorizedListeners = new Set<Listener>()

export function reportUnauthorized() {
  for (const listener of [...unauthorizedListeners]) listener()
}

/** Calls `listener` on every 401 from a non-auth route; returns the unsubscribe function. */
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener)
  return () => {
    unauthorizedListeners.delete(listener)
  }
}
