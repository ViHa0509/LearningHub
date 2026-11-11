import type { ReactNode } from 'react'
import { useIsAdmin } from '../lib/auth'

/** Shows its page to the admin; a member who opens the address gets a short refusal. */
export function AdminOnly({ children }: { children: ReactNode }) {
  const admin = useIsAdmin()
  if (admin) return <>{children}</>
  return (
    <section className="settings-page" aria-label="Admin only">
      <h1>Admin only</h1>
      <p className="muted">Only the admin can open this page.</p>
      <a href="#/settings">Back to Settings</a>
    </section>
  )
}
