import type { Me } from '../api'
import type { Theme } from '../lib/theme'
import { AccountMenu } from './AccountMenu'
import { Icon, type IconName } from './Icon'

interface Props {
  theme: Theme
  onThemeChange: (theme: Theme) => void
  /** The signed-in Owner: the avatar menu (with Settings) replaces the Settings link. */
  user?: Me | null
}

const THEMES: { value: Theme; label: string; icon: IconName }[] = [
  { value: 'system', label: 'System', icon: 'system' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
]

export function TopBar({ theme, onThemeChange, user = null }: Props) {
  return (
    <header className="top-bar">
      <a className="brand" href="#/">
        <img className="brand-mark for-dark" src="/brand/logo-mark-small.svg" alt="" width="28" height="28" />
        <img className="brand-mark for-light" src="/brand/logo-mark-small-light.svg" alt="" width="28" height="28" />
        <span>Learning Hub</span>
      </a>
      <nav className="top-actions" aria-label="App">
        <a href="#/news">
          <Icon name="news" />
          News
        </a>
        {!user && (
          <a href="#/settings">
            <Icon name="settings" />
            Settings
          </a>
        )}
      </nav>
      <div className="theme-switch" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={theme === t.value}
            onClick={() => onThemeChange(t.value)}
          >
            <Icon name={t.icon} />
            {t.label}
          </button>
        ))}
      </div>
      {user && <AccountMenu user={user} />}
    </header>
  )
}
