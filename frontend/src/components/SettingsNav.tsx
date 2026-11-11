import { useIsAdmin } from '../lib/auth'
import { backFromSettings, routeHash } from '../lib/route'

export type SettingsTab = 'providers' | 'users' | 'sign-in' | 'data'

const TABS: { id: SettingsTab; label: string; href: string; adminOnly?: boolean }[] = [
  { id: 'providers', label: 'AI providers', href: '#/settings' },
  { id: 'users', label: 'Users', href: '#/settings/users', adminOnly: true },
  { id: 'sign-in', label: 'Sign-in', href: '#/settings/sign-in', adminOnly: true },
  { id: 'data', label: 'Data & sync', href: '#/settings/data' },
]

/** The Back link and the small nav shared by the Settings pages (Users and Sign-in: admin only). */
export function SettingsNav({ current }: { current: SettingsTab }) {
  const admin = useIsAdmin()
  return (
    <>
      <a className="back-link" href={routeHash(backFromSettings())}>
        ← Back
      </a>
      <nav className="settings-nav" aria-label="Settings sections">
        {TABS.filter((tab) => admin || !tab.adminOnly).map((tab) => (
          <a key={tab.id} href={tab.href} aria-current={tab.id === current ? 'page' : undefined}>
            {tab.label}
          </a>
        ))}
      </nav>
    </>
  )
}
