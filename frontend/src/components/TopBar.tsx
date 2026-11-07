import type { Theme } from '../lib/theme'

interface Props {
  theme: Theme
  onThemeChange: (theme: Theme) => void
}

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function TopBar({ theme, onThemeChange }: Props) {
  return (
    <header className="top-bar">
      <a className="brand" href="#/">
        Learning Hub
      </a>
      <nav className="top-actions" aria-label="App">
        <a href="#/settings">Settings</a>
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
            {t.label}
          </button>
        ))}
      </div>
    </header>
  )
}
