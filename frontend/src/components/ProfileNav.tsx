import { backFromSettings, routeHash, type ProfileSection, type Route } from '../lib/route'

const SECTIONS: { id: ProfileSection; label: string; href: string }[] = [
  { id: 'general', label: 'General', href: '#/profile' },
  { id: 'security', label: 'Security', href: '#/profile/security' },
  { id: 'preferences', label: 'Preferences', href: '#/profile/preferences' },
]

/** The Profile sections for the left column. */
export function ProfileNav({ route, onPick }: { route: Route; onPick?: () => void }) {
  const current = route.page === 'profile' ? route.section : null
  return (
    <div className="side-nav-wrap">
      <a className="back-link" href={routeHash(backFromSettings())}>
        ← Back
      </a>
      <nav className="side-nav" aria-label="Profile sections">
        <ul>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={s.href} onClick={onPick} aria-current={s.id === current ? 'page' : undefined}>
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
