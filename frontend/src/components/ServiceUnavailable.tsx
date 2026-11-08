import type { ServiceHealth } from '../hooks'

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

/**
 * The full-page screen shown instead of the panels while the health check fails. It has no
 * controls: the health hook keeps checking in the background and the app comes back by itself.
 */
export function ServiceUnavailable({ health }: { health: ServiceHealth }) {
  const { reason, lastChecked } = health
  return (
    <main className="outage" aria-label="Service unavailable">
      <section className="outage-card">
        <img className="outage-mark for-dark" src="/brand/logo-mark.svg" alt="" width="72" height="72" />
        <img className="outage-mark for-light" src="/brand/logo-mark-light.svg" alt="" width="72" height="72" />
        <h1>Service unavailable</h1>
        <p className="outage-reason">
          {reason === 'database' ? "Learning Hub can't reach its database." : "Learning Hub can't reach its server."}
        </p>
        <p className="muted">This page reconnects on its own.</p>
        {lastChecked && <p className="outage-checked muted">Last checked {clock(lastChecked)}</p>}
      </section>
    </main>
  )
}
