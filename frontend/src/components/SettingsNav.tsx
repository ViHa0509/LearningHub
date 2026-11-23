import { useIsAdmin } from '../lib/auth'
import { backFromSettings, routeHash, type Route } from '../lib/route'

type SettingsTab = 'providers' | 'agents' | 'users' | 'sign-in' | 'data'

const TABS: { id: SettingsTab; label: string; href: string; adminOnly?: boolean }[] = [
  { id: 'providers', label: 'AI providers', href: '#/settings' },
  { id: 'agents', label: 'Agents', href: '#/settings/agents' },
  { id: 'users', label: 'Users', href: '#/settings/users', adminOnly: true },
  { id: 'sign-in', label: 'Sign-in', href: '#/settings/sign-in', adminOnly: true },
  { id: 'data', label: 'Data & sync', href: '#/settings/data' },
]

const CURRENT: Partial<Record<Route['page'], SettingsTab>> = {
  settings: 'providers',
  provider: 'providers',
  'agents-settings': 'agents',
  'users-settings': 'users',
  'sign-in-settings': 'sign-in',
  'data-settings': 'data',
}

/** The Settings sections for the left column (Users and Sign-in: admin only). */
export function SettingsNav({ route, onPick }: { route: Route; onPick?: () => void }) {
  const admin = useIsAdmin()
  const current = CURRENT[route.page]
  return (
    <div className="side-nav-wrap">
      <a className="back-link" href={routeHash(backFromSettings())}>
        ← Back
      </a>
      <nav className="side-nav" aria-label="Settings sections">
        <ul>
          {TABS.filter((tab) => admin || !tab.adminOnly).map((tab) => (
            <li key={tab.id}>
              <a href={tab.href} onClick={onPick} aria-current={tab.id === current ? 'page' : undefined}>
                {tab.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
