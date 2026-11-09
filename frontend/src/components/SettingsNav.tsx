import { backFromSettings, routeHash } from '../lib/route'

export type SettingsTab = 'providers' | 'sign-in' | 'data'

const TABS: { id: SettingsTab; label: string; href: string }[] = [
  { id: 'providers', label: 'AI providers', href: '#/settings' },
  { id: 'sign-in', label: 'Sign-in', href: '#/settings/sign-in' },
  { id: 'data', label: 'Data & sync', href: '#/settings/data' },
]

/** The Back link and the small nav shared by the Settings pages. */
export function SettingsNav({ current }: { current: SettingsTab }) {
  return (
    <>
      <a className="back-link" href={routeHash(backFromSettings())}>
        ← Back
      </a>
      <nav className="settings-nav" aria-label="Settings sections">
        {TABS.map((tab) => (
          <a key={tab.id} href={tab.href} aria-current={tab.id === current ? 'page' : undefined}>
            {tab.label}
          </a>
        ))}
      </nav>
    </>
  )
}
