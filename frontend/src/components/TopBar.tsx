import type { Theme } from '../lib/theme'
import { Icon, type IconName } from './Icon'

interface Props {
  theme: Theme
  onThemeChange: (theme: Theme) => void
}

const THEMES: { value: Theme; label: string; icon: IconName }[] = [
  { value: 'system', label: 'System', icon: 'system' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
]

export function TopBar({ theme, onThemeChange }: Props) {
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
        <a href="#/settings">
          <Icon name="settings" />
          Settings
        </a>
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
    </header>
  )
}
